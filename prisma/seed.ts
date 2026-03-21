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

  // ── LinkedIn tool ────────────────────────────────────────────────────────────
  const linkedin = await prisma.tool.upsert({
    where: { slug: "linkedin" },
    update: {},
    create: {
      name: "LinkedIn",
      slug: "linkedin",
      authType: AuthType.USER_CREDENTIALS,
      isGloballyEnabled: false,
    },
  });
  console.log(`✓ Tool seeded: ${linkedin.name} (${linkedin.slug})`);

  // ── HelloWork tool ───────────────────────────────────────────────────────────
  const hellowork = await prisma.tool.upsert({
    where: { slug: "hellowork" },
    update: {},
    create: {
      name: "HelloWork",
      slug: "hellowork",
      authType: AuthType.USER_CREDENTIALS,
      isGloballyEnabled: false,
    },
  });
  console.log(`✓ Tool seeded: ${hellowork.name} (${hellowork.slug})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
