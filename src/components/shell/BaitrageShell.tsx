"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Clipboard, MonitorUp, Power, PowerOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useMultimodal, type MultimodalState } from "@/hooks/useMultimodal";

type CircuitTone = "idle" | "warning" | "lockout";

export function BaitrageShell() {
  const multimodal = useMultimodal();
  const tone = getTone(multimodal);

  return (
    <main className="h-screen w-screen overflow-hidden bg-[var(--tertiary)] p-4 text-[var(--neutral)]" style={{ fontFamily: '"Stardom", system-ui, sans-serif' }}>
      <section className="mx-auto flex h-full max-w-6xl flex-col gap-4 rounded-xl border border-[var(--neutral)]/10 bg-white p-3 shadow-sm">
        <HeroFeed multimodal={multimodal} tone={tone} />

        <section className="grid min-h-0 flex-1 gap-4 md:grid-cols-[0.36fr_1fr]">
          <AdvicePanel multimodal={multimodal} />
          <PromptPanel multimodal={multimodal} />
        </section>
      </section>

      <AnimatePresence>
        {multimodal.isLocked ? (
          <motion.div
            className="pointer-events-none fixed inset-x-0 top-0 z-50 border-b border-[var(--secondary)] bg-[var(--secondary)] px-4 py-2 text-center text-xs font-semibold uppercase tracking-[0.24em] text-white shadow-md"
            initial={{ y: -40 }}
            animate={{ y: 0 }}
            exit={{ y: -40 }}
          >
            Stop! You got ragebaited!
          </motion.div>
        ) : null}
      </AnimatePresence>
    </main>
  );
}

/* ------------------------------------------------------------------ */
/*  Hero: Camera feed + status + audio bar                            */
/* ------------------------------------------------------------------ */

