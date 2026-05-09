"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { evaluateFrustration, resetFrustrationState, RAGE_THRESHOLD } from "@/lib/frustration-evaluator";
import type {
  ActiveFileContext,
  CodebaseIngestionStatus,
  DetectorMessage,
  FrustrationEvaluation,
  PivotPrompt,
} from "@/lib/types";

/* ------------------------------------------------------------------ */
/*  Public types                                                      */
/* ------------------------------------------------------------------ */

export type ConnectionState = "idle" | "capturing" | "analyzing" | "error";

export type MultimodalState = {
  activeFile: ActiveFileContext | null;
  audioAnalyser: AnalyserNode | null;
  audioLevel: number;
  codebaseStatus: CodebaseIngestionStatus | null;
  connectionState: ConnectionState;
  error: string | null;
  evaluation: FrustrationEvaluation | null;
  frustration: number;
  isCapturing: boolean;
  isLocked: boolean;
  isRecalibrating: boolean;
  isScreenSharing: boolean;
  mediaStream: MediaStream | null;
  pivotPrompt: PivotPrompt | null;
  screenStream: MediaStream | null;
  transcript: string;
  start: () => Promise<void>;
  startScreenShare: () => Promise<void>;
  stop: () => void;
  dismissPivot: () => void;
};

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

const VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: 320, max: 640 },
  height: { ideal: 180, max: 360 },
  frameRate: { ideal: 10, max: 12 },
  facingMode: "user",
};

const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  channelCount: 1,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  sampleRate: 16000,
};

const SCREEN_CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: 1280, max: 1920 },
  height: { ideal: 720, max: 1080 },
  frameRate: { ideal: 2, max: 3 },
};

const CAMERA_FRAME_INTERVAL_MS = 750;
const SCREEN_FRAME_INTERVAL_MS = 1800;
const RECALIBRATION_COOLDOWN_MS = 10_000;
const AUDIO_LEVEL_INTERVAL_MS = 100;
const CONTENT_ANALYSIS_INTERVAL_MS = 3_000;

/* ------------------------------------------------------------------ */
/*  SpeechRecognition shim (Chrome/Edge)                              */
/* ------------------------------------------------------------------ */

type SpeechRecognitionEvent = Event & { results: SpeechRecognitionResultList; resultIndex: number };
type SpeechRecognitionInstance = EventTarget & {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

function createSpeechRecognition(): SpeechRecognitionInstance | null {
  const W = window as unknown as Record<string, unknown>;
  const Ctor = (W.SpeechRecognition ?? W.webkitSpeechRecognition) as (new () => SpeechRecognitionInstance) | undefined;
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.continuous = true;
  rec.interimResults = false;
  rec.lang = "en-US";
  return rec;
}

/* ------------------------------------------------------------------ */
/*  Utilities                                                         */
/* ------------------------------------------------------------------ */

function measureRMS(analyser: AnalyserNode | null): number {
  if (!analyser) return 0;
  const data = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteTimeDomainData(data);
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    const s = (data[i] - 128) / 128;
    sum += s * s;
  }
  return Math.sqrt(sum / data.length);
}

