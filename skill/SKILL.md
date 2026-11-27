---
name: dual-agent-collab
description: >-
  Run the standardized 5-stage Antigravity + Codex Desktop Client workflow.
  Use when the user starts a project with the dual-agent workflow ("双人流程",
  "我来做设计 Codex 写代码", "Antigravity + Codex 协作"), requests project
  scaffolding for Codex handoff, or asks to review/accept Codex deliverables.
---

# Tri-Agent Collaboration Workflow (Antigravity × Claude × Codex)

Antigravity owns **overall architecture, frontend design, task slicing, and
design/UX acceptance**. **Codex** and **Claude** Desktop Clients collaborate on
**backend detailed design, production/test coding, deep architecture/bug
solving, and independent engineering code review**.

All handoffs happen through repository files (`AGENTS.md`, `CLAUDE.md`, and
`docs/`)—never rely on verbal summaries alone.

## Quick Project Initialization

For any new project directory `<dir>` and name `<name>`, run the initializer:

```powershell
F:\SnowLuma\node.exe C:\Users\kmn40\.gemini\config\skills\dual-agent-collab\scripts\init-project.mjs "<dir>" "<name>"
```

This scaffolds `AGENTS.md`, `CLAUDE.md`, `docs/01-brief.md` through
`docs/05-review-log.md`, `prototypes/`, and `.collab-state.json` (used by
CollabStudio).

## File Ownership Rules

- **Antigravity writes**: `AGENTS.md`, `CLAUDE.md`, `docs/01-brief.md`,
  `docs/02-frontend-spec.md`, `docs/04-tasks.md` (plan/criteria), `prototypes/`.
- **Codex / Claude write**: `src/`, `tests/`, config files,
  `docs/03b-backend-design.md`, `docs/05-review-log.md` (review log).
- **Shared contract**: `docs/03-api-contract.md` (drafted by Antigravity,
  refined and frozen with Codex/Claude; no silent schema drift after freeze).
- **No editing wars**: Never assign the same Milestone concurrently to Codex
  and Claude; Antigravity writes structured fix tickets in `05-review-log.md`
  instead of directly editing `src/` during QA.

## 5-Stage Procedure

### Stage 1: Project Brief & Overall Architecture (Antigravity)
1. Clarify goal, core user journeys, explicit V1 non-goals, tech stack, and
   module boundaries with the user.
2. Fill `docs/01-brief.md` and customize project-specific rules in `AGENTS.md`
   (see [agents-template.md](./resources/agents-template.md)).
3. **Gate 1**: Get user approval before moving to Stage 2.

### Stage 2: Frontend Design, Contract Draft & Task Slicing (Antigravity)
1. Write `docs/02-frontend-spec.md`: Design Tokens (colors, typography,
   spacing, motion), page hierarchy, component tree, and all states
   (default / loading / empty / error / disabled).
2. For visually rich pages, create static HTML/CSS references in `prototypes/`.
3. Draft `docs/03-api-contract.md` from frontend data needs.
4. Break work into vertical-slice Milestones in `docs/04-tasks.md` (each slice
   completable in 1–2 Codex turns with explicit acceptance checks).
5. **Gate 2**: Confirm visual/UX direction with the user, then provide the
   Stage 3 Codex Client prompt from [codex-prompts.md](./resources/codex-prompts.md).

### Stage 3: Backend Design & Contract Freeze (Codex -> Antigravity Verify)
1. User hands off to Codex Desktop Client using the Stage 3 prompt (no
   business coding yet).
2. Codex writes `docs/03b-backend-design.md` and flags contract adjustments.
3. Antigravity reviews changes, resolves conflicts, marks `03-api-contract.md`
   as **FROZEN**, updates `.collab-state.json`, and outputs the Stage 4 prompt.

### Stage 4: Vertical-Slice Implementation (Codex)
1. Codex implements one Milestone at a time, matching `02-frontend-spec.md`,
   `prototypes/`, and `03-api-contract.md`, running tests/build, ticking
   `04-tasks.md`, and committing per Milestone.
2. If Codex finds design issues, it logs proposals in `05-review-log.md`
   under `待设计确认` instead of silently changing UX/contracts.

### Stage 5: Dual Review & Acceptance (Codex + Antigravity)
1. **Codex Engineering Review**: Runs strict review, logs P0/P1/P2 findings in
   `docs/05-review-log.md`, fixes P0/P1, and re-runs tests.
2. **Antigravity Design QA**: Verifies visual fidelity, interaction states,
   and acceptance criteria. Logs any UI/UX defects as structured tickets
   (page / component / actual / expected) for Codex to fix.
3. **Gate 5**: Both engineering review and design QA pass -> ready to merge.

## Key Tri-Model Collaboration Guardrails

- **Blind Dual-Proposal**: For major architecture plans, Antigravity (Gemini)
  and Claude each draft an independent plan from the user's raw requirements
  without seeing the other's draft; then verify facts against code and merge.
- **Copy & UX Polish**: Have Antigravity (Gemini) rewrite robotic AI UI copy
  into natural human product copy (target user + goal + before/after table).
- **Two-Tier Review (Max 2 Rounds)**: Only concrete bugs that miscalculate
  money, lose data, escalate privileges, send wrong external messages, or break
  releases (with reproduction steps) are **Blockers**; everything else is a
  **Suggestion**. Cap at 2 rounds before human sign-off.
- **Mistake → Guardrail**: Every user correction or review rejection must add a
  type check, guard test, or structural constraint in the same PR so that class
  of bug cannot recur.
- **Ask-First List**: Always ask the user before deleting data, stopping
  services, spending money, posting external messages, changing product
  direction, rotating secrets, or modifying permissions.

## Companion Desktop App

Users can manage projects, stage gates, `AGENTS.md`/`CLAUDE.md`/`GEMINI.md`,
docs, and one-click prompts for all three agents in the standalone Electron app
**CollabStudio** (`F:\CollabStudio\dist\CollabStudio-win32-x64\CollabStudio.exe`). Keep
`<project>/.collab-state.json` in sync when updating stage or gates.
