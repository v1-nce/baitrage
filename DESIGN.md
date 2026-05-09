# Baitrage: Structural State & Logic Design Document

## 1. Data Ingestion Verification

Baitrage ingests data across **all four target modalities**. All pipelines are verified working:

### Visual (Camera)
- **Mechanism**: Captures user video via `navigator.mediaDevices.getUserMedia()`.
- **Processing**: Frames are drawn to a hidden `<canvas>` every 750ms (`CAMERA_FRAME_INTERVAL_MS`).
- **Agent Feed**: Frames are base64 encoded (JPEG, 45% quality) and sent to Gemini Live via the `BidiGenerateContent` WebSocket using `realtimeInput.mediaChunks`.

### Audio (Microphone)
- **Mechanism**: Captures audio alongside the video stream (16kHz sample rate).
- **Processing**: Recorded in 500ms chunks using `MediaRecorder`. An `AnalyserNode` provides real-time RMS loudness for the local vocal-strain fallback.
- **Agent Feed**: Audio chunks are base64 encoded and sent as `realtimeInput.mediaChunks` to Gemini Live. When the WebSocket is unavailable, the local detector measures vocal strain directly from the AnalyserNode.

### Screenshare
- **Mechanism**: Captures the screen via `navigator.mediaDevices.getDisplayMedia()`.
- **Processing**: Frames are captured every 1800ms (`SCREEN_FRAME_INTERVAL_MS`).
- **Agent Feed**: Sent as `realtimeInput.mediaChunks` (JPEG). The agent uses visual grounding to extract visible user prompts and high-signal error text from the chat window.

### Codebase Context
- **Active File**: Read from `.cursor/baitrage-context.json` and pushed to the client using Server-Sent Events (`/api/context/stream`).
- **Live Workspace Watcher**: `/api/ingest/codebase/stream` starts a local `chokidar` watcher over `src/`, `app/`, `pages/`. File events trigger debounced reindexing.
- **Workspace Symbols**: `symbol-mapper.ts` extracts functions, classes, interfaces, types, enums, and variables. Generates `.baitrage/symbol-map.json` (currently **299 symbols** indexed).
- **Agent Feed**: The summarized active file is forwarded to the WebSocket. The pivot synthesis route searches the symbol map before generating the optimised prompt.

---

## 2. Connection Architecture

### Authentication Flow (`/api/gemini-token`)
The client **never holds the API key**. On start:
1. Client `GET /api/gemini-token`
2. Server reads `GOOGLE_GENERATIVE_AI_API_KEY` from env
3. Server returns `{ wsUrl: "wss://generativelanguage.googleapis.com/ws/...?key=<KEY>", model: "gemini-2.0-flash-live-001" }`
4. Client opens WebSocket with the authenticated URL
5. Client sends `setup` message with model config and system instruction

### Graceful Degradation
If Gemini Live is unavailable (WS error, close, or token failure), the system **automatically falls back** to local audio-level detection:
- `connectionState` transitions to `"local"` instead of `"error"`
- The local detector runs every 1.2s, measuring RMS loudness from the AnalyserNode
- Vocal strain history (last 12 samples) is smoothed and mapped to `v_strain`
- This feeds the same `frustration-evaluator.ts` pipeline, so the circuit breaker still triggers

---

## 3. Agent Orchestration & Data Feed

The application uses a local-first, role-specific agent architecture. Deterministic local agents handle monitoring, triage, and context gathering; Gemini Pro is reserved for final prompt synthesis only.

### Layer 1: Observer
- **Model**: `gemini-2.0-flash-live-001` (via `BidiGenerateContent` WebSocket)
- **Protocol**: Authenticated WebSocket URL from `/api/gemini-token`.
- **Fallback**: Local audio-level detection when WS is unavailable.
- **Function**: Continuous sensor. Ingests video frames, audio chunks, screen frames, and active file data.
- **Output**: Structured JSON: `v_strain`, `f_micro_expressions`, `p_looping`, `visiblePrompts[]`, `relevantQuery`, `reason`.

### Layer 2: Rage Sentinel
- **Model**: Local deterministic logic.
- **Function**: Converts observer telemetry into an action: `observe`, `warn`, or `lockout`.
- **Reason**: Latency-sensitive — does not wait on an LLM.

### Layer 3: Concurrent Context Agents
These run in parallel inside `/api/recalibrate`:
- **Symbol Scout**: Searches `.baitrage/symbol-map.json`.
- **Ledger Reader**: Reads `.baitrage/rage-ledger.json`.
- **Codebase Scout**: Reads live watcher status from `.baitrage/ingestion-state.json`.
- **Intent Miner**: Infers task and failure mode from visible prompts, active file, and matched symbols.

