import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { triggerAgentRun, unregisterRun, type AgentEvent } from "@/lib/openclaw";
import { publishRunEvent } from "@/lib/sse";
import { RunStatus, StepType } from "@/app/generated/prisma/client";
import { decrypt } from "@/lib/crypto";
import { createAuthContext } from "@/lib/auth-context";
import { parseJobDescription } from "@/lib/job-parser";

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
        in: [RunStatus.PENDING, RunStatus.RUNNING],
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

  // Load user's tool credentials (LinkedIn, HelloWork)
  const toolCredentials = await prisma.toolCredential.findMany({
    where: { userId: session.id, isActive: true },
    include: { tool: { select: { slug: true } } },
  });

  const credentialsMap: Record<string, { email: string; password: string }> = {};
  for (const tc of toolCredentials) {
    try {
      const plain = JSON.parse(decrypt(tc.encryptedCredentials)) as {
        email: string;
        password: string;
      };
      credentialsMap[tc.tool.slug] = plain;
    } catch {
      // skip malformed credential
    }
  }

  // Generate short-lived auth context (10 min TTL)
  const authContextId = createAuthContext(session.id, credentialsMap);

  // Parse job description into structured search params
  let searchParams;
  try {
    searchParams = await parseJobDescription(job.rawContent);
  } catch (err) {
    console.error("[trigger] job parsing failed:", err);
    // Fall back to job title only
    searchParams = {
      title: job.title ?? "Candidate",
      location: null,
      company: null,
      keywords: [],
    };
  }

  // Build structured message for OpenClaw
  const messagePayload = {
    task: "linkedin_search",
    auth_context_id: authContextId,
    search: {
      title: searchParams.title,
      ...(searchParams.location ? { location: searchParams.location } : {}),
      ...(searchParams.company ? { company: searchParams.company } : {}),
      keywords: searchParams.keywords,
      limit: 25,
    },
    result_delivery: {
      mode: "gateway_session",
      sessionKey: run.id,
    },
  };

  // Trigger OpenClaw via WebSocket — mark failed if it throws
  try {
    await triggerAgentRun({
      message: JSON.stringify(messagePayload),
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
