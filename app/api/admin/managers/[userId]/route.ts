import { NextRequest, NextResponse } from "next/server";
import { getSession, requireRole, UnauthorizedError } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    requireRole(session, "ADMIN");
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    throw e;
  }

  const { userId } = await params;

  let isActive: boolean | undefined;
  try {
    ({ isActive } = await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (isActive === undefined) {
    return NextResponse.json({ error: "isActive is required" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.role !== "MANAGER") {
    return NextResponse.json({ error: "Manager not found" }, { status: 404 });
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { isActive },
    select: {
      id: true,
      email: true,
      role: true,
      isActive: true,
      orgId: true,
    },
  });

  return NextResponse.json({ manager: updated });
}
