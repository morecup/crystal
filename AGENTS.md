# Repository Guidelines

## Project Structure & Module Organization
- Root `pnpm` workspace with packages: `main/` (Electron main process, TypeScript), `frontend/` (React + Vite), `shared/` (shared types), and `tests/` (Playwright E2E).
- Key paths: `main/src/{services,ipc,utils}/`, `frontend/src/{components,hooks,stores,utils}/`, `main/assets/`, `scripts/`.
- Build artifacts: `frontend/dist/`, `main/dist/`, packaged output `dist-electron/`.

## Build, Test, and Development Commands
- Dev app: `pnpm dev` (spawns frontend + Electron).
- Build all: `pnpm build` (frontend, main, then electron package).
- Package (examples): `pnpm build:mac`, `pnpm build:linux`.
- Lint: `pnpm lint`; Type-check: `pnpm typecheck` (runs per package).
- Tests (E2E): `pnpm test`, `pnpm test:ui`, CI configs in `playwright.ci*.config.ts`.
- Main unit tests (if added): `pnpm --filter main test`, coverage: `pnpm --filter main run test:coverage`.

## Coding Style & Naming Conventions
- Use TypeScript throughout; follow ESLint configs in `frontend/eslint.config.js` and `main/eslint.config.js`.
- Indentation 2 spaces; prefer explicit types at module boundaries.
- Naming: `camelCase` for variables/functions, `PascalCase` for React components/types, `kebab-case` for filenames (React files may match component name).
- Run `pnpm lint && pnpm typecheck` before sending PRs.

## Testing Guidelines
- E2E tests live in `tests/*.spec.ts` (Playwright). Example: `pnpm test -- tests/smoke.spec.ts`.
- Add Playwright tests for user-visible flows; mock external services where possible.
- For backend logic in `main/`, use Vitest colocated under `main/src/**/__tests__` or `*.spec.ts`.

## Commit & Pull Request Guidelines
- Commits: present tense, focused, reference issues (e.g., "Fix session diff flicker, closes #123").
- PRs must include: clear description, linked issues, testing notes; screenshots/GIFs for UI changes.
- If dependencies change, run `pnpm run generate-notices` and commit updated `NOTICES`.

## Security & Configuration Tips
- Node >= `22.14`; `pnpm` >= `8`. Use `pnpm` only.
- Secrets via `.env` (dotenv) for local dev; never commit secrets.
- To avoid clobbering local data when hacking on Crystal with Crystal: `CRYSTAL_DIR=~/.crystal_test pnpm dev`.

## Agent Notes (for automation)
- Keep changes minimal and scoped; prefer small patches.
- Update docs alongside code; do not alter build targets without discussion.
- Use repository scripts (pnpm) and keep formatting consistent with existing files.
- Always review the root `CLAUDE.md` before beginning any work. 
- Scan the repository for every `CLAUDE.md`, and when working in a folder or any of its subfolders that has one, read and follow that file too.
- 我们之间使用中文交流和生成文档。git提交信息也需要使用中文。

- 前端禁止使用 `window.confirm`/`window.alert` 等阻塞式原生对话框；统一使用应用内的非阻塞 `ConfirmDialog`（`frontend/src/components/ConfirmDialog.tsx`）或 `Modal` 组件。原因：在 Electron/Chromium 下阻塞对话框会导致键盘修饰键状态丢失，引发输入框短时间（约 30–40 秒）无法输入的问题。涉及操作（如 Diff 面板的 Revert/Restore、文件回滚/删除、项目设置确认等）一律使用 `ConfirmDialog`。