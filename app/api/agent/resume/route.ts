import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resumeAgentRun } from "@/lib/openclaw";
import { RunStatus } from "@/app/generated/prisma/client";

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
    await resumeAgentRun({ sessionKey: run.sessionKey, message });
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
