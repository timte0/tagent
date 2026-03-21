import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { subscribeToRun } from "@/lib/sse";
import { RunStatus } from "@/app/generated/prisma/client";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ runId: string }> }
) {
  const session = await getSession();
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { runId } = await params;

  const run = await prisma.agentRun.findUnique({
    where: { id: runId },
    include: {
      steps: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!run) {
    return new Response("Run not found", { status: 404 });
  }

  if (session.role !== "ADMIN" && run.orgId !== session.orgId) {
    return new Response("Forbidden", { status: 403 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: object) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          // Controller already closed
        }
      };

      // Send catch-up: all existing steps
      for (const step of run.steps) {
        send(step);
      }

      // If already terminal, close immediately
      if (
        run.status === RunStatus.COMPLETED ||
        run.status === RunStatus.FAILED
      ) {
        send({ __type: "close" });
        controller.close();
        return;
      }

      // Subscribe to future events
      const unsubscribe = subscribeToRun(runId, (data) => {
        send(data);
        const d = data as { type?: string };
        if (d.type === "COMPLETED" || d.type === "ERROR") {
          unsubscribe();
          try {
            controller.close();
          } catch {
            // already closed
          }
        }
      });

      // Clean up when client disconnects
      req.signal.addEventListener("abort", () => {
        unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // disable Nginx buffering on VPS
    },
  });
}
