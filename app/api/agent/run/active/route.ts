import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { RunStatus } from "@/app/generated/prisma/client";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!session.orgId) {
    return NextResponse.json({ run: null });
  }

  const run = await prisma.agentRun.findFirst({
    where: {
      orgId: session.orgId,
      status: {
        in: [RunStatus.PENDING, RunStatus.RUNNING],
      },
    },
    orderBy: { startedAt: "desc" },
    select: {
      id: true,
      status: true,
      startedAt: true,
      job: { select: { title: true } },
      steps: {
        orderBy: { createdAt: "asc" },
        select: { id: true, type: true, content: true, createdAt: true },
      },
    },
  });

  return NextResponse.json({ run });
}
