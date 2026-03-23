import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { publishRunEvent } from "@/lib/sse";
import { RunStatus, StepType } from "@/app/generated/prisma/client";
import { decrypt } from "@/lib/crypto";
import { parseJobDescription } from "@/lib/job-parser";
import {
  scrapeLinkedIn,
  LinkedInAuthError,
  type LinkedInCandidate,
} from "@/lib/scrapers/linkedin";

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
      status: { in: [RunStatus.PENDING, RunStatus.RUNNING] },
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

  // Fire-and-forget sourcing pipeline
  void runSourcingPipeline(run.id, session.orgId, session.id, job);

  return NextResponse.json({ runId: run.id });
}

// ─── Sourcing pipeline ────────────────────────────────────────────────────────

async function runSourcingPipeline(
  runId: string,
  orgId: string,
  userId: string,
  job: { rawContent: string; title: string | null }
) {
  try {
    // 1. Parse job description into structured search params
    const searchParams = await parseJobDescription(job.rawContent).catch(() => ({
      title: job.title ?? "Candidate",
      location: null,
      company: null,
      keywords: [] as string[],
    }));

    // 2. Load LinkedIn credentials for this user
    const cred = await prisma.toolCredential.findFirst({
      where: { userId, isActive: true, tool: { slug: "linkedin" } },
      include: { tool: { select: { slug: true } } },
    });

    if (!cred) {
      await prisma.agentRun.update({
        where: { id: runId },
        data: { status: RunStatus.FAILED, endedAt: new Date() },
      });
      const step = await prisma.runStep.create({
        data: {
          runId,
          type: StepType.ERROR,
          content: {
            message:
              "No LinkedIn credentials configured. Go to Integrations to connect your account.",
          },
        },
      });
      publishRunEvent(runId, step);
      return;
    }

    const plain = JSON.parse(decrypt(cred.encryptedCredentials)) as {
      liAt: string;
    };

    // 3. Publish "searching" step so the sidebar shows activity
    const searchStep = await prisma.runStep.create({
      data: {
        runId,
        type: StepType.TOOL_COMPLETE,
        content: {
          tool: "linkedin_scraper",
          summary: `Searching for ${searchParams.title}${
            searchParams.location ? " in " + searchParams.location : ""
          }…`,
        },
      },
    });
    publishRunEvent(runId, searchStep);

    // 4. Run the Playwright LinkedIn scraper
    const candidates = await scrapeLinkedIn(
      { liAt: plain.liAt },
      {
        title: searchParams.title,
        location: searchParams.location,
        keywords: searchParams.keywords,
        limit: 25,
      }
    );

    // 5. Store results and mark completed
    await handleCompletion(runId, orgId, candidates);
  } catch (err) {
    const message =
      err instanceof LinkedInAuthError
        ? `LinkedIn authentication failed: ${err.message}`
        : "Scraping failed. Please try again.";

    console.error("[sourcing pipeline]", err);

    await prisma.agentRun.update({
      where: { id: runId },
      data: { status: RunStatus.FAILED, endedAt: new Date() },
    });
    const step = await prisma.runStep.create({
      data: { runId, type: StepType.ERROR, content: { message } },
    });
    publishRunEvent(runId, step);
  }
}

// ─── Completion handler ───────────────────────────────────────────────────────

async function handleCompletion(
  runId: string,
  orgId: string,
  candidates: LinkedInCandidate[]
) {
  // No LLM cost for Playwright scraping — usage is $0
  const usageCostUsd = 0;
  const usageBilledUsd = 0;

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
