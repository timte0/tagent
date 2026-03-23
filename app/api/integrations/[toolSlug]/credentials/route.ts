import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { encrypt } from "@/lib/crypto";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ toolSlug: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!session.orgId) {
    return NextResponse.json({ error: "No organisation" }, { status: 403 });
  }

  const { toolSlug } = await params;

  const body = await req.json().catch(() => ({}));
  const { email, password } = body as { email?: string; password?: string };

  if (!email || !password) {
    return NextResponse.json(
      { error: "email and password are required" },
      { status: 400 }
    );
  }
  if (!email.includes("@")) {
    return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
  }

  const tool = await prisma.tool.findUnique({
    where: { slug: toolSlug },
    include: { orgTools: { where: { orgId: session.orgId } } },
  });

  if (!tool) {
    return NextResponse.json({ error: "Tool not found" }, { status: 404 });
  }
  if (!tool.isGloballyEnabled) {
    return NextResponse.json({ error: "Tool is not available" }, { status: 403 });
  }
  if (tool.orgTools[0]?.isEnabled !== true) {
    return NextResponse.json(
      { error: "Tool is not enabled for your organisation" },
      { status: 403 }
    );
  }

  const encryptedCredentials = encrypt(JSON.stringify({ email, password }));

  await prisma.toolCredential.upsert({
    where: { userId_toolId: { userId: session.id, toolId: tool.id } },
    create: { userId: session.id, toolId: tool.id, encryptedCredentials, isActive: true },
    update: { encryptedCredentials, isActive: true },
  });

  return NextResponse.json({ status: "saved" });
}

export async function DELETE(
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

  await prisma.toolCredential.deleteMany({
    where: { userId: session.id, toolId: tool.id },
  });

  return new Response(null, { status: 204 });
}
