"use client";

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import {
  evaluateFrustration,
  type DetectorMessage,
  type FrustrationEvaluation,
  RAGE_THRESHOLD
} from "@/lib/frustration-evaluator";
import type { SymbolSearchResult } from "@/lib/symbol-types";
import type { CodebaseIngestionStatus } from "@/lib/ingestion-types";

/* ------------------------------------------------------------------ */
/*  Public types                                                      */
/* ------------------------------------------------------------------ */

export type ConnectionState = "idle" | "capturing" | "connecting" | "streaming" | "local" | "degraded" | "error";

export type ActiveFileContext = {
  path: string;
  language?: string;
  content?: string;
  cursor?: { line?: number; column?: number };
  updatedAt: string;
};

export type PivotPrompt = {
  advice?: string;
  prompt: string;
  summary: string;
  symbols: SymbolSearchResult[];
  visiblePrompts: string[];
  source: "ai" | "fallback";
  createdAt: string;
};

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
  facingMode: "user"
};

const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  channelCount: 1,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  sampleRate: 16000
};

const SCREEN_CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: 1280, max: 1920 },
  height: { ideal: 720, max: 1080 },
  frameRate: { ideal: 2, max: 3 }
};

const CAMERA_FRAME_INTERVAL_MS = 750;
const SCREEN_FRAME_INTERVAL_MS = 1800;
const RECALIBRATION_COOLDOWN_MS = 10000;
const CONTEXT_EVENT_NAME = "active-file";
const AUDIO_LEVEL_INTERVAL_MS = 100;
const CONTENT_ANALYSIS_INTERVAL_MS = 5000;

/* ------------------------------------------------------------------ */
/*  Audio-level measurement (UI bar only — NOT used for frustration)  */
/* ------------------------------------------------------------------ */

function measureRMS(analyser: AnalyserNode | null): number {
  if (!analyser) return 0;
  const data = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteTimeDomainData(data);
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    const sample = (data[i] - 128) / 128;
    sum += sample * sample;
  }
  return Math.sqrt(sum / data.length);
}

/* ------------------------------------------------------------------ */
/*  SpeechRecognition type shim (Chrome/Edge)                         */
/* ------------------------------------------------------------------ */

type SpeechRecognitionEvent = Event & {
  results: SpeechRecognitionResultList;
  resultIndex: number;
};

