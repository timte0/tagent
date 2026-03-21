import Link from "next/link";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside className="w-56 bg-gray-800 flex flex-col">
        <div className="px-5 py-6 border-b border-gray-700">
          <span className="text-white font-bold text-lg tracking-tight">
            tagent
          </span>
          <span className="ml-2 text-xs text-gray-400 uppercase tracking-widest">
            admin
          </span>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          <Link
            href="/admin/managers"
            className="flex items-center px-3 py-2 text-sm text-gray-300 rounded-md hover:bg-gray-700 hover:text-white transition-colors"
          >
            Managers
          </Link>
        </nav>
        <div className="px-3 py-4 border-t border-gray-700">
          <Link
            href="/dashboard"
            className="flex items-center px-3 py-2 text-sm text-gray-400 rounded-md hover:bg-gray-700 hover:text-white transition-colors"
          >
            &larr; Back to app
          </Link>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 bg-gray-50">{children}</main>
    </div>
  );
}
