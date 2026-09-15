# Repository Guidelines

## Project Structure & Module Organization

- `arranger-ui/` contains the Next.js 16, React 19, TypeScript, and Tailwind CSS application.
- `arranger-ui/src/app/` contains routes and API handlers; `components/` contains UI components, `hooks/` reusable React hooks, and `lib/` editor logic.
- `arranger-ui/tests/` contains Vitest tests; `public/` holds static assets.
- `scripts/` contains PowerShell launch, packaging, and update tools plus Python import/export bridges.
- `configs/` stores physical key geometry; `WDA/` contains sample media.
- `artifacts/` stores user projects and snapshots. Treat it as user data. `dist/` contains generated distribution files; make source changes outside it.

## Build, Test, and Development Commands

Run these commands from `arranger-ui/`:

- `npm ci`: install dependencies from the lockfile.
- `npm run dev`: start the development server using Webpack.
- `npm run build`: create the production build.
- `npm start`: serve the production build.
- `npm run lint`: run ESLint.
- `npm test`: run the full Vitest suite once.
- `npm run test:watch`: run tests interactively.
- `npm run pack`: build a portable ZIP through PowerShell.

Import/export workflows also require Python and ffmpeg/ffprobe.

## Coding Style & Naming Conventions

Follow existing TypeScript style: two-space indentation, double quotes, semicolons, and strict typing. Use PascalCase component filenames, `use`-prefixed hooks, and descriptive camelCase functions. Follow nearby module filenames, including kebab-case utility names. The `@/` alias resolves to `src/`.

ESLint uses Next.js Core Web Vitals and TypeScript rules. Follow existing Python formatting and retain standard-library-only bridge dependencies.

Read `arranger-ui/AGENTS.md` and relevant bundled Next.js documentation before changing application code.

## Testing Guidelines

Vitest runs in Node and discovers `tests/**/*.test.ts`. Use descriptive `describe` and `it` blocks. Add regression tests for changed behavior, especially timing, undo, persistence, and import/export boundaries.

Run a focused test with `npm test -- tests/beat.test.ts`. Before submitting code changes, run tests, lint, and build. No coverage threshold is configured. Manually verify affected browser interactions.

## Commit & Pull Request Guidelines

This checkout has no Git metadata, so historical commit conventions cannot be verified. Use short, imperative commit subjects describing the change.

Pull requests should explain the problem, resulting behavior, and validation performed. Link relevant issues and include screenshots for visible UI changes.
