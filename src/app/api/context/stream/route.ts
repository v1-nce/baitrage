import { readCursorActiveFile } from "@/server/cursor-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const POLL_INTERVAL_MS = 1500;

export function GET() {
  const encoder = new TextEncoder();
  let closed = false;
  let lastSig = "";

  const stream = new ReadableStream({
    async start(controller) {
      const emit = async () => {
        if (closed) return;
        const file = await readCursorActiveFile();
        if (!file) return;
        const sig = `${file.path}:${file.updatedAt}:${file.content?.length ?? 0}`;
        if (sig === lastSig) return;
        lastSig = sig;
        controller.enqueue(encoder.encode(`event: active-file\ndata: ${JSON.stringify(file)}\n\n`));
      };

      await emit();
      const timer = setInterval(() => void emit(), POLL_INTERVAL_MS);
      return () => { closed = true; clearInterval(timer); };
    },
    cancel() { closed = true; },
  });

  return new Response(stream, {
    headers: { "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "Content-Type": "text/event-stream" },
  });
}
