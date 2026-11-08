# Agent Instructions

## Project Context

Read `shared/agent-context/AGENTS.md` alongside this file for shared agent
instructions. If the shared context is unavailable, initialize the submodule
with `git submodule update --init --recursive` and report any access problems.

Read `BRIEF.md` and the relevant integration notes in `docs/` before working on
assignment behavior. Treat contradictions and unsafe requests as issues to
surface, not requirements to resolve silently. Preserve supplied materials and
the existing repository history.

The intended backend is TypeScript on Node.js 26 with Express, PostgreSQL,
Drizzle ORM and `pg`; use Docker Compose for local PostgreSQL and Vitest for
tests. Inspect the repository for what is actually configured before assuming
commands or dependencies exist.

## Working Rules

- Write specs in `specs/` for PB-03 through PB-06 before implementation. Each
  spec must land in a commit before its implementation; do not commit without
  the user's request.
- Prefer small, testable changes. Document assumptions and ask about consequential
  ambiguities, particularly around pricing, authentication, and session state.
- Protect concurrent operations and retries with appropriate database mechanisms;
  verify important behavior against PostgreSQL, not only mocks.
- Never commit secrets or use the development database as a disposable test
  database. Document configuration and verification for a fresh clone.
- Do not invent journal entries, model usage, time spent, or costs.

## OpenCode Agents

Project-specific OpenCode agents are defined in `.opencode/agent/`.

- `plan-agent.md`: Interactive planning, specifications, and implementation
  handoffs.
- `dev-agent.md`: Backend implementation, testing, and task-relevant tooling.
- `review-agent.md`: Independent review of changes, features, and specifications.

Consult the relevant agent definition when using that agent; shared instructions
in this file also apply.
