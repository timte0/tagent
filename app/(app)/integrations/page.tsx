import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import IntegrationsClient from "./IntegrationsClient";

export type ToolWithStatus = {
  id: string;
  name: string;
  slug: string;
  authType: string;
  orgEnabled: boolean;
  credential: { id: string; isActive: boolean; createdAt: string } | null;
};

export default async function IntegrationsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  if (!session.orgId) {
    return (
      <main className="p-8 max-w-3xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Integrations</h1>
        <p className="text-sm text-gray-500">
          Tool integrations are managed at the organisation level.
        </p>
      </main>
    );
  }

  const tools = await prisma.tool.findMany({
    where: { isGloballyEnabled: true },
    include: {
      orgTools: { where: { orgId: session.orgId } },
      credentials: { where: { userId: session.id } },
    },
    orderBy: { name: "asc" },
  });

  const toolsWithStatus: ToolWithStatus[] = tools.map((t) => ({
    id: t.id,
    name: t.name,
    slug: t.slug,
    authType: t.authType,
    orgEnabled: t.orgTools[0]?.isEnabled ?? false,
    credential: t.credentials[0]
      ? {
          id: t.credentials[0].id,
          isActive: t.credentials[0].isActive,
          createdAt: t.credentials[0].createdAt.toISOString(),
        }
      : null,
  }));

  return (
    <main className="p-8 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Integrations</h1>
      <p className="text-sm text-gray-500 mb-8">
        Connect your accounts to allow the agent to source candidates.
      </p>
      <IntegrationsClient tools={toolsWithStatus} />
    </main>
  );
}
