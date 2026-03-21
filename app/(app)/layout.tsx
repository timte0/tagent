import TopNav from "@/components/TopNav";
import AgentSidebar from "@/components/AgentSidebar";
import { AgentRunProvider } from "@/components/AgentRunContext";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AgentRunProvider>
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <TopNav />
        <div className="flex flex-1">
          <AgentSidebar />
          <div className="flex-1 min-w-0">{children}</div>
        </div>
      </div>
    </AgentRunProvider>
  );
}
