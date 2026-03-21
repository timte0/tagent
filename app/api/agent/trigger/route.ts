import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { triggerAgentRun } from "@/lib/openclaw";
import { RunStatus } from "@/app/generated/prisma/client";

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

  // Trigger OpenClaw — mark failed if it throws
  try {
    await triggerAgentRun({ message, sessionKey: run.id });
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
