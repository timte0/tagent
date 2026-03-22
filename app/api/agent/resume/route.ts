import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resumeAgentRun, unregisterRun, type AgentEvent } from "@/lib/openclaw";
import { publishRunEvent } from "@/lib/sse";
import { RunStatus, StepType } from "@/app/generated/prisma/client";

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const { runId, feedback } = body as { runId?: string; feedback?: string };

  if (!runId) {
    return NextResponse.json({ error: "runId is required" }, { status: 400 });
  }

  const run = await prisma.agentRun.findUnique({ where: { id: runId } });
  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  // Only the org members can resume
  if (session.role !== "ADMIN" && run.orgId !== session.orgId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (run.status !== RunStatus.PAUSED_FOR_APPROVAL) {
    return NextResponse.json(
      { error: "Run is not awaiting approval" },
      { status: 409 }
    );
  }

  // Set back to RUNNING immediately
  await prisma.agentRun.update({
    where: { id: runId },
    data: { status: RunStatus.RUNNING },
  });

  const message = feedback?.trim() || "Approved";

  try {
    await resumeAgentRun({
      sessionKey: run.sessionKey,
      message,
      onEvent: makeResumeEventHandler(run.id, run.orgId),
    });
  } catch (err) {
    // Revert status so the user can retry
    await prisma.agentRun.update({
      where: { id: runId },
      data: { status: RunStatus.PAUSED_FOR_APPROVAL },
    });
    console.error("[resume] OpenClaw error:", err);
    return NextResponse.json(
      { error: "Failed to contact agent service" },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true });
}

function makeResumeEventHandler(runId: string, orgId: string) {
  return async function handleEvent(event: AgentEvent) {
    try {
      if (event.stream === "tool") {
        const tool = (event.data.name as string) ?? "unknown";
        const summary = (event.data.summary as string) ?? "";
        const step = await prisma.runStep.create({
          data: { runId, type: StepType.TOOL_COMPLETE, content: { tool, summary } },
        });
        publishRunEvent(runId, step);
        return;
      }

      if (event.stream === "lifecycle") {
        const phase = event.data.phase as string | undefined;

        if (phase === "end") {
          const candidates = (event.data.candidates as object[]) ?? [];
          const usageCostUsd = (event.data.usageCostUsd as number) ?? 0;
          const usageBilledUsd = usageCostUsd * 1.2;

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
      }
    } catch (err) {
      console.error("[resume event handler]", err);
    }
  };
}
