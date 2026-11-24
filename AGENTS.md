# Plugin Update Tracker (Custom)

## Project Overview

- Target: Obsidian Community Plugin fork (TypeScript + React + Redux Toolkit → esbuild CommonJS bundle).
- Entry point: `src/main.tsx` compiled to `main.js`.
- Release artifacts: `main.js`, `manifest.json`, `styles.css`.
- Vault Plugin ID: `plugin-update-tracker-custom`.

## Environment & Tooling

- Package manager: npm (`npm install --legacy-peer-deps`).
- Build & Deploy: `npm run build` (runs `tsc -noEmit -skipLibCheck`, production `esbuild`, and `scripts/deploy.mjs`).
- Standalone Deploy: `npm run deploy` (copies artifacts to the ABC vault `.obsidian/plugins/plugin-update-tracker-custom/` and triggers `obsidian plugin:reload`).
- Tests: `npm test` (runs Jest suite under `src/` and `oput-common/`).

## Custom Features

- **GitHub Diff Retrieval (`src/domain/githubDiff.ts`)**: Uses Obsidian `requestUrl()` to fetch source diffs between installed and target versions via GitHub Compare API, filtering lockfiles and extracting security signals.
- **Jev Security Evaluation (`src/domain/jevSecurityCheck.ts`)**: Calls TypeSafe AI `/v1/systemone` (`jev-1.14.0`) via `requestUrl()` with typed `noul`, `score`, and `choice` questions.
- **Approval Checklist & Update Gate (`src/domain/securityChecklist.ts`)**: Persists approval states in `plugin.settings`, optionally syncs a Markdown checklist note in the vault for human or AI review, and blocks unapproved updates when enabled.

## Coding Guidelines

- Use Obsidian's `requestUrl()` instead of `fetch()` for all external HTTP requests.
- Never use regex lookbehinds (keep iOS WebKit compatibility).
- Keep working tree changes uncommitted for user review prior to committing.
