export async function triggerAgentRun({
  message,
  sessionKey,
  agentId = "sourcing",
  timeoutSeconds = 600,
}: {
  message: string;
  sessionKey: string;
  agentId?: string;
  timeoutSeconds?: number;
}): Promise<void> {
  const res = await fetch(`${process.env.OPENCLAW_URL}/hooks/agent`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENCLAW_HOOKS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message,
      name: "SourcingRun",
      sessionKey,
      agentId,
      timeoutSeconds,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenClaw trigger failed: ${res.status} ${body}`);
  }
}

export async function resumeAgentRun({
  sessionKey,
  message,
}: {
  sessionKey: string;
  message: string;
}): Promise<void> {
  const res = await fetch(`${process.env.OPENCLAW_URL}/hooks/agent`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENCLAW_HOOKS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message,
      sessionKey,
      agentId: "sourcing",
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenClaw resume failed: ${res.status} ${body}`);
  }
}
