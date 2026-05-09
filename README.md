<div align="center">
  <img src="./public/ragebait.gif" alt="Baitrage" width="350" />

  # Baitrage
  
  **Your Affective Developer Environment Widget**

  [![version](https://img.shields.io/badge/version-v0.1.0-orange?style=flat-square)](#)
  [![license](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](#)
  [![built with](https://img.shields.io/badge/built%20with-Next.js-000000?style=flat-square&logo=next.js)](#)
  [![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript)](#)
  [![Gemini](https://img.shields.io/badge/Gemini-2.0%20Flash-8E75B2?style=flat-square)](https://deepmind.google/technologies/gemini/)

</div>

---

We all hit a wall when coding. Error loops, stubborn bugs, and unhelpful AI assistants often push developers to the brink of keyboard-smashing frustration. 

**Baitrage is the intervention.** It's an autonomous affective dashboard that sits in your workflow, tracks your emotional state via content-analysis, and automatically steps in with codebase-aware, cool-headed prompt synthesis before you lose your mind.

## 💡 How It Works

Baitrage operates a localized, privacy-first affective loop:

1. **Monitor**: Uses Gemini Flash to analyze your speech transcription, facial expressions, and screen frames. It looks for genuine signs of frustration (profanity, exasperation), completely ignoring mere high volume.
2. **Ingest**: Continuously watches your active files to build an abstract, up-to-date symbol map of your local project.
3. **Intervene**: When the "circuit breaker" triggers, Baitrage locks your UI briefly to halt the frustration loop.
4. **Synthesize**: It generates a highly optimized, context-aware prompt using Gemini Pro, ready to be pasted directly into your AI coding assistant to get you unstuck.

---

## 🚀 Installation & Usage

Requires Node.js v18+, a modern browser, and a [Gemini API Key](https://aistudio.google.com/apikey).

```bash
# 1. Install dependencies
npm install

# 2. Set up credentials
cp .env.example .env.local
# Add your GOOGLE_GENERATIVE_AI_API_KEY to .env.local

# 3. Start the dashboard
npm run dev
```

### New User Guide

1. **Launch**: Open `http://localhost:3000` in your browser.
2. **Start Monitoring**: Click the power button icon (top left of the screen panel) and grant camera/microphone permissions.
3. **Share Context**: Click the monitor icon to share your IDE or AI chat window.
4. **Code Normally**: As you work, Baitrage indexes your files into its symbol map.
5. **Get Frustrated**: When you run into a bug, just talk out loud. "This stupid function keeps breaking, I've tried three times!"
6. **Pivot**: Baitrage detects your frustration, triggers the circuit breaker, and generates a calm, context-aware prompt.
7. **Copy & Paste**: Click "Copy" on the RESPONSE panel and paste it into your AI assistant.

---

## 🧠 Agent Architecture

Baitrage is built on a concurrent, multi-layered architecture designed to separate high-frequency local ingestion from deep, asynchronous AI synthesis.

```mermaid
graph TD
    %% Ingestion Layer
    subgraph Ingestion["1. Multimodal Ingestion Layer"]
        Mic["Microphone\n(Web Speech API)"]
        Cam["Camera\n(Video Frames)"]
        Screen["Screen Share\n(Active Window)"]
        FS["Codebase Watcher\n(Chokidar + SSE)"]
    end

    %% Intelligence Layer
    subgraph Intelligence["2. Content-Based Intelligence (Gemini Flash)"]
        Analyze["/api/analyze Endpoint"]
        Mic -->|Live Transcript| Analyze
        Cam -->|Facial Affect| Analyze
        Screen -->|Visual Context| Analyze
        
        Eval["Frustration Evaluator"]
        Analyze -->|v_strain, f_micro, p_looping| Eval
    end

    %% Orchestrator Layer
    subgraph Orchestration["3. Agent Orchestrator (Gemini Pro)"]
        Sentinel["Rage Sentinel"]
        Miner["Intent Miner"]
        Scout["Symbol Scout"]
        Architect["Prompt Architect"]

        Eval -->|> 0.35 Threshold| Sentinel
        Sentinel --> Miner
        FS -->|Local Symbol Map| Scout
        Miner --> Architect
        Scout --> Architect
    end

    %% UI Output
    UI["Cinematic Mirror Dashboard"]
    Architect -->|Optimized Prompt & Advice| UI
```

### 1. Ingestion Layer
- **Media Streams**: `useMultimodal.ts` captures browser-native MediaStreams. Audio volume is isolated purely for UI rendering.
- **Codebase Watcher**: A local background process uses `chokidar` to monitor the workspace. It parses files to build a lightweight abstract syntax tree (`symbol-map.json`) containing function signatures, types, and variables, ensuring the AI context window isn't bloated with raw, uncompressed files. Updates are pushed to the UI via zero-polling Server-Sent Events (SSE).

### 2. Intelligence Layer
- **Content-Aware Observation**: Every 5 seconds, an aggregated batch of transcripts and screen/camera frames is sent to Gemini Flash.
- **Affective Scoring**: Gemini Flash evaluates the true emotional state based on *content* (e.g. cursing, exasperated phrasing) and *micro-expressions*, decoupling frustration detection from raw volume (preventing loud but normal speech from triggering false positives).

### 3. Orchestrator Layer
When the `Frustration Evaluator` circuit breaker trips, the concurrent `agent-orchestrator.ts` runs:
1. **Rage Sentinel**: Makes a deterministic local decision on whether to intervene based on the ledger history.
2. **Intent Miner**: Infers the developer's current task and failure mode from the transcript and screen grounding.
3. **Symbol Scout**: Pulls the exact required signatures from the local `symbol-map.json`.
4. **Prompt Architect**: Uses Gemini Pro to synthesize the final, highly structured "Optimized Prompt" designed to de-escalate the developer and solve the code problem.

<div align="center">
  <br />
  <i>Empowering developers to step back, breathe, and let the codebase solve the problem.</i>
</div>
