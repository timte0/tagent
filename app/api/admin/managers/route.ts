import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { getSession, requireRole, UnauthorizedError } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
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

  const managers = await prisma.user.findMany({
    where: { role: "MANAGER" },
    select: {
      id: true,
      email: true,
      isActive: true,
      createdAt: true,
      org: {
        select: {
          id: true,
          name: true,
          tier: true,
          _count: { select: { users: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ managers });
}

export async function POST(req: NextRequest) {
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

  let email: string, orgName: string, tier: "STARTER" | "GROWTH" | "SCALE" | undefined;
  try {
    ({ email, orgName, tier } = await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!email || !orgName) {
    return NextResponse.json(
      { error: "email and orgName are required" },
      { status: 400 }
    );
  }

  const validTiers = ["STARTER", "GROWTH", "SCALE"];
  const resolvedTier = tier && validTiers.includes(tier) ? tier : "STARTER";

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json(
      { error: "A user with this email already exists" },
      { status: 409 }
    );
  }

  const tempPassword = crypto.randomBytes(8).toString("hex");
  const passwordHash = await bcrypt.hash(tempPassword, 12);

  const [org, manager] = await prisma.$transaction(async (tx) => {
    const newOrg = await tx.org.create({
      data: {
        name: orgName,
        tier: resolvedTier,
        monthlyAllowanceUsd:
          resolvedTier === "GROWTH" ? 160 : resolvedTier === "SCALE" ? 480 : 80,
      },
    });

    const newManager = await tx.user.create({
      data: {
        email,
        passwordHash,
        role: "MANAGER",
        orgId: newOrg.id,
      },
      select: {
        id: true,
        email: true,
        role: true,
        isActive: true,
        createdAt: true,
        orgId: true,
      },
    });

    return [newOrg, newManager];
  });

  return NextResponse.json(
    {
      manager: { ...manager, org: { id: org.id, name: org.name, tier: org.tier } },
      tempPassword,
    },
    { status: 201 }
  );
}
