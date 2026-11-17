# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Dance Cube Arranger (舞立方谱面编辑器) is a local-first visual chart editor for Malody V `mode:9` (6-column cube) charts, distributed as a portable Windows app. The app lives in `arranger-ui/` — Next.js 16 App Router, React 19, TypeScript, Tailwind v4, Canvas 2D. The repository root adds PowerShell launch/packaging tooling and a stdlib-only Python bridge for `.mcz` import/export. There is no database: working state and snapshots are JSON files under `artifacts/arranger/`.

## Commands

Run app commands from `arranger-ui/`:

```bash
npm ci                          # install from the committed lockfile
npm run dev                     # dev server (next dev --webpack)
npm run build                   # standalone production build; also the TypeScript type gate
npm start                       # serve the production build
npm run lint
npm test                        # full Vitest suite (Node environment)
npm test -- tests/beat.test.ts  # one test file
npm run test:watch
npm run pack                    # build + portable ZIP via scripts/build_dist.ps1 -Zip
```

- Double-click the root `启动编辑器.bat` / `启动编辑器.exe` to launch; stop with `停止编辑器.bat` / `停止编辑器.exe`. The launcher prefers port 3000, then 3210–3299, and opens the browser.
- Run the server somewhere inside this repo: `findRepoRoot()` walks upward until it finds `configs/column_geometry.json`.
- Import/export requires Python; audio/cover normalization requires ffmpeg/ffprobe. Use npm only (a lockfile is committed).
- Before finishing a code change, run `npm test`, `npm run lint`, and `npm run build`, then manually verify affected browser interactions.

### Working from WSL

The repo lives on a Windows drive and is often driven from WSL:

- `npm run pack` shells out to `powershell` and `scripts/build_dist.ps1`, so it is Windows-only. The script tries machine-specific Node/ffmpeg paths first and falls back to `PATH`.
- `tests/launcher-startup.test.ts` is skipped unless running on Windows with `csc.exe`, so changes to `scripts/launcher/Launcher.cs` or `scripts/editor_server*.ps1` are not covered by `npm test` here — verify them on Windows.
- Hot reload under `/mnt/*` needs polling: `WATCHPACK_POLLING=true npm run dev`.
- Line endings: `.gitattributes` covers only `.bat` / `.cmd` / `.ps1`. Other tracked files can be CRLF in the working tree while LF in the index, which makes plain `git diff` show whole-file rewrites. Use `git diff --ignore-cr-at-eol` to see real changes, keep each file's existing line endings when editing, and do not mass-normalize.

## Architecture

### URL is state; projects are opaque IDs

`/` renders the project list (`StartScreen`). `?src=managed:<16-hex project>:<12-hex chart>` opens the editor (`EditorShell` passes it to `EditorSession`, remounted with `key={src}` so no state leaks between projects). `artifacts/arranger/registry.json` (schema 3) maps stable opaque IDs to server-owned workspaces; absolute paths exist only in the registry and POST bodies, never in URLs. Legacy repo-relative `?src=<path>.mc` values are still accepted and rewritten to managed refs when a registry alias exists — keep new flows on managed refs.

### Client edit pipeline

`GET /api/chart?src` returns raw `.mc` text plus its sha1; `parseMc` parses it in the browser. Notes are grouped into onsets by exact rational `tickId` (`Beat = [A, B, C]`), and every edit is an immutable `AssignmentsMap` update produced by pure functions in `src/lib/arrangement.ts` and `src/lib/editor-state.ts`. `EditorSession.tsx` is the orchestration hub (load geometry/chart/state, seed or restore, keyboard and gesture wiring, autosave, snapshots, export); `Timeline` and `HexPreview` render Canvas from props read through refs and emit events. Components contain no decision logic — put behavior in `src/lib/` with a test in `tests/`.

### Two independent undo stacks

Arrangement snapshots contain `assignments + addedOnsets + deletedOnsetIds` (all three must be restored together). Structure snapshots contain the full `SegmentStructureV3`. `Ctrl+Z` / `Ctrl+Y` affect only arrangement history; structure undo/redo has its own buttons. Structure clips/segments (桥段) are editor-only and are never written into `.mc`. `SegmentStructureV3` also carries relations between segments (`repeat` / `upgrade` / `variation` / `contrast` / `custom`). On load, `restoreSegmentStructure()` in `src/lib/segments.ts` resets any saved structure that is not schema 3 or was auto-seeded to an empty manual one.

### Persistence is files, not a database

Autosave is debounced 800 ms (max wait 5 s) to `POST /api/state`, with a `pagehide` → `sendBeacon` fallback. Snapshots are manual plus every 5 minutes when dirty; the newest 50 are kept under `artifacts/arranger/projects/<sha1(ref)[:16]>/{state.json,snapshots/}`. Writes are atomic tmp+rename. Explicit save calls `POST /api/projects/save`: it writes the workspace first, then syncs the external source (first overwrite creates `<name>.orig`; fingerprint/sha1 conflicts return 409) or atomically repacks `.mcz`. Note that `GET /api/projects` is not read-only — it registers imports, adopts legacy history, and writes the registry.

### Server boundary

`src/lib/server/**` is server-only. Every route runs on the Node runtime with `dynamic = "force-dynamic"`. `resolveSrc()` in `src/lib/server/paths.ts` validates and containment-checks every `?src`. `isLocalRequest()` guards only the sensitive native endpoints (`projects/open-path`, `projects/create`, `system-dialog`, `update/apply`); the rest assume a single-user local same-origin deployment. Managed flows copy protected `WDA/` sources on first mutation (`copyOnWrite`); legacy writeback permits `WDA/` and `artifacts/` but always refuses `data/corpus/`.

