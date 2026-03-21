import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import SettingsClient from "./SettingsClient";

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <SettingsClient
      role={session.role}
      orgId={session.orgId ?? null}
      userId={session.id}
    />
  );
}
