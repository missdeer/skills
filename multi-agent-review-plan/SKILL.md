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

## Step 2 - Assemble The Shared Message Body

Both reviewers use the same body, with only different prefix lines:

```
Review the following implementation plan for correctness, coverage, and direction. The repo's coding standards are in CLAUDE.md (Go modernize idioms, surgical changes, minimal abstractions, no speculative abstractions). Check for:
  1. Direction correctness - whether it addresses the real need and whether there is a more direct path
  2. Step completeness - whether required steps are missing (migration, rollback, verification, cleanup)
  3. Risks and boundaries - potential blast radius, compatibility, concurrency / transactions, data consistency
  4. Dependencies and prerequisites - whether it assumes invalid premises or misses external constraints
  5. Verifiability - how completion can be proven and whether the verification method is executable

You are reviewing; do NOT propose code edits or modify any files — list findings only, each with a one-sentence rationale. Classify each as must-fix / should-fix / nit.

Plan under review:
<PLAN_TEXT>
```

`<PLAN_TEXT>` = the original text of the plan from Step 1; do not compress it.

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
  2. **Divergence guard**: if a new round's must-fix / should-fix items are the same *category* as items already dismissed in earlier rounds (a reviewer re-raising the same pattern), dismiss them by reference and do not re-litigate.
  3. **Scope-creep guard**: downgrade should-fix items that would materially expand the plan's scope beyond the stated goal (adding new features, new abstractions, adjacent refactors). Rule 2 of CLAUDE.md applies to plan reviews too.
  4. **State the reason** for every downgrade / drop in the aggregated report, so the user can override if they disagree.
- Report the aggregated list — including downgrades and drops with reasons — to the user in **Chinese**.
- **Modify the plan for both must-fix and should-fix items**; leave nit items for the user to decide.
- After updating the plan, increment the round count and return to Step 2 for another review.

## Step 5 - Exit Conditions

**Stop** when any of the following is true:
- Must-fix count AND should-fix count after aggregation in the current round are both 0.
- The main agent judges all remaining must-fix and should-fix items invalid and gives reasons.

There is **no hard round cap** — keep looping as long as new must-fix or should-fix items keep appearing.

## Final Report (Chinese)

- How many rounds ran, and what each reviewer found in each round.
- The final plan version (what changed and why).
- Not fixed: remaining nit items / must-fix or should-fix items the main agent judged invalid, with reasons.
- Points the user needs to decide: explicitly ask the user to confirm before implementation.
