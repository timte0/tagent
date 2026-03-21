import { NextRequest, NextResponse } from "next/server";
import { getSession, requireRole, UnauthorizedError } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ orgId: string; userId: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { orgId, userId } = await params;

  try {
    requireRole(session, "MANAGER");
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    throw e;
  }

  if (session.orgId !== orgId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Cannot modify yourself
  if (session.id === userId) {
    return NextResponse.json(
      { error: "You cannot modify your own account" },
      { status: 400 }
    );
  }

  let role: "USER" | "MANAGER" | undefined;
  let isActive: boolean | undefined;
  try {
    ({ role, isActive } = await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (role === undefined && isActive === undefined) {
    return NextResponse.json(
      { error: "At least one of role or isActive is required" },
      { status: 400 }
    );
  }

  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target || target.orgId !== orgId) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // Cannot modify another MANAGER (prevent demotion)
  if (target.role === "MANAGER" && role !== undefined && role !== "MANAGER") {
    return NextResponse.json(
      { error: "Cannot demote a Manager" },
      { status: 400 }
    );
  }

  const validRoles = ["USER", "MANAGER"];
  if (role !== undefined && !validRoles.includes(role)) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }

  const data: { role?: "USER" | "MANAGER"; isActive?: boolean } = {};
  if (role !== undefined) data.role = role;
  if (isActive !== undefined) data.isActive = isActive;

  const updated = await prisma.user.update({
    where: { id: userId },
    data,
    select: {
      id: true,
      email: true,
      role: true,
      isActive: true,
      orgId: true,
    },
  });

  return NextResponse.json({ user: updated });
}
