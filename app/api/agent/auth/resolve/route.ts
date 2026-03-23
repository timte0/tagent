import { NextResponse } from "next/server";
import { resolveAuthContext } from "@/lib/auth-context";

export async function POST(req: Request) {
  // Validate shared secret
  const secret = req.headers.get("x-openclaw-secret");
  if (!secret || secret !== process.env.OPENCLAW_CALLBACK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const { auth_context_id, tool } = body as {
    auth_context_id?: string;
    tool?: string;
    sessionKey?: string;
    agentId?: string;
  };

  if (!auth_context_id) {
    return NextResponse.json(
      { error: "auth_context_id is required" },
      { status: 400 }
    );
  }

  const ctx = resolveAuthContext(auth_context_id);
  if (!ctx) {
    return NextResponse.json(
      {
        status: "failed",
        error: {
          code: "AUTH_CONTEXT_INVALID",
          message: "Auth context could not be resolved or has expired.",
        },
      },
      { status: 404 }
    );
  }

  // Determine which tool's credentials to return
  // tool name from OpenClaw is e.g. "linkedin_scraper" or "linkedin"
  const slug = tool?.replace("_scraper", "").toLowerCase() ?? "";
  const cred = ctx.credentials[slug];

  if (!cred) {
    return NextResponse.json(
      {
        status: "failed",
        error: {
          code: "NO_CREDENTIAL_FOR_TOOL",
          message: `No credential found for tool: ${slug}`,
        },
      },
      { status: 404 }
    );
  }

  return NextResponse.json({
    provider: slug,
    credential_type: "username_password",
    expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    credential: {
      username: cred.email,
      password: cred.password,
    },
    account: {
      label: cred.email,
    },
  });
}
