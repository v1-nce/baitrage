# Contributing to Baitrage

Thanks for your interest in contributing! Here's how to get started.

## Setup

```bash
git clone https://github.com/YOUR_ORG/baitrage.git
cd baitrage
npm install
cp .env.example .env.local
# Add your GOOGLE_GENERATIVE_AI_API_KEY to .env.local
npm run dev
```

## Guidelines

- **TypeScript only** — all source files use strict TypeScript.
- **Keep it lean** — avoid adding dependencies unless absolutely necessary.
- **Run checks before pushing**: `npm run typecheck && npm run lint`
- **One concern per file** — follow the existing module boundaries.

## Architecture

| Layer | Path | Purpose |
|-------|------|---------|
| Types | `src/lib/types.ts` | All shared type definitions |
| Evaluator | `src/lib/frustration-evaluator.ts` | Signal scoring + EWMA |
| Hook | `src/hooks/useMultimodal.ts` | Client-side multimodal capture |
| API | `src/app/api/` | Next.js API routes |
| Server | `src/server/` | Agent orchestration, symbol mapping, codebase indexing |
| UI | `src/components/` | React components |

## Pull Requests

1. Fork the repo and create a feature branch.
2. Make your changes with clear commit messages.
3. Ensure `npm run typecheck` and `npm run build` pass.
4. Open a PR against `main` with a description of what and why.