function createSpeechRecognition(): {
  recognition: EventTarget & { start: () => void; stop: () => void; abort: () => void };
  supported: boolean;
} | null {
  const W = window as unknown as Record<string, unknown>;
  const Ctor = (W.SpeechRecognition ?? W.webkitSpeechRecognition) as
    | (new () => EventTarget & {
        continuous: boolean;
        interimResults: boolean;
        lang: string;
        start: () => void;
        stop: () => void;
        abort: () => void;
      })
    | undefined;

  if (!Ctor) return null;
  const recognition = new Ctor();
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.lang = "en-US";
  return { recognition, supported: true };
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
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioLevelTimerRef = useRef<number | null>(null);
  const cameraFrameTimerRef = useRef<number | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const codebaseSourceRef = useRef<EventSource | null>(null);
  const contentAnalysisTimerRef = useRef<number | null>(null);
  const contextSourceRef = useRef<EventSource | null>(null);
  const lastRecalibrationAtRef = useRef(0);
  const latestCameraFrameRef = useRef("");
  const latestScreenFrameRef = useRef("");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const screenFrameTimerRef = useRef<number | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const speechRecRef = useRef<ReturnType<typeof createSpeechRecognition>>(null);
  const transcriptChunksRef = useRef<string[]>([]);
  const visiblePromptsRef = useRef<string[]>([]);
  const websocketRef = useRef<WebSocket | null>(null);

  /* ---- helpers ---- */

  const sendJson = useCallback((payload: unknown) => {
    const socket = websocketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(payload));
  }, []);

  const dismissPivot = useCallback(() => {
    setPivotPrompt(null);
    setIsLocked(false);
  }, []);

  /* ---- recalibration ---- */

  const triggerRecalibration = useCallback(async (nextEvaluation: FrustrationEvaluation) => {
    const now = Date.now();
    if (now - lastRecalibrationAtRef.current < RECALIBRATION_COOLDOWN_MS) return;
    lastRecalibrationAtRef.current = now;
    setIsRecalibrating(true);

    try {
      const response = await fetch("/api/recalibrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activeFile: activeFileRef.current,
          evaluation: nextEvaluation,
          transcript: transcriptChunksRef.current.slice(-5).join(" "),
          visiblePrompts: nextEvaluation.visiblePrompts.length
            ? nextEvaluation.visiblePrompts
            : visiblePromptsRef.current
        })
      });
      if (!response.ok) throw new Error("Recalibration request failed");
      const pivot = (await response.json()) as PivotPrompt;
      setPivotPrompt(pivot);
    } catch (recalibrationError) {
      setError(
        recalibrationError instanceof Error
          ? recalibrationError.message
          : "Unable to synthesize pivot prompt"
      );
    } finally {
      setIsRecalibrating(false);
    }
  }, []);

  /* ---- detector message handler ---- */

  const handleDetectorMessage = useCallback(
    (message: DetectorMessage) => {
      const nextEvaluation = evaluateFrustration(message);
      visiblePromptsRef.current = nextEvaluation.visiblePrompts.length
        ? nextEvaluation.visiblePrompts
        : visiblePromptsRef.current;

      setEvaluation(nextEvaluation);
      setFrustration(nextEvaluation.coefficient);
      setIsLocked(nextEvaluation.isLocked);

      if (nextEvaluation.coefficient > RAGE_THRESHOLD) {
        void triggerRecalibration(nextEvaluation);
      }
    },
    [triggerRecalibration]
  );

  /* ---- audio level meter (UI only) ---- */

  const startAudioLevelMeter = useCallback(() => {
    if (audioLevelTimerRef.current) return;
    audioLevelTimerRef.current = window.setInterval(() => {
      const rms = measureRMS(analyserRef.current);
      setAudioLevel(Math.min(1, rms / 0.12));
    }, AUDIO_LEVEL_INTERVAL_MS);
  }, []);

  /* ---- speech recognition ---- */

  const startSpeechRecognition = useCallback(() => {
    if (speechRecRef.current) return;
    const result = createSpeechRecognition();
    if (!result) return;

    speechRecRef.current = result;
    const { recognition } = result;

    recognition.addEventListener("result", ((event: SpeechRecognitionEvent) => {
      const latest = event.results[event.results.length - 1];
      if (latest && (latest as unknown as { isFinal: boolean }).isFinal) {
        const text = (latest[0] as unknown as { transcript: string }).transcript.trim();
        if (text) {
          transcriptChunksRef.current.push(text);
          if (transcriptChunksRef.current.length > 20) transcriptChunksRef.current.shift();
          setTranscript(transcriptChunksRef.current.slice(-3).join(" "));
        }
      }
    }) as EventListener);

    recognition.addEventListener("end", () => {
      // Auto-restart if not stopped manually
      try { recognition.start(); } catch { /* already running or stopped */ }
    });

    try { recognition.start(); } catch { /* not supported */ }
  }, []);

  /* ---- content analysis (Gemini Flash) ---- */

  const startContentAnalysis = useCallback(() => {
    if (contentAnalysisTimerRef.current) return;

    contentAnalysisTimerRef.current = window.setInterval(async () => {
      if (analysisInFlightRef.current) return;
      analysisInFlightRef.current = true;

      try {
        const recentTranscript = transcriptChunksRef.current.slice(-5).join(" ");

        const response = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cameraFrame: latestCameraFrameRef.current || undefined,
            screenFrame: latestScreenFrameRef.current || undefined,
            transcript: recentTranscript || undefined,
            activeFilePath: activeFileRef.current?.path
          })
        });

        if (!response.ok) return;
        const analysis = (await response.json()) as DetectorMessage;
        handleDetectorMessage(analysis);
      } catch {
        // Silently skip failed analysis
      } finally {
        analysisInFlightRef.current = false;
      }
    }, CONTENT_ANALYSIS_INTERVAL_MS);
  }, [handleDetectorMessage]);

  /* ---- stop ---- */

  const stop = useCallback(() => {
    [cameraFrameTimerRef, screenFrameTimerRef, audioLevelTimerRef, contentAnalysisTimerRef].forEach(
      (ref) => {
        if (ref.current) {
          window.clearInterval(ref.current);
          ref.current = null;
        }
      }
    );

    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    websocketRef.current?.close(1000, "capture stopped");
    websocketRef.current = null;
    contextSourceRef.current?.close();
    contextSourceRef.current = null;
    codebaseSourceRef.current?.close();
    codebaseSourceRef.current = null;

    try { speechRecRef.current?.recognition.abort(); } catch { /* ok */ }
    speechRecRef.current = null;

    cameraStreamRef.current?.getTracks().forEach((t) => t.stop());
    cameraStreamRef.current = null;
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current = null;
    audioContextRef.current?.close();
    audioContextRef.current = null;

    latestCameraFrameRef.current = "";
    latestScreenFrameRef.current = "";
    transcriptChunksRef.current = [];

    setAudioAnalyser(null);
    setAudioLevel(0);
    setConnectionState("idle");
    setMediaStream(null);
    setScreenStream(null);
    setTranscript("");
  }, []);

  /* ---- Gemini Live WebSocket ---- */

  const connectGeminiLive = useCallback(async () => {
    setConnectionState("connecting");
    try {
      const tokenResponse = await fetch("/api/gemini-token");
      if (!tokenResponse.ok) throw new Error("Token fetch failed");
      const { wsUrl, model } = (await tokenResponse.json()) as { wsUrl: string; model: string };
      if (!wsUrl) { setConnectionState("local"); return; }

      const socket = new WebSocket(wsUrl);
      websocketRef.current = socket;

      socket.onopen = () => {
        setConnectionState("streaming");
        socket.send(JSON.stringify({
          setup: {
            model: `models/${model}`,
            generationConfig: { responseModalities: ["TEXT"] },
            systemInstruction: {
              parts: [{
                text: "You are Baitrage's fast detector. Analyse the developer's camera, audio, and screen for signs of frustration. Return compact JSON with: v_strain (0-1 based on speech CONTENT not volume), f_micro_expressions (0-1 facial tension), p_looping (0-1 prompt repetition), visiblePrompts (string[]), relevantQuery (string), reason (string). Volume does NOT equal frustration — only content matters."
              }]
            }
          }
        }));
      };

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(String(event.data));
          if (data.serverContent?.modelTurn?.parts) {
            for (const part of data.serverContent.modelTurn.parts) {
              if (part.text) {
                try {
                  handleDetectorMessage(JSON.parse(part.text) as DetectorMessage);
                } catch { /* not valid JSON */ }
              }
            }
          } else if (!data.setupComplete) {
            handleDetectorMessage(data as DetectorMessage);
          }
        } catch {
          setConnectionState("local");
        }
      };

      socket.onerror = () => { setConnectionState("local"); };
      socket.onclose = () => { setConnectionState((s) => s === "idle" ? s : "local"); };
    } catch {
      setConnectionState("local");
    }
  }, [handleDetectorMessage]);

  /* ---- context streams ---- */

  const startContextStream = useCallback(() => {
    if (!("EventSource" in window) || contextSourceRef.current) return;
    const source = new EventSource("/api/context/stream");
    contextSourceRef.current = source;
    source.addEventListener(CONTEXT_EVENT_NAME, (event) => {
      const nextFile = JSON.parse((event as MessageEvent).data) as ActiveFileContext;
      activeFileRef.current = nextFile;
      setActiveFile(nextFile);
      sendJson({
        realtimeInput: {
          text: JSON.stringify({ type: "context.active_file", activeFile: { ...nextFile, content: nextFile.content?.slice(0, 1200) } })
        }
      });
    });
    source.onerror = () => { source.close(); contextSourceRef.current = null; };
  }, [sendJson]);

  const startCodebaseStream = useCallback(() => {
    if (!("EventSource" in window) || codebaseSourceRef.current) return;
    const source = new EventSource("/api/ingest/codebase/stream");
    codebaseSourceRef.current = source;
    source.addEventListener("status", (event) => {
      setCodebaseStatus(JSON.parse((event as MessageEvent).data) as CodebaseIngestionStatus);
    });
    source.onerror = () => { source.close(); codebaseSourceRef.current = null; };
  }, []);

  /* ---- frame streaming ---- */

  const startFrameStream = useCallback(
    ({ stream, kind, intervalMs, width, height, quality, timerRef }: {
      stream: MediaStream;
      kind: "camera" | "screen";
      intervalMs: number;
      width: number;
      height: number;
      quality: number;
      timerRef: MutableRefObject<number | null>;
    }) => {
      const video = document.createElement("video");
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      void video.play();

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d", { alpha: false });

      timerRef.current = window.setInterval(() => {
        if (!ctx || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const base64 = canvas.toDataURL("image/jpeg", quality).replace(/^data:image\/jpeg;base64,/, "");

        // Store latest frame for content analysis
        if (kind === "camera") latestCameraFrameRef.current = base64;
        else latestScreenFrameRef.current = base64;

        // Also send to Gemini Live if connected
        sendJson({
          realtimeInput: { mediaChunks: [{ mimeType: "image/jpeg", data: base64 }] }
        });
      }, intervalMs);
    },
    [sendJson]
  );

  /* ---- audio ---- */

  const startAudio = useCallback(
    (stream: MediaStream) => {
      const audioContext = new AudioContext({ sampleRate: 16000 });
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      audioContextRef.current = audioContext;
      analyserRef.current = analyser;
      setAudioAnalyser(analyser);

      const mimeType = getSupportedAudioMimeType();
      const audioOnlyStream = new MediaStream(stream.getAudioTracks());
      const recorder = new MediaRecorder(audioOnlyStream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = async (event) => {
        if (!event.data.size) return;
        const base64 = await blobToBase64(event.data);
        sendJson({ realtimeInput: { mediaChunks: [{ mimeType: recorder.mimeType || "audio/webm", data: base64 }] } });
      };
      recorder.start(500);
    },
    [sendJson]
  );

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
      startFrameStream({
        stream, kind: "screen", intervalMs: SCREEN_FRAME_INTERVAL_MS,
        width: 960, height: 540, quality: 0.36, timerRef: screenFrameTimerRef
      });
      stream.getVideoTracks()[0]?.addEventListener("ended", () => {
        if (screenFrameTimerRef.current) { window.clearInterval(screenFrameTimerRef.current); screenFrameTimerRef.current = null; }
        screenStreamRef.current = null;
        latestScreenFrameRef.current = "";
        setScreenStream(null);
      });
    } catch (screenError) {
      setError(screenError instanceof Error ? screenError.message : "Unable to start screen sharing");
    }
  }, [startFrameStream]);

  /* ---- start ---- */

  const start = useCallback(async () => {
    setError(null);
    setConnectionState("capturing");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: VIDEO_CONSTRAINTS, audio: AUDIO_CONSTRAINTS });
      cameraStreamRef.current = stream;
      setMediaStream(stream);

      startAudio(stream);
      startFrameStream({
        stream, kind: "camera", intervalMs: CAMERA_FRAME_INTERVAL_MS,
        width: 320, height: 180, quality: 0.45, timerRef: cameraFrameTimerRef
      });
      startContextStream();
      startCodebaseStream();
      startAudioLevelMeter();
      startSpeechRecognition();
      startContentAnalysis();

      await connectGeminiLive();
      await startScreenShare();
    } catch (captureError) {
      setError(captureError instanceof Error ? captureError.message : "Unable to start media capture");
      setConnectionState("error");
    }
  }, [connectGeminiLive, startAudio, startAudioLevelMeter, startCodebaseStream, startContentAnalysis, startContextStream, startFrameStream, startScreenShare, startSpeechRecognition]);

  /* ---- cleanup ---- */

  useEffect(() => { return () => stop(); }, [stop]);

  /* ---- ledger telemetry ---- */

  useEffect(() => {
    const controller = new AbortController();
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
          updatedAt: new Date().toISOString()
        }),
        signal: controller.signal
      }).catch(() => undefined);
    }, 250);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [activeFile?.path, connectionState, evaluation?.reason, frustration, isLocked, isRecalibrating, pivotPrompt?.advice, pivotPrompt?.prompt, pivotPrompt?.summary, screenStream]);

  return {
    activeFile, audioAnalyser, audioLevel, codebaseStatus, connectionState, error,
    evaluation, frustration, isCapturing: Boolean(mediaStream), isLocked, isRecalibrating,
    isScreenSharing: Boolean(screenStream), mediaStream, pivotPrompt, screenStream, transcript,
    start, startScreenShare, stop, dismissPivot
  };
}

/* ------------------------------------------------------------------ */
/*  Utilities                                                         */
/* ------------------------------------------------------------------ */

function getSupportedAudioMimeType() {
  return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((t) => MediaRecorder.isTypeSupported(t));
}

function blobToBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