function captureFrame(
  stream: MediaStream,
  width: number,
  height: number,
  quality: number,
): { video: HTMLVideoElement; canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; grab: () => string } {
  const video = document.createElement("video");
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  void video.play();
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false })!;
  return {
    video,
    canvas,
    ctx,
    grab: () => {
      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return "";
      ctx.drawImage(video, 0, 0, width, height);
      return canvas.toDataURL("image/jpeg", quality).replace(/^data:image\/jpeg;base64,/, "");
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Hook                                                              */
/* ------------------------------------------------------------------ */

export function useMultimodal(): MultimodalState {
  /* ---- state ---- */
  const [activeFile, setActiveFile] = useState<ActiveFileContext | null>(null);
  const [audioAnalyser, setAudioAnalyser] = useState<AnalyserNode | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const [codebaseStatus, setCodebaseStatus] = useState<CodebaseIngestionStatus | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [evaluation, setEvaluation] = useState<FrustrationEvaluation | null>(null);
  const [frustration, setFrustration] = useState(0);
  const [isLocked, setIsLocked] = useState(false);
  const [isRecalibrating, setIsRecalibrating] = useState(false);
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
  const [pivotPrompt, setPivotPrompt] = useState<PivotPrompt | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [transcript, setTranscript] = useState("");

  /* ---- refs ---- */
  const activeFileRef = useRef<ActiveFileContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const analysisInFlightRef = useRef(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const codebaseSourceRef = useRef<EventSource | null>(null);
  const contextSourceRef = useRef<EventSource | null>(null);
  const lastRecalRef = useRef(0);
  const latestCameraRef = useRef("");
  const latestScreenRef = useRef("");
  const recentScoresRef = useRef<number[]>([]);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const speechRecRef = useRef<SpeechRecognitionInstance | null>(null);
  const transcriptChunksRef = useRef<string[]>([]);
  const visiblePromptsRef = useRef<string[]>([]);

  // Timer refs
  const timers = useRef<{ audio?: number; camera?: number; screen?: number; analysis?: number }>({});

  /* ---- helpers ---- */

  const dismissPivot = useCallback(() => {
    setPivotPrompt(null);
    setIsLocked(false);
  }, []);

  /* ---- recalibration (circuit breaker fires) ---- */

  const triggerRecalibration = useCallback(async (nextEval: FrustrationEvaluation) => {
    const now = Date.now();
    if (now - lastRecalRef.current < RECALIBRATION_COOLDOWN_MS) return;
    lastRecalRef.current = now;
    setIsRecalibrating(true);

    try {
      const res = await fetch("/api/recalibrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activeFile: activeFileRef.current,
          evaluation: nextEval,
          transcript: transcriptChunksRef.current.slice(-5).join(" "),
          visiblePrompts: nextEval.visiblePrompts.length ? nextEval.visiblePrompts : visiblePromptsRef.current,
        }),
      });
      if (!res.ok) throw new Error("Recalibration failed");
      setPivotPrompt(await res.json() as PivotPrompt);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to synthesize pivot prompt");
    } finally {
      setIsRecalibrating(false);
    }
  }, []);

  /* ---- detector message handler ---- */

  const handleDetectorMessage = useCallback(
    (msg: DetectorMessage) => {
      const nextEval = evaluateFrustration(msg);
      visiblePromptsRef.current = nextEval.visiblePrompts.length ? nextEval.visiblePrompts : visiblePromptsRef.current;

      // Track recent scores for trajectory analysis
      recentScoresRef.current = [...recentScoresRef.current.slice(-4), nextEval.coefficient];

      setEvaluation(nextEval);
      setFrustration(nextEval.coefficient);
      setIsLocked(nextEval.isLocked);

      if (nextEval.coefficient > RAGE_THRESHOLD) {
        void triggerRecalibration(nextEval);
      }
    },
    [triggerRecalibration],
  );

  /* ---- content analysis (Gemini Flash polling) ---- */

  const startContentAnalysis = useCallback(() => {
    if (timers.current.analysis) return;

    timers.current.analysis = window.setInterval(async () => {
      if (analysisInFlightRef.current) return;
      analysisInFlightRef.current = true;

      try {
        const recentTranscript = transcriptChunksRef.current.slice(-5).join(" ");
        const res = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cameraFrame: latestCameraRef.current || undefined,
            screenFrame: latestScreenRef.current || undefined,
            transcript: recentTranscript || undefined,
            activeFilePath: activeFileRef.current?.path,
            recentScores: recentScoresRef.current,
          }),
        });
        if (!res.ok) return;
        handleDetectorMessage(await res.json() as DetectorMessage);
      } catch {
        // Silently skip
      } finally {
        analysisInFlightRef.current = false;
      }
    }, CONTENT_ANALYSIS_INTERVAL_MS);
  }, [handleDetectorMessage]);

  /* ---- frame streaming ---- */

  const startFrameCapture = useCallback(
    (opts: { stream: MediaStream; kind: "camera" | "screen"; intervalMs: number; w: number; h: number; q: number }) => {
      const { grab } = captureFrame(opts.stream, opts.w, opts.h, opts.q);
      const key = opts.kind === "camera" ? "camera" : "screen";
      const ref = opts.kind === "camera" ? latestCameraRef : latestScreenRef;

      timers.current[key] = window.setInterval(() => {
        const frame = grab();
        if (frame) ref.current = frame;
      }, opts.intervalMs);
    },
    [],
  );

  /* ---- speech recognition ---- */

  const startSpeechRecognition = useCallback(() => {
    if (speechRecRef.current) return;
    const rec = createSpeechRecognition();
    if (!rec) return;
    speechRecRef.current = rec;

    rec.addEventListener("result", ((e: SpeechRecognitionEvent) => {
      const latest = e.results[e.results.length - 1];
      if (latest && (latest as unknown as { isFinal: boolean }).isFinal) {
        const text = (latest[0] as unknown as { transcript: string }).transcript.trim();
        if (text) {
          transcriptChunksRef.current.push(text);
          if (transcriptChunksRef.current.length > 20) transcriptChunksRef.current.shift();
          setTranscript(transcriptChunksRef.current.slice(-3).join(" "));
        }
      }
    }) as EventListener);

    rec.addEventListener("end", () => {
      try { rec.start(); } catch { /* already running or stopped */ }
    });

    try { rec.start(); } catch { /* not supported */ }
  }, []);

  /* ---- context & codebase SSE streams ---- */

  const startContextStream = useCallback(() => {
    if (!("EventSource" in window) || contextSourceRef.current) return;
    const src = new EventSource("/api/context/stream");
    contextSourceRef.current = src;
    src.addEventListener("active-file", (e) => {
      const next = JSON.parse((e as MessageEvent).data) as ActiveFileContext;
      activeFileRef.current = next;
      setActiveFile(next);
    });
    src.onerror = () => { src.close(); contextSourceRef.current = null; };
  }, []);

  const startCodebaseStream = useCallback(() => {
    if (!("EventSource" in window) || codebaseSourceRef.current) return;
    const src = new EventSource("/api/ingest/codebase/stream");
    codebaseSourceRef.current = src;
    src.addEventListener("status", (e) => {
      setCodebaseStatus(JSON.parse((e as MessageEvent).data) as CodebaseIngestionStatus);
    });
    src.onerror = () => { src.close(); codebaseSourceRef.current = null; };
  }, []);

  /* ---- stop ---- */

  const stop = useCallback(() => {
    Object.values(timers.current).forEach((t) => { if (t) window.clearInterval(t); });
    timers.current = {};

    contextSourceRef.current?.close();
    contextSourceRef.current = null;
    codebaseSourceRef.current?.close();
    codebaseSourceRef.current = null;

    try { speechRecRef.current?.abort(); } catch { /* ok */ }
    speechRecRef.current = null;

    cameraStreamRef.current?.getTracks().forEach((t) => t.stop());
    cameraStreamRef.current = null;
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current = null;
    audioCtxRef.current?.close();
    audioCtxRef.current = null;

    latestCameraRef.current = "";
    latestScreenRef.current = "";
    transcriptChunksRef.current = [];
    recentScoresRef.current = [];
    resetFrustrationState();

    setAudioAnalyser(null);
    setAudioLevel(0);
    setConnectionState("idle");
    setMediaStream(null);
    setScreenStream(null);
    setTranscript("");
  }, []);

  /* ---- screen share ---- */

  const startScreenShare = useCallback(async () => {
    if (!navigator.mediaDevices.getDisplayMedia) {
      setError("Screen sharing is not supported in this browser");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: SCREEN_CONSTRAINTS, audio: false });
      screenStreamRef.current = stream;
      setScreenStream(stream);
      startFrameCapture({ stream, kind: "screen", intervalMs: SCREEN_FRAME_INTERVAL_MS, w: 960, h: 540, q: 0.36 });
      stream.getVideoTracks()[0]?.addEventListener("ended", () => {
        if (timers.current.screen) { window.clearInterval(timers.current.screen); timers.current.screen = undefined; }
        screenStreamRef.current = null;
        latestScreenRef.current = "";
        setScreenStream(null);
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to start screen sharing");
    }
  }, [startFrameCapture]);

  /* ---- start ---- */

  const start = useCallback(async () => {
    setError(null);
    setConnectionState("capturing");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: VIDEO_CONSTRAINTS, audio: AUDIO_CONSTRAINTS });
      cameraStreamRef.current = stream;
      setMediaStream(stream);

      // Audio analyser (UI level meter only)
      const audioCtx = new AudioContext({ sampleRate: 16000 });
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      audioCtxRef.current = audioCtx;
      analyserRef.current = analyser;
      setAudioAnalyser(analyser);

      timers.current.audio = window.setInterval(() => {
        setAudioLevel(Math.min(1, measureRMS(analyserRef.current) / 0.12));
      }, AUDIO_LEVEL_INTERVAL_MS);

      startFrameCapture({ stream, kind: "camera", intervalMs: CAMERA_FRAME_INTERVAL_MS, w: 320, h: 180, q: 0.45 });
      startContextStream();
      startCodebaseStream();
      startSpeechRecognition();
      startContentAnalysis();

      setConnectionState("analyzing");
      await startScreenShare();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to start media capture");
      setConnectionState("error");
    }
  }, [startCodebaseStream, startContentAnalysis, startContextStream, startFrameCapture, startScreenShare, startSpeechRecognition]);

  /* ---- cleanup ---- */
  useEffect(() => () => stop(), [stop]);

  /* ---- ledger telemetry ---- */
  useEffect(() => {
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => {
      void fetch("/api/ledger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activeFilePath: activeFile?.path,
          advice: pivotPrompt?.advice ?? pivotPrompt?.summary,
          connectionState,
          frustration,
          isLocked,
          isRecalibrating,
          isScreenSharing: Boolean(screenStream),
          prompt: pivotPrompt?.prompt,
          reason: evaluation?.reason,
          updatedAt: new Date().toISOString(),
        }),
        signal: ctrl.signal,
      }).catch(() => undefined);
    }, 250);
    return () => { ctrl.abort(); window.clearTimeout(timer); };
  }, [activeFile?.path, connectionState, evaluation?.reason, frustration, isLocked, isRecalibrating, pivotPrompt?.advice, pivotPrompt?.prompt, pivotPrompt?.summary, screenStream]);

  return {
    activeFile, audioAnalyser, audioLevel, codebaseStatus, connectionState, error,
    evaluation, frustration, isCapturing: Boolean(mediaStream), isLocked, isRecalibrating,
    isScreenSharing: Boolean(screenStream), mediaStream, pivotPrompt, screenStream, transcript,
    start, startScreenShare, stop, dismissPivot,
  };
}
