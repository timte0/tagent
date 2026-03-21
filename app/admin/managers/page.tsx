"use client";

import { useState, useEffect, useCallback } from "react";

type OrgInfo = {
  id: string;
  name: string;
  tier: string;
  _count: { users: number };
};

type Manager = {
  id: string;
  email: string;
  isActive: boolean;
  createdAt: string;
  org: OrgInfo | null;
};

export default function ManagersPage() {
  const [managers, setManagers] = useState<Manager[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Invite form state
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteOrgName, setInviteOrgName] = useState("");
  const [inviteTier, setInviteTier] = useState<"STARTER" | "GROWTH" | "SCALE">(
    "STARTER"
  );
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [tempPassword, setTempPassword] = useState<string | null>(null);

  const fetchManagers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/managers");
      if (!res.ok) throw new Error("Failed to load managers");
      const data = await res.json();
      setManagers(data.managers);
    } catch {
      setError("Failed to load managers.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchManagers();
  }, [fetchManagers]);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteLoading(true);
    setInviteError(null);
    setTempPassword(null);

    const res = await fetch("/api/admin/managers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: inviteEmail,
        orgName: inviteOrgName,
        tier: inviteTier,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      setInviteError(data.error ?? "Failed to invite manager.");
      setInviteLoading(false);
      return;
    }

    setTempPassword(data.tempPassword);
    setInviteEmail("");
    setInviteOrgName("");
    setInviteTier("STARTER");
    setInviteLoading(false);
    fetchManagers();
  }

  async function handleToggleActive(manager: Manager) {
    const res = await fetch(`/api/admin/managers/${manager.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !manager.isActive }),
    });
    if (res.ok) {
      fetchManagers();
    }
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Managers</h1>
        <button
          onClick={() => {
            setShowInviteForm((v) => !v);
            setInviteError(null);
            setTempPassword(null);
          }}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
        >
          {showInviteForm ? "Cancel" : "Invite Manager"}
        </button>
      </div>

      {/* Invite form */}
      {showInviteForm && (
        <div className="mb-8 bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
          <h2 className="text-base font-semibold text-gray-900 mb-4">
            Invite a new Manager
          </h2>

          {tempPassword && (
            <div className="mb-4 rounded-lg bg-green-50 border border-green-200 px-4 py-3">
              <p className="text-sm font-semibold text-green-800 mb-1">
                Manager invited! Copy this temporary password — it won&apos;t be shown again.
              </p>
              <code className="text-base font-mono text-green-900 break-all">
                {tempPassword}
              </code>
            </div>
          )}

          {inviteError && (
            <p className="mb-4 text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">
              {inviteError}
            </p>
          )}

          <form onSubmit={handleInvite} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Email
                </label>
                <input
                  type="email"
                  required
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder="manager@company.com"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Org Name
                </label>
                <input
                  type="text"
                  required
                  value={inviteOrgName}
                  onChange={(e) => setInviteOrgName(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder="Acme Corp"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Tier
                </label>
                <select
                  value={inviteTier}
                  onChange={(e) =>
                    setInviteTier(
                      e.target.value as "STARTER" | "GROWTH" | "SCALE"
                    )
                  }
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="STARTER">Starter ($100/mo)</option>
                  <option value="GROWTH">Growth ($200/mo)</option>
                  <option value="SCALE">Scale ($600/mo)</option>
                </select>
              </div>
            </div>
            <div>
              <button
                type="submit"
                disabled={inviteLoading}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {inviteLoading ? "Inviting…" : "Send Invite"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Managers table */}
      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : managers.length === 0 ? (
        <p className="text-sm text-gray-500">No managers yet.</p>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-500">
                  Email
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">
                  Org Name
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">
                  Tier
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">
                  Users
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">
                  Status
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">
                  Created
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {managers.map((m) => (
                <tr key={m.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-900">{m.email}</td>
                  <td className="px-4 py-3 text-gray-700">
                    {m.org?.name ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-700">
                      {m.org?.tier ?? "—"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {m.org?._count?.users ?? 0}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        m.isActive
                          ? "bg-green-100 text-green-700"
                          : "bg-red-100 text-red-700"
                      }`}
                    >
                      {m.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {formatDate(m.createdAt)}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleToggleActive(m)}
                      className={`text-sm font-medium ${
                        m.isActive
                          ? "text-red-600 hover:text-red-800"
                          : "text-green-600 hover:text-green-800"
                      } transition-colors`}
                    >
                      {m.isActive ? "Deactivate" : "Reactivate"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
