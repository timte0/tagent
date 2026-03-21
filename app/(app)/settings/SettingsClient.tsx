"use client";

import { useState, useEffect, useCallback } from "react";

type TeamMember = {
  id: string;
  email: string;
  role: string;
  isActive: boolean;
  createdAt: string;
};

type Props = {
  role: string;
  orgId: string | null;
  userId: string;
};

export default function SettingsClient({ role, orgId, userId }: Props) {
  const [activeTab, setActiveTab] = useState<"account" | "team">("account");

  const isManager = role === "MANAGER";

  return (
    <main className="p-8 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Settings</h1>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="-mb-px flex gap-6">
          <button
            onClick={() => setActiveTab("account")}
            className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "account"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            Account
          </button>
          {isManager && orgId && (
            <button
              onClick={() => setActiveTab("team")}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === "team"
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              Team
            </button>
          )}
        </nav>
      </div>

      {activeTab === "account" && <AccountTab />}
      {activeTab === "team" && isManager && orgId && (
        <TeamTab orgId={orgId} currentUserId={userId} />
      )}
    </main>
  );
}

/* ─── Account Tab ─────────────────────────────────────────── */

function AccountTab() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (newPassword !== confirmPassword) {
      setError("New passwords do not match.");
      return;
    }
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }

    setLoading(true);
    const res = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      setError(data.error ?? "Failed to change password.");
      return;
    }

    setSuccess(true);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
  }

  return (
    <div>
      <h2 className="text-base font-semibold text-gray-900 mb-4">
        Change Password
      </h2>
      <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm max-w-md">
        {success && (
          <p className="mb-4 text-sm text-green-700 bg-green-50 rounded-md px-3 py-2">
            Password updated successfully.
          </p>
        )}
        {error && (
          <p className="mb-4 text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">
            {error}
          </p>
        )}
        <form onSubmit={handleChangePassword} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Current password
            </label>
            <input
              type="password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              New password
            </label>
            <input
              type="password"
              required
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Confirm new password
            </label>
            <input
              type="password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? "Saving…" : "Update password"}
          </button>
        </form>
      </div>
    </div>
  );
}

/* ─── Team Tab ────────────────────────────────────────────── */

function TeamTab({
  orgId,
  currentUserId,
}: {
  orgId: string;
  currentUserId: string;
}) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [membersError, setMembersError] = useState<string | null>(null);

  // Invite form
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [tempPassword, setTempPassword] = useState<string | null>(null);

  const fetchMembers = useCallback(async () => {
    setLoadingMembers(true);
    setMembersError(null);
    try {
      const res = await fetch(`/api/orgs/${orgId}/users`);
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setMembers(data.users);
    } catch {
      setMembersError("Failed to load team members.");
    } finally {
      setLoadingMembers(false);
    }
  }, [orgId]);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteLoading(true);
    setInviteError(null);
    setTempPassword(null);

    const res = await fetch(`/api/orgs/${orgId}/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: inviteEmail }),
    });
    const data = await res.json();
    setInviteLoading(false);

    if (!res.ok) {
      setInviteError(data.error ?? "Failed to invite user.");
      return;
    }

    setTempPassword(data.tempPassword);
    setInviteEmail("");
    fetchMembers();
  }

  async function handlePromote(member: TeamMember) {
    const res = await fetch(`/api/orgs/${orgId}/users/${member.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "MANAGER" }),
    });
    if (res.ok) fetchMembers();
  }

  async function handleToggleActive(member: TeamMember) {
    const res = await fetch(`/api/orgs/${orgId}/users/${member.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !member.isActive }),
    });
    if (res.ok) fetchMembers();
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-gray-900">Team Members</h2>
        <button
          onClick={() => {
            setShowInvite((v) => !v);
            setInviteError(null);
            setTempPassword(null);
          }}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
        >
          {showInvite ? "Cancel" : "Invite User"}
        </button>
      </div>

      {/* Invite form */}
      {showInvite && (
        <div className="mb-6 bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
          {tempPassword && (
            <div className="mb-4 rounded-lg bg-green-50 border border-green-200 px-4 py-3">
              <p className="text-sm font-semibold text-green-800 mb-1">
                User invited! Copy this temporary password — it won&apos;t be shown again.
              </p>
              <code className="text-base font-mono text-green-900 break-all">
                {tempPassword}
              </code>
            </div>
          )}
          {inviteError && (
            <p className="mb-3 text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">
              {inviteError}
            </p>
          )}
          <form onSubmit={handleInvite} className="flex gap-3 items-end">
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Email
              </label>
              <input
                type="email"
                required
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="user@company.com"
              />
            </div>
            <button
              type="submit"
              disabled={inviteLoading}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {inviteLoading ? "Inviting…" : "Invite"}
            </button>
          </form>
        </div>
      )}

      {/* Members table */}
      {loadingMembers ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : membersError ? (
        <p className="text-sm text-red-600">{membersError}</p>
      ) : members.length === 0 ? (
        <p className="text-sm text-gray-500">No team members yet.</p>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-500">
                  Email
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">
                  Role
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">
                  Status
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">
                  Joined
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {members.map((m) => {
                const isSelf = m.id === currentUserId;
                return (
                  <tr key={m.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-900">{m.email}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-700">
                        {m.role}
                      </span>
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
                      {isSelf ? (
                        <span className="text-xs text-gray-400">You</span>
                      ) : (
                        <div className="flex items-center gap-3">
                          {m.role === "USER" && (
                            <button
                              onClick={() => handlePromote(m)}
                              className="text-sm font-medium text-blue-600 hover:text-blue-800 transition-colors"
                            >
                              Promote to Manager
                            </button>
                          )}
                          <button
                            onClick={() => handleToggleActive(m)}
                            className={`text-sm font-medium transition-colors ${
                              m.isActive
                                ? "text-red-600 hover:text-red-800"
                                : "text-green-600 hover:text-green-800"
                            }`}
                          >
                            {m.isActive ? "Deactivate" : "Reactivate"}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
