---
name: multi-agent-review-plan
description: Before implementation, send the current task's high-level plan to Codex + Antigravity in parallel for review, aggregate feedback, revise the plan, and review again until there are no new issues. Strictly limit both plan authoring and review to technology selection, high-level architecture, business direction and flow, and basic business logic; exclude implementation details and code expression. Use when the user says "review my plan", "review the plan before coding", "run a dual review on the plan first", or "check whether this approach is okay". Reviewers only review; they do not edit files.
metadata:
  version: "1.1.0"
---

# multi-agent-review-plan - Dual-Reviewer Closed-Loop Review For High-Level Plans

Use a dual Codex + Antigravity review **before writing code** to align direction. Review only decisions that must be settled before implementation; leave all implementation details to implementation and code review.

## Hard Scope Contract (Plan Author + Reviewers + Aggregator)

Apply this contract equally to the plan author, every reviewer, and the agent aggregating feedback. Do not relax it because a reviewer requests more detail.

The plan may cover only:

1. **Technology selection**: major language, framework, datastore, messaging, protocol, deployment-pattern, or third-party-service choices, with rationale and high-level tradeoffs.
2. **High-level architecture**: conceptual components, responsibilities, boundaries, ownership, dependencies, and interaction direction.
3. **Business direction and flow**: the intended outcome, actors, scope / non-goals, end-to-end main and exception flows, and conceptual state transitions.
4. **Basic business logic**: business rules, invariants, boundary conditions, and acceptance points.

Exclude all implementation detail and code expression, including affected files or repository modules, package / class / function / variable names, signatures, snippets, pseudocode, algorithm mechanics, schemas / tables / fields / DDL, endpoint or payload definitions, cache keys, queries, configuration keys / values, exact versions, CLI flags, paths, commands, test cases / tooling, and line-level migration, rollback, concurrency, transaction, or error-handling mechanics. Mention reliability, consistency, security, compatibility, migration, or rollback only when it changes a permitted high-level choice or business rule, and keep it at that level.

If a statement requires code-shaped detail to explain or resolve, it is out of scope. The author must remove it; reviewers must not raise it, even as a nit; the aggregator must discard it rather than write it into the plan.

## Execution Mode: Dual Review / Single-Review Fallback / Sub-Reviewer Bypass

Before starting, determine which of the three scenarios applies to the agent currently executing this skill:

- **Default (Claude Code, or any non-Codex main agent)**: dual review with Codex + Antigravity in parallel.
- **Codex as sub-reviewer (invoked by a parent agent through `codex exec` to review a plan)**: **do NOT run this skill at all**. The prompt from the parent agent already contains a review request; just perform the review directly and return findings. Never dispatch Codex, Antigravity, or any other reviewer/agent from here. The Codex prefix line in Step 3 below always carries this instruction, so if you see it in your incoming prompt, exit the skill immediately and just review.
- **Codex as main agent (a user directly asked Codex CLI to run this review skill)**: **fall back to a single review** by running only Antigravity. Rationale: Codex self-review is equivalent to having the plan author review their own plan, without an independent perspective; keep Antigravity as the external reviewer. In fallback mode:
  - Step 3 dispatches only Antigravity and skips the Codex path.
  - Step 4 aggregation is done as a "single reviewer"; descriptions such as "both reviewers found this" do not apply.
  - The final report must state that this round used **single-review fallback** mode and explain why, so the user does not mistakenly think Codex also approved it.
- **How to decide**:
  - Incoming prompt contains the sub-reviewer prefix from Step 3, OR the prompt is a direct review request forwarded by a parent agent → **sub-reviewer bypass**.
  - Executor is Codex CLI and the user directly asked Codex to "run the plan review loop" / "review my plan with dual reviewers" → **single-review fallback**.
  - Otherwise → **default dual-review**.

## Step 1 - Confirm There Is A Plan To Review

- Complex or multi-step tasks: if the conversation does not yet contain a structured high-level plan, **write one first** (it can be produced in the current conversation; no need to persist it). Include only: business goal / scope / non-goals; material technology choices and rationale; conceptual architecture and interactions; business flow, states, rules, boundaries, and acceptance points; high-level assumptions, risks, and open decisions within the Hard Scope Contract.
- Existing sufficient plan: skip the plan-writing step and use the existing plan directly.
- If the task itself is trivial enough (1-2 steps, implemented in one pass), this skill does not apply; implement directly.

