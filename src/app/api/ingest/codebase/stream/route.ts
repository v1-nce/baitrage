import { getCodebaseIngestionStatus, startCodebaseIngestion } from "@/server/codebase-ingestor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  const encoder = new TextEncoder();
  let closed = false;
  let lastPayload = "";
  let statusTimer: ReturnType<typeof setInterval> | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  const close = () => {
    closed = true;
    if (statusTimer) { clearInterval(statusTimer); statusTimer = null; }
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
  };

  const stream = new ReadableStream({
    async start(controller) {
      const emit = async (force = false) => {
        if (closed) return;
        const status = await getCodebaseIngestionStatus();
        const payload = JSON.stringify(status);
        if (!force && payload === lastPayload) return;
        lastPayload = payload;
        controller.enqueue(encoder.encode(`event: status\ndata: ${payload}\n\n`));
      };

      const status = await startCodebaseIngestion();
      lastPayload = JSON.stringify(status);
      controller.enqueue(encoder.encode(`event: status\ndata: ${lastPayload}\n\n`));

      statusTimer = setInterval(() => void emit(), 1000);
      heartbeatTimer = setInterval(() => { if (!closed) controller.enqueue(encoder.encode(": heartbeat\n\n")); }, 15_000);
    },
    cancel() { close(); },
  });

  return new Response(stream, {
    headers: { "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "Content-Type": "text/event-stream" },
  });
}
