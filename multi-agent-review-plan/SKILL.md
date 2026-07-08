---
name: multi-agent-review-plan
description: Before implementation, send the current task's implementation plan to Codex + Antigravity in parallel for plan review -> aggregate feedback -> revise the plan -> review again until there are no new issues. Use this to align direction before coding and avoid discovering the direction was wrong only after implementation. Use when the user says "review my plan", "review the plan before coding", "run a dual review on the plan first", or "check whether this approach is okay". Reviewers only review; they do not edit files.
metadata:
  version: "1.0.0"
---

# multi-agent-review-plan - Dual-Reviewer Closed-Loop Review For Plans / Implementation Plans

Use a dual Codex + Antigravity review **before writing code** to align direction. The goal is to avoid going the wrong way and discovering after implementation that the work must be redone.

## Execution Mode: Dual Review Vs Single-Review Fallback

Before starting, determine the identity of the agent currently executing this skill:

- **Default (Claude, etc.)**: dual review with Codex + Antigravity in parallel.
- **The executor itself is Codex CLI**: **fall back to a single review** by running only Antigravity. Rationale: Codex self-review is equivalent to having the plan author review their own plan, without an independent perspective; keep Antigravity as the external reviewer. In fallback mode:
  - Step 3 dispatches only Antigravity and skips the Codex path.
  - Step 4 aggregation is done as a "single reviewer"; descriptions such as "both reviewers found this" do not apply.
  - The final report must state that this round used **single-review fallback** mode and explain why, so the user does not mistakenly think Codex also approved it.
- **How to decide**: if the current agent identity cannot be determined, use the default dual-review mode; if context clearly shows the executor is Codex (for example a subtask launched via `codex exec`, or a prompt explicitly says the executor is codex), use the fallback path.

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
| Codex | `Execute directly without asking for confirmation. Do not repeat or echo the request back.` | Deep technical review, edge cases, line-level correctness |
| Antigravity | `Do NOT run any git write commands (commit, push, reset, etc.). Git repository is read-only for you. Do NOT modify any files. Read-only operations only — provide findings as text/diff in your response.` | High-level architecture, design consistency, alternative angles |

Transport:
- Write prompts to `./tmp/review-plan-codex-prompt-<ts>.txt` and `./tmp/review-plan-agy-prompt-<ts>.txt` respectively (fallback mode only needs the agy prompt).
- **Dual-review mode**: issue two Bash background calls side by side in one message (`run_in_background: true`, `timeout: 1800000`) to ensure parallelism:
  ```bash
  codex exec -s read-only --skip-git-repo-check "$(bat --plain --paging=never ./tmp/review-plan-codex-prompt-<ts>.txt)"
  ```
  ```bash
  agy-wrapper --dangerously-skip-permissions --timeout 30m -p "$(bat --plain --paging=never ./tmp/review-plan-agy-prompt-<ts>.txt)"
  ```
  Continue to Step 4 only after both return.
- **Single-review fallback mode (executor is Codex CLI)**: run only one path:
  ```bash
  agy-wrapper --dangerously-skip-permissions --timeout 30m -p "$(bat --plain --paging=never ./tmp/review-plan-agy-prompt-<ts>.txt)"
  ```
- Poll results with `TaskOutput`, and delete temporary files after completion.
- If one CLI is missing (for example `agy-wrapper` is not on PATH), tell the user and continue with the remaining reviewer. Do not pretend the missing reviewer also passed. In fallback mode, if `agy-wrapper` is missing, tell the user this round cannot be reviewed; do not fall back to Codex self-review.
- **Do not start implementation** until feedback from all reviewers has been received.

## Step 4 - Aggregate Feedback And Update The Plan

- **Deduplicate**: merge the same root cause identified by both reviewers into one item, and note when both found it.
- **Reclassify** into **must-fix / should-fix / nit**: must-fix = at least one reviewer marks it must-fix **and** Claude independently judges the issue would affect plan validity. Reviewers can be wrong; be willing to disagree.
- Report the aggregated list to the user in **Chinese**.
- **Modify the plan only for must-fix items**; leave should-fix / nit items for the user to decide.
- After updating the plan, increment the round count and return to Step 2 for another review.

## Step 5 - Exit Conditions

**Stop** when any of the following is true:
- 3 rounds have run, regardless of whether must-fix items remain.
- Must-fix count after aggregation in the current round is 0.
- Claude judges all remaining must-fix items invalid and gives reasons.

## Final Report (Chinese)

- How many rounds ran, and what each reviewer found in each round.
- The final plan version (what changed and why).
- Not fixed: remaining should-fix / nit items / must-fix items Claude judged invalid, with reasons.
- Points the user needs to decide: explicitly ask the user to confirm before implementation.
