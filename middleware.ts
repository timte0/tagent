import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

// Defined locally to avoid importing the Prisma client in Edge Runtime
type Role = "ADMIN" | "MANAGER" | "USER";

const secret = new TextEncoder().encode(process.env.JWT_SECRET!);

async function getSessionUser(
  token: string
): Promise<{ role: Role } | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    return payload as unknown as { role: Role };
  } catch {
    return null;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Always public
  if (
    pathname.startsWith("/api/auth/") ||
    pathname === "/api/agent/callback" ||
    pathname === "/api/agent/auth/resolve" ||
    pathname === "/api/billing/webhook" ||
    pathname === "/login"
  ) {
    return NextResponse.next();
  }

  const token = req.cookies.get("token")?.value;
  const user = token ? await getSessionUser(token) : null;

  // Admin routes
  if (pathname.startsWith("/admin") || pathname.startsWith("/api/admin/")) {
    if (!user) {
      return pathname.startsWith("/api/")
        ? NextResponse.json({ error: "Unauthorized" }, { status: 401 })
        : NextResponse.redirect(new URL("/login", req.url));
    }
    if (user.role !== "ADMIN") {
      return pathname.startsWith("/api/")
        ? NextResponse.json({ error: "Forbidden" }, { status: 403 })
        : NextResponse.redirect(new URL("/dashboard", req.url));
    }
    return NextResponse.next();
  }

  // App routes require authentication
  const isAppRoute =
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/jobs") ||
    pathname.startsWith("/integrations") ||
    pathname.startsWith("/settings") ||
    pathname.startsWith("/billing");

  const isProtectedApi =
    pathname.startsWith("/api/") &&
    !pathname.startsWith("/api/auth/");

  if (isAppRoute || isProtectedApi) {
    if (!user) {
      return pathname.startsWith("/api/")
        ? NextResponse.json({ error: "Unauthorized" }, { status: 401 })
        : NextResponse.redirect(new URL("/login", req.url));
    }
  }

  // Redirect logged-in users away from login
  if (pathname === "/login" && user) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
