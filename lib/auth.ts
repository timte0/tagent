import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { Role } from "@/app/generated/prisma/client";

export type SessionUser = {
  id: string;
  email: string;
  role: Role;
  orgId: string | null;
};

const secret = new TextEncoder().encode(process.env.JWT_SECRET!);

export async function signToken(user: SessionUser): Promise<string> {
  return new SignJWT({ ...user })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("7d")
    .sign(secret);
}

export async function verifyToken(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    return payload as unknown as SessionUser;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get("token")?.value;
  if (!token) return null;
  return verifyToken(token);
}

export class UnauthorizedError extends Error {
  status = 401;
  constructor() {
    super("Unauthorized");
  }
}

export function requireRole(user: SessionUser, ...roles: Role[]): void {
  if (!roles.includes(user.role)) throw new UnauthorizedError();
}
