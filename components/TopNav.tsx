"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type MeResponse = {
  email: string;
  role: string;
};

export default function TopNav() {
  const router = useRouter();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setMe(data);
      })
      .catch(() => null);
  }, []);

  async function handleLogout() {
    setLoggingOut(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <header className="h-14 bg-white border-b border-gray-200 flex items-center px-6 gap-6">
      {/* Logo */}
      <Link
        href="/dashboard"
        className="text-base font-bold text-gray-900 tracking-tight shrink-0"
      >
        tagent
      </Link>

      {/* Nav links */}
      <nav className="flex items-center gap-1 flex-1">
        <NavLink href="/dashboard">Dashboard</NavLink>
        <NavLink href="/jobs">Jobs</NavLink>
        <NavLink href="/integrations">Integrations</NavLink>
        <NavLink href="/settings">Settings</NavLink>
        <NavLink href="/billing">Billing</NavLink>
      </nav>

      {/* Right: user email + logout */}
      <div className="flex items-center gap-4 shrink-0">
        {me && (
          <span className="text-sm text-gray-500 hidden sm:block">{me.email}</span>
        )}
        <button
          onClick={handleLogout}
          disabled={loggingOut}
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
        >
          {loggingOut ? "Logging out…" : "Logout"}
        </button>
      </div>
    </header>
  );
}

function NavLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="px-3 py-1.5 rounded-md text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors"
    >
      {children}
    </Link>
  );
}
