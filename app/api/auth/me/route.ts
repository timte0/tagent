import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let org: { id: string; name: string; tier: string } | null = null;
  if (session.orgId) {
    const orgRecord = await prisma.org.findUnique({
      where: { id: session.orgId },
      select: { id: true, name: true, tier: true },
    });
    if (orgRecord) {
      org = orgRecord;
    }
  }

  return NextResponse.json({
    id: session.id,
    email: session.email,
    role: session.role,
    orgId: session.orgId,
    org,
  });
}