function HeroFeed({ multimodal, tone }: { multimodal: MultimodalState; tone: CircuitTone }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = multimodal.mediaStream;
    }
  }, [multimodal.mediaStream]);

  return (
    <section className={`relative h-[55vh] shrink-0 overflow-hidden rounded-lg bg-[var(--primary)] ${glowClass[tone]}`}>
      <video ref={videoRef} className="h-full w-full object-cover opacity-90 mix-blend-multiply" autoPlay muted playsInline />

      {!multimodal.mediaStream ? (
        <div className="absolute inset-0" />
      ) : null}

      {/* Top-left controls */}
      <div className="absolute left-4 top-4 flex gap-2">
        <button className="icon-btn" onClick={multimodal.isCapturing ? multimodal.stop : multimodal.start} title="Capture">
          {multimodal.isCapturing ? <PowerOff /> : <Power />}
        </button>
        <button className="icon-btn" onClick={multimodal.startScreenShare} title="Screen share">
          <MonitorUp />
        </button>
      </div>

      {/* Bottom-left: frustration % */}
      <div className="absolute bottom-4 left-4 flex items-end gap-3">
        <FrustrationBadge frustration={multimodal.frustration} />
      </div>

      {/* Bottom-right: audio bar */}
      <div className="absolute bottom-4 right-4 flex items-end gap-3">
        <AudioBar level={multimodal.audioLevel} isCapturing={multimodal.isCapturing} />
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Audio bar — real-time microphone level visualization              */
/* ------------------------------------------------------------------ */

function AudioBar({ level, isCapturing }: { level: number; isCapturing: boolean }) {
  const BAR_COUNT = 16;

  if (!isCapturing) return null;

  return (
    <div
      className="flex items-end gap-[2px] rounded border border-white/20 bg-black/55 px-2.5 py-2"
      title={`Audio level: ${(level * 100).toFixed(0)}%`}
    >
      {Array.from({ length: BAR_COUNT }).map((_, index) => {
        const barThreshold = (index + 1) / BAR_COUNT;
        const active = level >= barThreshold;
        const isHot = barThreshold > 0.7;
        const isWarm = barThreshold > 0.45;

        return (
          <motion.div
            key={index}
            className="w-[3px] rounded-sm"
            style={{
              backgroundColor: active
                ? isHot
                  ? "#ef4444"
                  : isWarm
                    ? "#f59e0b"
                    : "#22c55e"
                : "rgba(255,255,255,0.15)",
              minHeight: 4,
            }}
            animate={{
              height: active ? 6 + index * 1.3 : 4,
              opacity: active ? 1 : 0.3,
            }}
            transition={{ duration: 0.06, ease: "easeOut" }}
          />
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Frustration % badge                                               */
/* ------------------------------------------------------------------ */

function FrustrationBadge({ frustration }: { frustration: number }) {
  const pct = Math.round(frustration * 100);
  const color =
    pct > 70
      ? "bg-red-600 text-white"
      : pct > 40
        ? "bg-amber-500 text-black"
        : pct > 10
          ? "bg-emerald-600 text-white"
          : "bg-[var(--neutral)]/10 text-[var(--neutral)]/70";

  return (
    <div className={`rounded px-2.5 py-1.5 text-xs font-mono tabular-nums font-medium ${color}`}>
      {pct}%
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Advice panel                                                      */
/* ------------------------------------------------------------------ */

function AdvicePanel({ multimodal }: { multimodal: MultimodalState }) {
  const text =
    multimodal.pivotPrompt?.advice ??
    multimodal.pivotPrompt?.summary ??
    (multimodal.isRecalibrating
      ? "Analysing your speech and screen to generate a codebase-aware prompt."
      : multimodal.isLocked
        ? "Stop! You got ragebaited! Use the response below."
        : multimodal.codebaseStatus?.state === "ready"
          ? `Monitoring speech content and screen. ${multimodal.codebaseStatus.symbolCount} symbols indexed. Baitrage will intervene when it detects genuine frustration from what you say.`
          : "Starting the codebase watcher and building the symbol map.");

  return (
    <Panel title="ADVICE (chill out)">
      <div className="flex h-full flex-col overflow-y-auto">
        <Typewriter text={text} />
        {multimodal.transcript ? (
          <p className="mt-3 border-t border-[var(--neutral)]/10 pt-3 text-xs italic text-[var(--neutral)]/60 leading-5">
            Hearing: &ldquo;{multimodal.transcript}&rdquo;
          </p>
        ) : multimodal.isCapturing ? (
          <p className="mt-3 border-t border-[var(--neutral)]/10 pt-3 text-xs text-[var(--neutral)]/40">
            Listening for speech…
          </p>
        ) : null}
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/*  Prompt panel                                                      */
/* ------------------------------------------------------------------ */

function PromptPanel({ multimodal }: { multimodal: MultimodalState }) {
  const [copied, setCopied] = useState(false);
  const prompt =
    multimodal.pivotPrompt?.prompt ??
    "The response will appear here when you get ragebaited.";

  const copy = async () => {
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <Panel title="BAITRAGE'S RESPONSE" action={<button className="copy-btn" onClick={copy}><Clipboard />{copied ? "Copied" : "Copy"}</button>}>
      <div className="flex h-full min-h-0 gap-4">
        <div className="flex-1 overflow-y-auto pr-2">
          <pre className="whitespace-pre-wrap break-words text-sm leading-6 font-sans">{prompt}</pre>
        </div>
        <div className="flex w-52 shrink-0 items-center justify-center lg:w-64">
          <img src="/ragebait.gif" alt="Rage indicator" className="h-auto w-full rounded-md object-contain opacity-90 drop-shadow-sm" />
        </div>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/*  Shared components                                                 */
/* ------------------------------------------------------------------ */

function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col min-h-0 rounded-lg border border-[var(--neutral)]/10 bg-[var(--tertiary)] p-4 shadow-inner">
      <div className="mb-3 flex shrink-0 items-center justify-between gap-3 border-b border-[var(--neutral)]/10 pb-2">
        <h2 className="text-xl tracking-wide font-bold">{title}</h2>
        {action}
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        {children}
      </div>
    </section>
  );
}

function Typewriter({ text }: { text: string }) {
  const [visible, setVisible] = useState("");

  useEffect(() => {
    setVisible("");
    let index = 0;
    const timer = window.setInterval(() => {
      index += 1;
      setVisible(text.slice(0, index));
      if (index >= text.length) {
        window.clearInterval(timer);
      }
    }, 18);

    return () => window.clearInterval(timer);
  }, [text]);

  return <p className="text-sm leading-6">{visible}</p>;
}

/* ------------------------------------------------------------------ */
/*  Utilities                                                         */
/* ------------------------------------------------------------------ */

function getTone(multimodal: MultimodalState): CircuitTone {
  if (multimodal.isLocked) {
    return "lockout";
  }

  if (multimodal.frustration > 0.10 || multimodal.isRecalibrating) {
    return "warning";
  }

  return "idle";
}

const glowClass: Record<CircuitTone, string> = {
  idle: "glow-idle",
  warning: "glow-warning",
  lockout: "glow-lockout"
};
