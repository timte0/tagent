import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { triggerAgentRun, unregisterRun, type AgentEvent } from "@/lib/openclaw";
import { publishRunEvent } from "@/lib/sse";
import { RunStatus, StepType } from "@/app/generated/prisma/client";

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!session.orgId) {
    return NextResponse.json({ error: "No organisation" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const { jobId } = body as { jobId?: string };
  if (!jobId) {
    return NextResponse.json({ error: "jobId is required" }, { status: 400 });
  }

  // Load org and check balance
  const org = await prisma.org.findUnique({ where: { id: session.orgId } });
  if (!org) {
    return NextResponse.json({ error: "Org not found" }, { status: 404 });
  }

  const available = org.monthlyAllowanceUsd + org.additionalCreditsUsd;
  if (available <= 0) {
    return NextResponse.json(
      { error: "Insufficient credits. Please top up your account." },
      { status: 402 }
    );
  }

  // Block if a run is already active for this org
  const activeRun = await prisma.agentRun.findFirst({
    where: {
      orgId: session.orgId,
      status: {
        in: [RunStatus.PENDING, RunStatus.RUNNING, RunStatus.PAUSED_FOR_APPROVAL],
      },
    },
    select: { id: true },
  });
  if (activeRun) {
    return NextResponse.json(
      { error: "A run is already active", runId: activeRun.id },
      { status: 409 }
    );
  }

  // Verify job belongs to this org
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  if (job.orgId !== session.orgId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Create the run — sessionKey === id
  const id = randomUUID();
  const run = await prisma.agentRun.create({
    data: {
      id,
      jobId,
      userId: session.id,
      orgId: session.orgId,
      status: RunStatus.RUNNING,
      sessionKey: id,
    },
  });

  // Build the sourcing prompt
  const jobTitle = job.title ? `Job Title: ${job.title}\n\n` : "";
  const message =
    `You are a recruitment sourcing agent. Find matching candidates on LinkedIn and HelloWork for the following job description.\n\n` +
    `${jobTitle}Job Description:\n${job.rawContent}\n\n` +
    `Search for candidates matching this profile and return a structured list with their details.`;

  // Trigger OpenClaw via WebSocket — mark failed if it throws
  try {
    await triggerAgentRun({
      message,
      sessionKey: run.id,
      onEvent: makeEventHandler(run.id, session.orgId),
    });
  } catch (err) {
    await prisma.agentRun.update({
      where: { id: run.id },
      data: { status: RunStatus.FAILED, endedAt: new Date() },
    });
    console.error("[trigger] OpenClaw error:", err);
    return NextResponse.json(
      { error: "Failed to contact agent service" },
      { status: 502 }
    );
  }

  return NextResponse.json({ runId: run.id });
}

// ─── Event handler ────────────────────────────────────────────────────────────

function makeEventHandler(runId: string, orgId: string) {
  // Accumulate assistant text for plan detection
  let assistantBuffer = "";
  let planPublished = false;

  return async function handleEvent(event: AgentEvent) {
    try {
      if (event.stream === "lifecycle") {
        const phase = event.data.phase as string | undefined;

        if (phase === "end") {
          await handleCompletion(runId, orgId, event.data);
          unregisterRun(runId);
        } else if (phase === "error") {
          const message = (event.data.message as string) ?? "Agent error";
          await prisma.agentRun.update({
            where: { id: runId },
            data: { status: RunStatus.FAILED, endedAt: new Date() },
          });
          const step = await prisma.runStep.create({
            data: { runId, type: StepType.ERROR, content: { message } },
          });
          publishRunEvent(runId, step);
          unregisterRun(runId);
        } else if (phase === "paused" || phase === "waiting") {
          // Agent is pausing for plan approval
          if (!planPublished && assistantBuffer.trim()) {
            await prisma.agentRun.update({
              where: { id: runId },
              data: {
                planText: assistantBuffer.trim(),
                status: RunStatus.PAUSED_FOR_APPROVAL,
              },
            });
            const step = await prisma.runStep.create({
              data: {
                runId,
                type: StepType.PLAN_APPROVAL,
                content: { plan: assistantBuffer.trim() },
              },
            });
            publishRunEvent(runId, step);
            planPublished = true;
          }
        }
        return;
      }

      if (event.stream === "tool") {
        const tool = (event.data.name as string) ?? "unknown";
        const summary = (event.data.summary as string) ?? "";
        const step = await prisma.runStep.create({
          data: {
            runId,
            type: StepType.TOOL_COMPLETE,
            content: { tool, summary },
          },
        });
        publishRunEvent(runId, step);
        return;
      }

      if (event.stream === "assistant") {
        // Accumulate text (used for plan detection above)
        const delta = (event.data.text as string) ?? "";
        assistantBuffer += delta;
      }
    } catch (err) {
      console.error("[openclaw event handler]", err);
    }
  };
}

// ─── Completion handler ───────────────────────────────────────────────────────

async function handleCompletion(
  runId: string,
  orgId: string,
  data: Record<string, unknown>
) {
  const candidates = (data.candidates as object[]) ?? [];
  const usageCostUsd = (data.usageCostUsd as number) ?? 0;
  const usageBilledUsd = usageCostUsd * 1.2;

  const org = await prisma.org.findUnique({ where: { id: orgId } });
  if (org) {
    const monthlyDeduction = Math.min(org.monthlyAllowanceUsd, usageBilledUsd);
    const additionalDeduction = usageBilledUsd - monthlyDeduction;

    await prisma.$transaction([
      prisma.org.update({
        where: { id: orgId },
        data: {
          monthlyAllowanceUsd: { decrement: monthlyDeduction },
          additionalCreditsUsd: { decrement: additionalDeduction },
        },
      }),
      prisma.creditTransaction.create({
        data: {
          orgId,
          type: "USAGE",
          amountUsd: -usageBilledUsd,
          note: `Agent run ${runId}`,
        },
      }),
    ]);

    // 80% usage warning check
    const updatedOrg = await prisma.org.findUnique({ where: { id: orgId } });
    if (updatedOrg) {
      const tierAllowance = getTierAllowance(updatedOrg.tier);
      const consumed = tierAllowance - updatedOrg.monthlyAllowanceUsd;
      if (consumed / tierAllowance >= 0.8) {
        publishRunEvent(runId, { __type: "usage_warning", consumed, tierAllowance });
        // TODO: send email to org managers (Phase 11)
      }
    }
  }

  await prisma.agentRun.update({
    where: { id: runId },
    data: {
      status: RunStatus.COMPLETED,
      endedAt: new Date(),
      usageCostUsd,
      usageBilledUsd,
      results: candidates,
    },
  });

  const step = await prisma.runStep.create({
    data: {
      runId,
      type: StepType.COMPLETED,
      content: { candidateCount: candidates.length, usageBilledUsd },
    },
  });
  publishRunEvent(runId, step);
}

function getTierAllowance(tier: string): number {
  switch (tier) {
    case "GROWTH":
      return 160;
    case "SCALE":
      return 480;
    default:
      return 80;
  }
}
