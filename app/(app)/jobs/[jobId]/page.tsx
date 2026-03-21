import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import RunAgentButton from "@/components/RunAgentButton";

function formatDate(date: Date) {
  return new Date(date).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const STATUS_STYLES: Record<string, string> = {
  PENDING: "bg-gray-100 text-gray-600",
  RUNNING: "bg-blue-100 text-blue-700",
  PAUSED_FOR_APPROVAL: "bg-yellow-100 text-yellow-700",
  COMPLETED: "bg-green-100 text-green-700",
  FAILED: "bg-red-100 text-red-700",
};

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { jobId } = await params;

  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: {
      user: { select: { email: true } },
      runs: {
        orderBy: { startedAt: "desc" },
        select: {
          id: true,
          status: true,
          startedAt: true,
          endedAt: true,
          usageBilledUsd: true,
        },
      },
    },
  });

  if (!job) notFound();
  if (session.role !== "ADMIN" && job.orgId !== session.orgId) notFound();

  const previewLength = 800;
  const contentPreview =
    job.rawContent.length > previewLength
      ? job.rawContent.slice(0, previewLength) + "…"
      : job.rawContent;

  return (
    <main className="p-8 max-w-4xl mx-auto">
      <div className="mb-6">
        <Link
          href="/jobs"
          className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          ← Back to Jobs
        </Link>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {job.title ?? <span className="text-gray-400 italic font-normal">Untitled</span>}
          </h1>
          <div className="mt-2 flex items-center gap-3 text-sm text-gray-500">
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                job.sourceType === "PDF"
                  ? "bg-orange-100 text-orange-700"
                  : "bg-blue-100 text-blue-700"
              }`}
            >
              {job.sourceType}
            </span>
            <span>Created by {job.user.email}</span>
            <span>{formatDate(job.createdAt)}</span>
          </div>
          {job.sourceUrl && (
            <a
              href={job.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-block text-sm text-blue-600 hover:underline break-all"
            >
              {job.sourceUrl}
            </a>
          )}
        </div>

        <RunAgentButton jobId={job.id} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Content preview */}
        <div className="lg:col-span-2">
          <h2 className="text-sm font-semibold text-gray-700 mb-2 uppercase tracking-wide">
            Job Description Preview
          </h2>
          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
            <pre className="text-xs text-gray-700 whitespace-pre-wrap font-mono leading-relaxed">
              {contentPreview}
            </pre>
            {job.rawContent.length > previewLength && (
              <p className="mt-3 text-xs text-gray-400">
                {job.rawContent.length.toLocaleString()} characters total — preview truncated.
              </p>
            )}
          </div>
        </div>

        {/* Runs */}
        <div>
          <h2 className="text-sm font-semibold text-gray-700 mb-2 uppercase tracking-wide">
            Agent Runs
          </h2>
          {job.runs.length === 0 ? (
            <div className="bg-white border border-dashed border-gray-300 rounded-xl p-6 text-center text-sm text-gray-400">
              No runs yet.
            </div>
          ) : (
            <div className="space-y-3">
              {job.runs.map((run) => (
                <div
                  key={run.id}
                  className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        STATUS_STYLES[run.status] ?? "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {run.status}
                    </span>
                    {run.usageBilledUsd > 0 && (
                      <span className="text-xs text-gray-500">
                        ${run.usageBilledUsd.toFixed(4)}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500">
                    {formatDate(run.startedAt)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
