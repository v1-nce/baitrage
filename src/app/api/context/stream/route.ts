import { readCursorActiveFile } from "@/server/cursor-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const POLL_INTERVAL_MS = 1500;

export function GET() {
  const encoder = new TextEncoder();
  let closed = false;
  let lastSignature = "";

  const stream = new ReadableStream({
    async start(controller) {
      const emit = async () => {
        if (closed) {
          return;
        }

        const activeFile = await readCursorActiveFile();
        if (!activeFile) {
          return;
        }

        const signature = `${activeFile.path}:${activeFile.updatedAt}:${activeFile.content?.length ?? 0}`;
        if (signature === lastSignature) {
          return;
        }

        lastSignature = signature;
        controller.enqueue(
          encoder.encode(`event: active-file\ndata: ${JSON.stringify(activeFile)}\n\n`)
        );
      };

      await emit();
      const timer = setInterval(() => {
        void emit();
      }, POLL_INTERVAL_MS);

      return () => {
        closed = true;
        clearInterval(timer);
      };
    },
    cancel() {
      closed = true;
    }
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream"
    }
  });
}
