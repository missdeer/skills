---
name: multi-agent-review-plan
description: Before implementation, send the current task's implementation plan to Codex + Antigravity in parallel for plan review -> aggregate feedback -> revise the plan -> review again until there are no new issues. Use this to align direction before coding and avoid discovering the direction was wrong only after implementation. Use when the user says "review my plan", "review the plan before coding", "run a dual review on the plan first", or "check whether this approach is okay". Reviewers only review; they do not edit files.
metadata:
  version: "1.0.0"
---

# multi-agent-review-plan - Dual-Reviewer Closed-Loop Review For Plans / Implementation Plans

Use a dual Codex + Antigravity review **before writing code** to align direction. The goal is to avoid going the wrong way and discovering after implementation that the work must be redone.

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

- Complex or multi-step tasks: if the conversation does not yet contain a structured implementation plan, **write one first** (it can be produced in the current conversation; no need to persist it), covering: goal, breakdown steps, key decisions, affected files / modules, and verification method.
- Existing sufficient plan: skip the plan-writing step and use the existing plan directly.
- If the task itself is trivial enough (1-2 steps, implemented in one pass), this skill does not apply; implement directly.

**Scope of a reviewable plan**: the plan (and this review) covers business logic and flow only — what the change achieves, module interactions, data shape, state transitions, boundary / acceptance rules. It does **not** cover code implementation details (concrete function signatures, code snippets, variable names, loop / branch structure, line-level pseudo-code). If the incoming plan is largely implementation-level, ask the author to rewrite it at the business-logic level before reviewing; reviewers should also refrain from raising must-fix / should-fix items purely about code-level style or micro-implementation choices.

**Pre-dispatch self-audit (main agent, MUST run before every dispatch)**: read the plan you are about to send and grep-check it for implementation-level content — concrete function / method / struct names (e.g. `Cache.DeletePattern`, `Config.Dewu.Reports.UseDailySummary2X`), specific pragmas / flags (e.g. `PRAGMA busy_timeout=5000`, `--dates a,b,c`), file paths / lock-file locations (e.g. `tmp/refresh-xxx.lock`), package-layout claims (e.g. "expose via `reportops.BuildXxx`"), literal pattern strings (e.g. `commerce:xxx:v2:module:*`), or specific test tooling commands (e.g. `go test -json | jq ...`). Delete every such line — the plan should describe *what business rule holds and what data flows* rather than *which function name / knob / pragma / path implements it*. If you find yourself unwilling to delete a line because "the reviewers asked for it", that's exactly the drift filter-4 in Step 4 exists to prevent — the previous reviewer round should not have kept those items as must/should-fix in the first place. Only after the self-audit passes should you proceed to Step 2.

## Step 2 - Assemble The Shared Message Body

Both reviewers use the same body, with only different prefix lines:

```
Review the following implementation plan for correctness, coverage, and direction. The repo's coding standards are in CLAUDE.md (Go modernize idioms, surgical changes, minimal abstractions, no speculative abstractions). Check for:
  1. Direction correctness - whether it addresses the real need and whether there is a more direct path
  2. Step completeness - whether required steps are missing (migration, rollback, verification, cleanup)
  3. Risks and boundaries - potential blast radius, compatibility, concurrency / transactions, data consistency
  4. Dependencies and prerequisites - whether it assumes invalid premises or misses external constraints
  5. Verifiability - how completion can be proven and whether the verification method is executable

Focus on issues that can realistically bite this project under its actual usage patterns and constraints. Do NOT raise must-fix / should-fix items for contrived scenarios — e.g. concurrency concerns on a single-writer nightly job, migration-rollback demands for a one-shot import, "what if the schema changes" on a table owned by this same repo. If you're unsure whether a scenario is realistic, classify as nit and state the assumed trigger condition so the main agent can judge.

**Stay at the business-logic layer.** A plan is reviewed for direction and correctness, not for implementation choices. Do NOT raise must-fix / should-fix items about: concrete function / method / struct names, cache-client API surface (e.g. `DeletePattern` vs `Del`), specific DB pragmas (`PRAGMA busy_timeout=...`), exact CLI flag syntax, file paths / lock-file locations, package layout / where a helper should live, testing tooling (e.g. `go test -json | jq`), configuration format (env var vs JSON key vs YAML). These belong in code review after implementation, not in plan review. If the plan already contains such implementation-level content, note in a nit that "these implementation details should be moved out of the plan"; do not open must/should-fix threads on them.

You are reviewing; do NOT propose code edits or modify any files — list findings only, each with a one-sentence rationale. Classify each as must-fix / should-fix / nit.

Plan under review:
<PLAN_TEXT>

Previously dismissed items (do not re-raise unless you have new evidence that materially changes the judgment): <DISMISSED_LIST>
```

