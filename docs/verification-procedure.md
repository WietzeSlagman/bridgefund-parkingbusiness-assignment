# Reusable verification procedure

Use this procedure after a backend or delivery-tooling change, alongside
`AGENTS.md` and the user's instructions. Do not infer success from a previous run.

1. Inspect the working tree, relevant instructions, scripts and changed files;
   preserve unrelated changes. Identify which checks apply and any missing tools.
2. Before database tests or migrations, verify that the target is the intended
   isolated test instance, including its container, port mapping, storage and
   database/user identity. Never reset or migrate an unverified target.
3. Run the applicable configured checks, including lint, formatting, type-check,
   build and tests. Run dependency audits when dependencies or delivery checks
   are in scope. Record failures and skipped checks rather than hiding them.
4. Review the diff and report commands, results and remaining risks. Append a
   factual dated journal entry, with model, tools, mistakes, time and cost only
   as known. Independent review remains separate from self-verification.
