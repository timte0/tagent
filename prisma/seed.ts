import { PrismaClient } from "../app/generated/prisma/client";
import { AuthType, Role } from "../app/generated/prisma/enums";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  // ── ADMIN user ──────────────────────────────────────────────────────────────
  const adminEmail = "admin@tagent.local";
  const adminPassword = "changeme_admin_123!";

  const existingAdmin = await prisma.user.findUnique({
    where: { email: adminEmail },
  });

  if (!existingAdmin) {
    const passwordHash = await bcrypt.hash(adminPassword, 12);
    await prisma.user.create({
      data: {
        email: adminEmail,
        passwordHash,
        role: Role.ADMIN,
        orgId: null,
        isActive: true,
      },
    });
    console.log(`✓ Created ADMIN user: ${adminEmail} / ${adminPassword}`);
  } else {
    console.log(`✓ ADMIN user already exists: ${adminEmail}`);
  }

  // ── Demo org + MANAGER user ──────────────────────────────────────────────────
  const managerEmail = "manager@tagent.local";
  const managerPassword = "changeme_manager_123!";

  let demoOrg = await prisma.org.findFirst({ where: { name: "Demo Org" } });
  if (!demoOrg) {
    demoOrg = await prisma.org.create({
      data: {
        name: "Demo Org",
        tier: "STARTER",
        monthlyAllowanceUsd: 80,
        additionalCreditsUsd: 0,
      },
    });
    console.log(`✓ Created org: ${demoOrg.name}`);
  } else {
    console.log(`✓ Org already exists: ${demoOrg.name}`);
  }

  const existingManager = await prisma.user.findUnique({ where: { email: managerEmail } });
  if (!existingManager) {
    const passwordHash = await bcrypt.hash(managerPassword, 12);
    await prisma.user.create({
      data: {
        email: managerEmail,
        passwordHash,
        role: Role.MANAGER,
        orgId: demoOrg.id,
        isActive: true,
      },
    });
    console.log(`✓ Created MANAGER user: ${managerEmail} / ${managerPassword}`);
  } else {
    console.log(`✓ MANAGER user already exists: ${managerEmail}`);
  }

  // ── LinkedIn tool ────────────────────────────────────────────────────────────
  const linkedin = await prisma.tool.upsert({
    where: { slug: "linkedin" },
    update: { isGloballyEnabled: true },
    create: {
      name: "LinkedIn",
      slug: "linkedin",
      authType: AuthType.USER_CREDENTIALS,
      isGloballyEnabled: true,
    },
  });
  console.log(`✓ Tool seeded: ${linkedin.name} (${linkedin.slug})`);

  // ── HelloWork tool ───────────────────────────────────────────────────────────
  const hellowork = await prisma.tool.upsert({
    where: { slug: "hellowork" },
    update: { isGloballyEnabled: true },
    create: {
      name: "HelloWork",
      slug: "hellowork",
      authType: AuthType.USER_CREDENTIALS,
      isGloballyEnabled: true,
    },
  });
  console.log(`✓ Tool seeded: ${hellowork.name} (${hellowork.slug})`);

  // ── OrgTool entries for demo org ─────────────────────────────────────────────
  for (const tool of [linkedin, hellowork]) {
    await prisma.orgTool.upsert({
      where: { orgId_toolId: { orgId: demoOrg.id, toolId: tool.id } },
      update: { isEnabled: true },
      create: { orgId: demoOrg.id, toolId: tool.id, isEnabled: true },
    });
    console.log(`✓ OrgTool enabled: ${tool.name} for ${demoOrg.name}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
