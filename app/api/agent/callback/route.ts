import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { publishRunEvent } from "@/lib/sse";
import { RunStatus, StepType } from "@/app/generated/prisma/client";

type Candidate = {
  fullName?: string;
  currentTitle?: string;
  company?: string;
  location?: string;
  linkedinUrl?: string;
  email?: string;
  phone?: string;
  cvLink?: string;
  skills?: string[];
  source: string;
};

type CallbackPayload =
  | { runId: string; type: "plan_approval"; plan: string }
  | { runId: string; type: "tool_complete"; tool: string; summary: string }
  | { runId: string; type: "completed"; candidates: Candidate[]; usageCostUsd: number }
  | { runId: string; type: "error"; message: string };

export async function POST(req: Request) {
  const secret = req.headers.get("x-callback-secret");
  if (secret !== process.env.OPENCLAW_CALLBACK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: CallbackPayload;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { runId, type } = payload;
  if (!runId || !type) {
    return NextResponse.json({ error: "Missing runId or type" }, { status: 400 });
  }

  const run = await prisma.agentRun.findUnique({ where: { sessionKey: runId } });
  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  if (type === "plan_approval") {
    const { plan } = payload as Extract<CallbackPayload, { type: "plan_approval" }>;

    await prisma.agentRun.update({
      where: { id: runId },
      data: { planText: plan, status: RunStatus.PAUSED_FOR_APPROVAL },
    });

    const step = await prisma.runStep.create({
      data: {
        runId,
        type: StepType.PLAN_APPROVAL,
        content: { plan },
      },
    });

    publishRunEvent(runId, step);
    return NextResponse.json({ ok: true });
  }

  if (type === "tool_complete") {
    const { tool, summary } = payload as Extract<CallbackPayload, { type: "tool_complete" }>;

    const step = await prisma.runStep.create({
      data: {
        runId,
        type: StepType.TOOL_COMPLETE,
        content: { tool, summary },
      },
    });

    publishRunEvent(runId, step);
    return NextResponse.json({ ok: true });
  }

  if (type === "completed") {
    const { candidates, usageCostUsd } = payload as Extract<
      CallbackPayload,
      { type: "completed" }
    >;

    const usageBilledUsd = usageCostUsd * 1.2;
    const org = await prisma.org.findUnique({ where: { id: run.orgId } });

    if (org) {
      const monthlyDeduction = Math.min(org.monthlyAllowanceUsd, usageBilledUsd);
      const additionalDeduction = usageBilledUsd - monthlyDeduction;

      await prisma.$transaction([
        prisma.org.update({
          where: { id: run.orgId },
          data: {
            monthlyAllowanceUsd: { decrement: monthlyDeduction },
            additionalCreditsUsd: { decrement: additionalDeduction },
          },
        }),
        prisma.creditTransaction.create({
          data: {
            orgId: run.orgId,
            type: "USAGE",
            amountUsd: -usageBilledUsd,
            note: `Agent run ${runId}`,
          },
        }),
      ]);

      // 80% usage warning check
      const updatedOrg = await prisma.org.findUnique({ where: { id: run.orgId } });
      if (updatedOrg) {
        const tierAllowance = getTierAllowance(updatedOrg.tier);
        const consumed = tierAllowance - updatedOrg.monthlyAllowanceUsd;
        if (consumed / tierAllowance >= 0.8) {
          // Publish warning event via SSE so the sidebar can show it
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
        results: candidates as object[],
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
    return NextResponse.json({ ok: true });
  }

  if (type === "error") {
    const { message } = payload as Extract<CallbackPayload, { type: "error" }>;

    await prisma.agentRun.update({
      where: { id: runId },
      data: { status: RunStatus.FAILED, endedAt: new Date() },
    });

    const step = await prisma.runStep.create({
      data: {
        runId,
        type: StepType.ERROR,
        content: { message },
      },
    });

    publishRunEvent(runId, step);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown type" }, { status: 400 });
}

function getTierAllowance(tier: string): number {
  switch (tier) {
    case "GROWTH":
      return 160;
    case "SCALE":
      return 480;
    default:
      return 80; // STARTER
  }
}