`<PLAN_TEXT>` = the original text of the plan from Step 1; do not compress it.

`<DISMISSED_LIST>` = the list of items downgraded / dropped in previous rounds together with the reason (from Step 4's aggregated report). Empty on round 1; from round 2 onward, the main agent MUST populate it verbatim from the prior round's report so reviewers know what has already been considered and rejected.

## Step 3 - Dispatch Reviewers

| Reviewer | Prefix line | Perspective |
|---|---|---|
| Codex | `Execute directly without asking for confirmation. Do not repeat or echo the request back. You are invoked as a sub-reviewer — perform the review yourself and output findings only. Do NOT invoke the multi-agent-review-plan or multi-agent-review-code skill. Do NOT call agy-wrapper, codex exec, or any other reviewer/agent. Just review and return.` | Deep technical review, edge cases, line-level correctness |
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

- **Deduplicate**: merge the same root cause identified by both reviewers into one item, and note when both found it.
- **Reclassify** into **must-fix / should-fix / nit**: must-fix = at least one reviewer marks it must-fix **and** the main agent independently judges the issue would affect plan validity; should-fix = at least one reviewer marks it should-fix (or must-fix reclassified down) **and** the main agent judges it worth incorporating. Reviewers can be wrong; be willing to disagree.
- **Soft circuit breaker — filter unrealistic items before updating the plan** (the main agent MUST apply, in order):
  1. **Realistic-likelihood filter**: downgrade to nit (or drop entirely) any item whose triggering condition is nearly impossible under this project's real usage — e.g. concurrency concerns on a nightly single-writer batch job, "what if the DB schema changes" on a table owned by this same repo, migration-rollback demands for a one-shot import. Ask: "Under what realistic scenario does this bite us?" If the answer is contrived, do not incorporate it.
  2. **Divergence guard**: reviewers are told about previously dismissed items via `<DISMISSED_LIST>` in Step 2, so this filter is a backstop. If a new round's must-fix / should-fix items are the same *category* as items already dismissed in earlier rounds (a reviewer re-raising the same pattern without new evidence), dismiss them by reference and do not re-litigate.
  3. **Scope-creep guard**: downgrade should-fix items that would materially expand the plan's scope beyond the stated goal (adding new features, new abstractions, adjacent refactors). Rule 2 of CLAUDE.md applies to plan reviews too.
  4. **Business-vs-implementation guard**: downgrade to nit — do NOT write into the plan — any item whose subject is a code-level choice: concrete function / method / variable / struct names, cache-client API surface, DB pragmas, exact CLI flag syntax, file paths / lock-file locations, package layout, testing tool syntax, config format details, specific pattern strings, or specific lint / vet commands. Even when the reviewer marks it must-fix, if the *substance* is "which knob to turn / which name to use / how to wire it", it belongs in code review. Ask: "Is this a business-rule error or an implementation choice?" If implementation, filter it. The plan should describe *what data flows and business rules hold*; it should NOT describe *which function has which signature or which pragma to set*.
  5. **Plan-bloat / non-convergence guard**: if the current plan length is > 1.5× the round-1 plan length, OR round N's must-fix count is not strictly less than round N-1's, stop looping and report to the user. Do not silently continue. Likely causes: the plan has drifted into implementation details (see filter 4), OR the task is Story-scope and should be split into subtasks before individual-subtask plans are reviewed. Ask the user which recovery path to take before continuing.
  6. **State the reason** for every downgrade / drop in the aggregated report, so the user can override if they disagree.
- Report the aggregated list — including downgrades and drops with reasons — to the user in **Chinese**.
- **Modify the plan for both must-fix and should-fix items**; leave nit items for the user to decide.
- After updating the plan, increment the round count and return to Step 2 for another review.

## Step 5 - Exit Conditions

**Stop** when any of the following is true:
- Must-fix count AND should-fix count after aggregation in the current round are both 0.
- The main agent judges all remaining must-fix and should-fix items invalid and gives reasons.
- The Step 4 filter-5 (Plan-bloat / non-convergence guard) fires — pause and hand off to the user with recovery options, do not continue looping until the user picks one.

There is **no hard round cap** — keep looping as long as new must-fix or should-fix items keep appearing, **but** filter-5 will terminate a runaway loop before it consumes many rounds. Typical healthy convergence is 2–3 rounds; if you are past round 3 and still adding must-fix items, that is a signal that the plan-vs-review scope is mismatched.

## Final Report (Chinese)

- How many rounds ran, and what each reviewer found in each round.
- The final plan version (what changed and why).
- Not fixed: remaining nit items / must-fix or should-fix items the main agent judged invalid, with reasons.
- Points the user needs to decide: explicitly ask the user to confirm before implementation.