**Pre-dispatch self-audit (main agent, MUST run before every dispatch)**: compare every plan statement with the Hard Scope Contract. Remove affected-file lists, code identifiers, schemas, APIs, configuration, commands, tests, pseudocode, and implementation sequences. Replace implementation-shaped descriptions only when they can be expressed as a permitted technology choice, conceptual component interaction, business flow, or business rule; otherwise delete them. If the incoming plan is mostly implementation-level, rewrite it before review. Dispatch only after every remaining statement is in scope.

## Step 2 - Assemble The Shared Message Body

Both reviewers use the same body, with only different prefix lines:

```
Review the following high-level plan for correctness, coverage, and direction. Review ONLY:
  1. Technology selection - whether each material choice is suitable and whether its stated high-level tradeoffs are sound
  2. High-level architecture - whether conceptual responsibilities, boundaries, ownership, dependencies, and interactions are coherent
  3. Business direction and flow - whether the plan addresses the real need and covers realistic main / exception flows and conceptual state transitions
  4. Basic business logic - whether business rules, invariants, boundaries, non-goals, and acceptance points are complete and mutually consistent
  5. High-level assumptions and risks - only where they materially affect one of the four areas above

Within this scope, focus on issues that can realistically bite this project under its actual usage patterns and constraints. Do NOT raise must-fix / should-fix items for contrived high-level scenarios, such as global-scale architecture for a small internal tool, multi-tenant design for a permanently single-tenant product, or a new platform dependency for a one-shot workflow. If unsure whether an in-scope scenario is realistic, classify it as nit and state the assumed trigger condition.

**Hard boundary:** do not discuss or request implementation details or code expression. Do not comment on files / repository modules, code organization, symbols, signatures, snippets, pseudocode, algorithm mechanics, schemas / fields / DDL, APIs / payloads, cache keys, queries, configuration, exact versions, flags, paths, commands, tests / tooling, or low-level operational mechanics. If such content remains in the plan, ignore it. Do not mention it even as a nit. If a finding can only be explained or fixed with those details, omit the finding entirely; it belongs in implementation or code review.

You are reviewing; do NOT propose implementation steps, code edits, or file changes, and do not modify any files. List only in-scope findings, each with a one-sentence high-level rationale. Classify each as must-fix / should-fix / nit. Return "no in-scope findings" when appropriate.

Plan under review:
<PLAN_TEXT>

Previously dismissed items (do not re-raise unless you have new evidence that materially changes the judgment): <DISMISSED_LIST>
```

`<PLAN_TEXT>` = the original text of the plan from Step 1; do not compress it.

