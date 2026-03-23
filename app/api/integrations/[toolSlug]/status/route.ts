import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ toolSlug: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { toolSlug } = await params;

  const tool = await prisma.tool.findUnique({ where: { slug: toolSlug } });
  if (!tool) {
    return NextResponse.json({ error: "Tool not found" }, { status: 404 });
  }

  const cred = await prisma.toolCredential.findUnique({
    where: { userId_toolId: { userId: session.id, toolId: tool.id } },
    select: { isActive: true },
  });

  // null = no credential (test hasn't started or row was deleted)
  return NextResponse.json({ isActive: cred?.isActive ?? null });
}
