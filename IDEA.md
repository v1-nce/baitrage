# Baitrage Product Blueprint

## Name

Baitrage is a local-first affective developer dashboard for interrupting rage-prompting loops.

## Target User

Developers and AI engineers using Claude, ChatGPT, Cursor, Copilot, or other AI tools who hit repetitive failure loops and begin sending shorter, lower-context prompts.

## Core Problem

When an AI coding session fails repeatedly, the developer often removes context instead of adding it. Baitrage treats that frustration loop as an observable system state: facial affect, vocal strain, visible chat history, and current codebase changes all become telemetry for a prompt-recalibration layer.

## Local-First Demo Strategy

Baitrage should be usable after:

```bash
git clone <repo>
npm install
cp .env.example .env
npm run dev
```

No hosted database is required. Runtime state is written under `.baitrage/`:

- `.baitrage/symbol-map.json`
- `.baitrage/ingestion-state.json`
- `.baitrage/rage-ledger.json`

## Ingestion Layer

### Camera

The browser captures webcam video with `getUserMedia`. Low-rate JPEG frames are sent to the monitoring stream as `facial_affect`.

### Microphone

The browser records mono audio chunks with `MediaRecorder` and sends them as `vocal_affect`.

### Screen Share

The browser captures the active AI chat or IDE window with `getDisplayMedia`. Frames are sent as `chat_history_visual` so Gemini Flash Live can visually ground recent prompts, errors, and AI behavior across any external tool.

Browser security requires the user to approve screen sharing.

### Codebase Context

Baitrage runs a local `chokidar` watcher over source directories. On add/change/delete events, it refreshes a lightweight symbol map without indexing full file contents.

Extracted context:

- project file summaries
- function signatures
- classes
- interfaces
- types
- enums
- top-level variables

The dashboard subscribes to ingestion status through Server-Sent Events at `/api/ingest/codebase/stream`, avoiding noisy client polling.

## Intelligence Layer

### Observer

Gemini Flash Live is the fast monitoring stream. It receives camera, audio, screen frames, active file context, and codebase ingestion status.

Expected JSON output:

```json
{
  "v_strain": 0.2,
  "f_micro_expressions": 0.3,
  "p_looping": 0.4,
  "visiblePrompts": ["..."],
  "relevantQuery": "...",
  "reason": "..."
}
```

### Frustration Coefficient

```text
F = (v_strain * 0.4) + (f_micro_expressions * 0.4) + (p_looping * 0.2)
```

When `F > 0.7`, the circuit closes.

### Pivot Synthesis

Gemini Pro is only called when the circuit closes. It receives:

- last visible prompts from screen grounding
- active file context
- relevant symbols from `.baitrage/symbol-map.json`
- frustration evaluation reason

It returns the de-escalation advice and the optimized prompt.

## UI

The primary interface is a cinematic Mirror Dashboard:

- full-width `SCREEN` camera feed
- blue glow for idle
- pulsing orange glow for warning
- red glow for lockout
- left panel: `ADVICE`
- right panel: `OPTIMISED PROMPT`

## Current Focus

The priority is not autonomous coding yet. The priority is fast, accurate, impressive ingestion:

- live screen observation
- live codebase symbol updates
- low-latency media capture
- local ledger output
- clean context feed for future agents
