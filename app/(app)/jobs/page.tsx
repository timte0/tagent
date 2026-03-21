import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { redirect } from "next/navigation";

function formatDate(date: Date) {
  return new Date(date).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default async function JobsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.orgId) {
    return (
      <main className="p-8">
        <p className="text-sm text-gray-500">No organization assigned.</p>
      </main>
    );
  }

  const jobs = await prisma.job.findMany({
    where: { orgId: session.orgId },
    orderBy: { createdAt: "desc" },
    include: {
      user: { select: { email: true } },
      _count: { select: { runs: true } },
    },
  });

  return (
    <main className="p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Jobs</h1>
        <Link
          href="/jobs/new"
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
        >
          New Job
        </Link>
      </div>

      {jobs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white px-8 py-16 text-center">
          <p className="text-gray-500 text-sm">No jobs yet.</p>
          <Link
            href="/jobs/new"
            className="mt-4 inline-block rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
          >
            Upload your first job description
          </Link>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-500">
                  Title
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">
                  Source
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">
                  Created by
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">
                  Date
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">
                  Runs
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {jobs.map((job) => (
                <tr key={job.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/jobs/${job.id}`}
                      className="font-medium text-blue-600 hover:text-blue-800 transition-colors"
                    >
                      {job.title ?? <span className="text-gray-400 font-normal italic">Untitled</span>}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        job.sourceType === "PDF"
                          ? "bg-orange-100 text-orange-700"
                          : "bg-blue-100 text-blue-700"
                      }`}
                    >
                      {job.sourceType}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{job.user.email}</td>
                  <td className="px-4 py-3 text-gray-500">
                    {formatDate(job.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {job._count.runs}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