### Import/export via Python

`POST /api/import` accepts either one `.mcz` (unpacked by `scripts/import_mcz.py`) or an `.mc` plus optional audio/cover. Assets are discovered by "exactly one candidate per extension in the directory"; ambiguity is an error, never guessed. Export is `.mcz`-only through `POST /api/export/mcz` and `scripts/export_arranged_mcz.py`; explicit source save is a separate operation. Bridges run with cwd = repo root and relative paths, use the Python standard library only, and communicate through the contract "last non-empty stdout line is JSON"; timeouts are 120 s for import, 180 s for export/save/manage. Windows backslash paths returned by the bridge must be normalized on the Node side. Python resolution order lives in `src/lib/server/paths.ts` (`PYTHON_EXECUTABLE` → `ARRANGING_PYTHON` → bundled `bin/python` → venvs → PATH).

`scripts/import_mcz.py` and `scripts/export_arranged_mcz.py` are thin CLI entry points; the logic is the `scripts/bridge/` package (`mc_parser`, `mc_writer`, `time_map`, `beat`, `audio`, `mcz`, `exporter`). Beat and time-map math therefore exists twice — `src/lib/beat.ts` and `src/lib/timemap.ts` in TypeScript, `scripts/bridge/beat.py` and `scripts/bridge/time_map.py` in Python — and the two must change together.

### Timing and audio (most subtle)

The chart uses multi-BPM time maps and Malody's signed audio offset: `audioSec = chartSec − offset/1000` (never `|offset|`; WDA's −463 puts beat 0 at +0.463 s), identically in `src/lib/timemap.ts` and `scripts/bridge/mc_writer.py`. Playback uses `src/lib/audio-engine.ts` — WebAudio plus vendored soundtouch WSOLA, worklet with a ScriptProcessor fallback. The playhead is anchored to `AudioContext.currentTime`; never read `percentagePlayed`, which reflects the WSOLA input buffer and leads the audible output. Pause must gate and then disconnect the worklet, and kick scheduling uses the same anchor. `nudgeMs` and `kickOffsetMs` affect preview only and are never written to `.mc`. Read `arranger-ui/spec.md` §5 before changing any timing math.

### Runtime and packaging

Next uses `output: "standalone"`; standalone builds without adjacent `.next/static` are rejected to avoid white screens. `scripts/build_dist.ps1` assembles `dist/dance-cube-arranger/` (server, launcher exes, bundled Node/ffmpeg/ffprobe and Python 3.12.8 embed, configs, scripts, WDA), and `npm run pack` zips it; `dist/` is generated. `scripts/editor_server.ps1` and `scripts/launcher/Launcher.cs` use one PowerShell entry point for Next.js development and standalone modes. The script locks start/stop per installation and records PID, port, and logs under `artifacts/arranger/`. The `postbuild` script copies `.next/static` and `public/` into `.next/standalone`.

Self-update: `GET /api/update/check` reads the latest GitHub release of `KaysonSear/dance-cube-arranger` (override with `ARRANGER_GITHUB_REPO`) and compares it using `compareVersions()`; `POST /api/update/apply` is local-only and hands off to `scripts/apply_update.ps1`.

Bump the application version in `arranger-ui/package.json`, `arranger-ui/package-lock.json`, and `arranger-ui/src/lib/version.ts` together. The packager reads the version from package.json. Also update the download links in all three languages in `README.md`.

### Assets and config

`configs/column_geometry.json` is read at runtime by `GET /api/geometry` and is also the repo-root sentinel. Never hardcode column coordinates or display the reference-only "habit" numbers. `WDA/` and `artifacts/skeletons/` are tracked inputs; `artifacts/arranger/*` is gitignored user data (except `.gitkeep`).

## Invariants and conventions

- `WDA/` and `data/corpus/` are read-only inputs. `artifacts/arranger/` is live user data — do not wipe or commit it. `dist/` is generated.
- Never emit `dir` notes. Preserve source metadata and time values verbatim except for explicit BPM/offset overrides; unassigned source notes pass through unchanged.
- Theme: Claude/Anthropic light parchment. DOM uses only `@theme` tokens; Canvas uses only `THEME` from `src/lib/theme.ts`. No dark mode, cool grays, or decorative gradients (note material is the exception).
- TypeScript strict; two-space indentation, double quotes, semicolons; `@/` alias resolves to `src/`. Tests mirror `src/lib` modules as `tests/<module>.test.ts`; the WDA golden test auto-skips when its source file is absent.
- `.bat`, `.cmd`, and `.ps1` files are intentionally CRLF. PowerShell scripts dot-source siblings via `$PSScriptRoot`, so keep them together.
- Before changing editing semantics, timing math, or export behavior, read `arranger-ui/spec.md` (the authoritative behavior spec). `arranger-ui/AGENTS.md` warns that Next.js 16 differs from training data — read the relevant guide in `node_modules/next/dist/docs/` before writing app code.

## References

- `arranger-ui/spec.md` — functional spec, data structures, interaction state machine, acceptance checklist.
- `README.md` — user-facing portable install, update, and data-safety documentation (GPL-3.0).
- `arranger-ui/AGENTS.md` — Next.js 16 warning.
- Partly stale, trust `spec.md` and the code where they disagree: `arranger-ui/README.md` (old `启动排键器.bat` names, repo-relative `?src` addressing, an outdated test baseline), `arranger-ui/start.sh` (old `.bat` names), and the root `AGENTS.md` (claims the checkout has no Git metadata).