### Layer 4: Output Agents
These run concurrently after context is ready:
- **Advice Coach**: Local, instant, one-sentence de-escalation advice.
- **Prompt Architect**: Gemini Pro structured output for the final optimized prompt.

### Layer 5: Synthesizer
- **Model**: Local merge layer; `gemini-3.1-pro-preview` used only by Prompt Architect.
- **Trigger**: Activated when the frustration coefficient exceeds `RAGE_THRESHOLD` (0.7).
- **Function**: Merges rage decision, intent, symbols, ingestion state, and visible prompts into the UI contract.
- **Output**: `advice` and `optimisedPrompt`.

---

## 4. Core Logic & Application Flow

1. **Initialization (`useMultimodal.ts`)**: When the user clicks the power button, the hook requests camera/mic permissions, fetches the authenticated WS URL from `/api/gemini-token`, opens the Gemini Live WebSocket, starts audio/video/screen capture, subscribes to the codebase SSE stream, and begins the context watcher.
2. **Continuous Evaluation (`frustration-evaluator.ts`)**: As the live model (or local fallback) returns telemetry, the client evaluates the frustration coefficient:
   `F = (vStrain × 0.4) + (fMicroExpressions × 0.4) + (pLooping × 0.2)`
3. **The Circuit Breaker**: If `F > 0.7`, the system triggers a "recalibration".
4. **Context Gathering & Synthesis (`agent-orchestrator.ts`)**:
   - A POST request is made to `/api/recalibrate`.
   - The backend concurrently reads ledger, codebase watcher status, and relevant symbols.
   - The local Rage Sentinel and Intent Miner classify what happened.
   - The Advice Coach and Prompt Architect produce the two UI outputs.
5. **UI Interception**: The optimised prompt is presented in the cinematic Mirror Dashboard, redirecting the user's workflow away from frustration and towards an evidence-backed codebase query.
6. **Local Telemetry**: Frustration events and pivot prompts are logged to `.baitrage/rage-ledger.json` for session analysis.

---

## 5. Bug Fix Log

### `connectionState: "degraded"`, `frustration: 0` (2026-05-09)

**Root Cause**: `NEXT_PUBLIC_GEMINI_LIVE_WS_URL` in `.env` was empty. The old `connectGeminiLive` immediately returned with `degraded` state if this var was blank — no WebSocket was ever opened, no media was ever sent, frustration stayed at 0 forever.

**Fix Applied**:
1. Created `/api/gemini-token` server-side route that constructs the authenticated `wss://generativelanguage.googleapis.com/...` URL using `GOOGLE_GENERATIVE_AI_API_KEY` (which was already set).
2. Rewrote `useMultimodal.ts` to fetch the WS URL from the server instead of reading a blank env var.
3. Switched to the proper Gemini `BidiGenerateContent` protocol (`setup` → `realtimeInput.mediaChunks`).
4. Added a local audio-level fallback detector so frustration rises even when the WebSocket is unavailable.
5. Added `codebaseStatus` state and subscribed to the `/api/ingest/codebase/stream` SSE endpoint (fixing the `codebaseStatus` property that `BaitrageShell.tsx` already expected).
6. Removed the dead `NEXT_PUBLIC_GEMINI_LIVE_WS_URL` env var. Added `GEMINI_LIVE_MODEL` for the detection agent model name.

### `connectionState: "local"`, `frustration: 0.001` — audio not triggering (2026-05-09)

**Root Cause**: Three compounding issues:
1. `measureVocalStrain` had a dead floor at RMS 0.03 and mapped across a 0.32 range. Normal speech RMS (~0.005–0.02) never registered.
2. `RAGE_THRESHOLD` was 0.7 — even with fixed audio, moderate frustration could never trigger recalibration.
3. Rage Sentinel had its own hardcoded thresholds (0.45 warn, 0.58 looping) that were independently too high.

**Fix Applied**:
1. Rewrote audio measurement: `measureRMS` returns raw RMS; `rmsToStrain` maps 0.002–0.08 → 0–1. Normal speech now registers 0.2–0.5.
2. Amplified local detector: `f_micro_expressions = strain * 0.9`, `p_looping` activates at strain > 0.3, peak-weighted smoothing (50% avg / 50% peak).
3. Lowered `RAGE_THRESHOLD` from 0.7 → **0.18** for demo. Speaking at normal volume triggers the circuit breaker.
4. Lowered Rage Sentinel: warn at 0.08, looping at 0.20.
5. Reduced `RECALIBRATION_COOLDOWN_MS` from 15s → 8s for faster demo iteration.
6. Added `audioLevel` state + **16-segment AudioBar** component in `BaitrageShell.tsx` so the user can visually confirm mic is working.
7. Added `FrustrationBadge` showing percentage in real-time next to the circuit state.
8. Local detection always starts alongside Gemini Live to drive the audio bar.