`<DISMISSED_LIST>` = the list of items downgraded / dropped in previous rounds together with the reason (from Step 4's aggregated report). Empty on round 1; from round 2 onward, the main agent MUST populate it verbatim from the prior round's report so reviewers know what has already been considered and rejected.

## Step 3 - Dispatch Reviewers

| Reviewer | Prefix line | Perspective |
|---|---|---|
| Codex | `Execute directly without asking for confirmation. Do not repeat or echo the request back. You are invoked as a sub-reviewer — perform the review yourself and output findings only. Do NOT invoke the multi-agent-review-plan or multi-agent-review-code skill. Do NOT call agy-wrapper, codex exec, or any other reviewer/agent. Just review and return.` | Technology choices, architecture coherence, and business-logic edge cases at the high-level-plan scope |
| Antigravity | `Do NOT run any git write commands (commit, push, reset, etc.). Git repository is read-only for you. Do NOT modify any files. Read-only operations only — provide findings as text/diff in your response.` | High-level architecture, design consistency, alternative angles |

Transport:
- Write prompts to `./tmp/review-plan-codex-prompt-<ts>.txt` and `./tmp/review-plan-agy-prompt-<ts>.txt` respectively (fallback mode only needs the agy prompt).
- **Prompt files MUST be created using the agent's built-in Write / Edit tools** (Claude Code: `Write`; Codex CLI: its `apply_patch` / file-write tool). Do NOT generate them via shell (`echo`, `cat <<EOF`, `printf`, `tee`, `>` redirection, PowerShell `Set-Content`, etc.) — on Windows Git Bash, shell heredocs and quoting mangle backticks, `$`, backslashes, and CRLF, corrupting the prompt. The built-in file tools write the exact bytes.
- **Dual-review mode**: issue two Bash background calls side by side in one message (`run_in_background: true`, `timeout: 1800000`) to ensure parallelism. **Always wrap the reviewer command in `bash -lc "..."`** so it runs under a login shell (PATH / helper functions like `_cmake_ps` etc. are available). Use double quotes for the outer `bash -lc` argument and escape the inner double quotes for `$(bat ...)` — single quotes break argument passing on Windows Git Bash:
  ```bash
  bash -lc "codex exec -s read-only --skip-git-repo-check \"\$(bat --plain --paging=never ./tmp/review-plan-codex-prompt-<ts>.txt)\""
  ```
  ```bash
  bash -lc "agy-wrapper --dangerously-skip-permissions --timeout 30m -p \"\$(bat --plain --paging=never ./tmp/review-plan-agy-prompt-<ts>.txt)\""
  ```
  Continue to Step 4 only after both return.
- **Single-review fallback mode (executor is Codex CLI)**: run only one path (still wrapped in `bash -lc "..."`):
  ```bash
  bash -lc "agy-wrapper --dangerously-skip-permissions --timeout 30m -p \"\$(bat --plain --paging=never ./tmp/review-plan-agy-prompt-<ts>.txt)\""
  ```
- Poll results with `TaskOutput`, and delete temporary files after completion.
- If one CLI is missing (for example `agy-wrapper` is not on PATH), tell the user and continue with the remaining reviewer. Do not pretend the missing reviewer also passed. In fallback mode, if `agy-wrapper` is missing, tell the user this round cannot be reviewed; do not fall back to Codex self-review.
- **Do not start implementation** until feedback from all reviewers has been received.

## Step 4 - Aggregate Feedback And Update The Plan

- **Apply the Hard Scope Contract first**: discard every out-of-scope finding before deduplication or classification, regardless of reviewer severity. Do not downgrade it to nit, report it as an open decision, repeat its implementation detail, or write it into the plan. In the aggregation summary, state only how many findings were discarded as implementation detail.
- **Deduplicate the remaining in-scope findings**: merge the same root cause identified by both reviewers into one item, and note when both found it.
- **Reclassify the remaining findings** into **must-fix / should-fix / nit**: must-fix = at least one reviewer marks it must-fix **and** the main agent independently judges the issue would affect high-level plan validity; should-fix = at least one reviewer marks it should-fix (or must-fix reclassified down) **and** the main agent judges it worth incorporating. Reviewers can be wrong; be willing to disagree.
- **Apply these additional gates before updating the plan** (the main agent MUST apply them in order):
  1. **Realistic-likelihood filter**: downgrade to nit (or drop entirely) any in-scope item whose triggering condition is nearly impossible under this project's real usage. Ask: "Under what realistic scenario does this affect the selected technology, high-level architecture, business flow, or basic business rule?" If the answer is contrived, do not incorporate it.
  2. **Divergence guard**: if a new round repeats an item already dismissed without materially new high-level evidence, dismiss it by reference and do not re-litigate.
  3. **Goal scope-creep guard**: downgrade in-scope should-fix items that materially expand the stated business goal by adding features, architectural capabilities, or adjacent work.
  4. **Plan-bloat / non-convergence guard**: if the current plan length is > 1.5× the round-1 plan length, OR round N's must-fix count is not strictly less than round N-1's, stop looping and report to the user. Likely causes are scope drift or a Story-scope task that should be split. Ask the user which recovery path to take before continuing.
  5. **State the reason** for every downgrade / drop in the aggregated report, so the user can override if they disagree.
- Report the aggregated list — including downgrades and drops with reasons — to the user in **Chinese**.
- **Modify the plan for in-scope must-fix and should-fix items only**; leave in-scope nit items for the user to decide. Never satisfy feedback by adding implementation detail.
- After updating the plan, increment the round count and return to Step 2 for another review.

## Step 5 - Exit Conditions

**Stop** when any of the following is true:
- Must-fix count AND should-fix count after aggregation in the current round are both 0.
- The main agent judges all remaining must-fix and should-fix items invalid and gives reasons.
- The Step 4 Plan-bloat / non-convergence guard fires — pause and hand off to the user with recovery options, do not continue looping until the user picks one.

There is **no hard round cap** — keep looping as long as new in-scope must-fix or should-fix items keep appearing, **but** the non-convergence guard will terminate a runaway loop before it consumes many rounds. Typical healthy convergence is 2–3 rounds; if you are past round 3 and still adding must-fix items, that is a signal that the plan-vs-review scope is mismatched.

## Final Report (Chinese)

- How many rounds ran, and what each reviewer found in each round.
- The final plan version (what changed and why).
- Not fixed: remaining nit items / must-fix or should-fix items the main agent judged invalid, with reasons.
- Points the user needs to decide: explicitly ask the user to confirm before implementation.
