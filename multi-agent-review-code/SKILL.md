---
name: multi-agent-review-code
description: Use Codex + Antigravity as static-source reviewers in parallel to review a pending diff or branch-vs-master diff, aggregate and deduplicate findings, fix must-fix and should-fix items, and review again until clean. Reviewers may inspect source and git metadata only; they never build, test, install, run, format, lint, or analyze the project. The main agent must allow each live reviewer up to 30 minutes to finish. Use for heavyweight ship-readiness review before release or merge.
metadata:
  version: "1.2.0"
---

# multi-agent-review-code - Dual-Reviewer Ship-Readiness Loop

Heavyweight quality gate: Codex + Antigravity review the pending diff in parallel -> aggregate -> fix only must-fix items -> review again, looping until clean or the limit is reached.

## Hard Scope Contract (Reviewers + Aggregator)

**The diff defines the scope.** A finding is in scope only if it concerns code the diff adds or changes, or a defect the diff introduces into the code it touches. Everything else is out of scope regardless of severity label, and regardless of how many reviewers raise it:

- Pre-existing problems in untouched code, including untouched code the diff merely sits next to.
- Refactors, restructuring, renames, or new abstractions beyond what the change itself requires.
- Requests to broaden the change: extra features, extra configuration knobs, extra defensive layers, or handling for scenarios the task does not cover.
- Test demands beyond the changed behavior — exhaustive matrices, tests for untouched paths, or coverage targets.
- Style and taste preferences that no repository standard actually states.

A finding being *technically correct* does not make it in scope. If acting on it would make the change do more than it set out to do, discard it. Surface a genuinely serious pre-existing problem to the user as a separate note; do not fix it inside this change and do not let it block the loop.

## Execution Mode: Dual Review / Single-Review Fallback / Sub-Reviewer Bypass

Before starting, determine which of the three scenarios applies to the agent currently executing this skill:

- **Default (Claude Code, or any non-Codex main agent)**: dual review with Codex + Antigravity in parallel.
- **Codex as sub-reviewer (invoked by a parent agent through `codex exec` to review a diff)**: **do NOT run this skill at all**. The prompt from the parent agent already contains a review request; just perform the review directly and return findings. Never dispatch Codex, Antigravity, or any other reviewer/agent from here. The Codex prefix line in Step 3 below always carries this instruction, so if you see it in your incoming prompt, exit the skill immediately and just review.
- **Codex as main agent (a user directly asked Codex CLI to run this review skill)**: **fall back to a single review** by running only Antigravity. Rationale: Codex self-review is equivalent to having the author review their own work, without an independent perspective; keep Antigravity as the external reviewer. In fallback mode:
  - Step 3 dispatches only Antigravity and skips the Codex path.
  - Step 4 aggregation is done as a "single reviewer"; descriptions such as "both reviewers found this" do not apply.
  - The final report must state that this round used **single-review fallback** mode and explain why, so the user does not mistakenly think Codex also approved it.
- **How to decide**:
  - Incoming prompt contains the sub-reviewer prefix from Step 3, OR the prompt is a direct review request forwarded by a parent agent → **sub-reviewer bypass**.
  - Executor is Codex CLI and the user directly asked Codex to "run the review loop" / "review this diff with dual reviewers" → **single-review fallback**.
  - Otherwise → **default dual-review**.

**Round budget**: unlimited review->fix rounds until the current round has no must-fix AND no should-fix items, or one of the Exit conditions below is triggered. Do **not** cap by round count.

## Static Review And Waiting Contract (Hard Gate)

- Reviewers perform **static source review only**. They may read source files, repository instructions, git status, logs, and diffs with read-only inspection commands.
- Reviewers must **never** build, compile, reconfigure, install, package, test, execute project binaries or scripts, format, lint, or run static/dynamic analyzers. This prohibition applies even when a reviewer believes verification would strengthen a finding.
- The main agent owns all build, test, formatter, linter, analyzer, and runtime verification outside reviewer sessions. After fixing findings, the main agent may run appropriate verification before dispatching the next static review round.
- Every reviewer prompt must repeat these restrictions explicitly. A generic "read-only" instruction is insufficient because builds and tests can still mutate generated outputs.
- Give every live reviewer the full configured allowance of up to **30 minutes**. Use an outer timeout of at least `1800000` ms and a reviewer timeout of `30m` where supported.
- When a reviewer call yields a live task or cell, keep waiting on that same task/cell in intervals no longer than 60 seconds until it completes or 30 minutes have elapsed since dispatch. Several minutes without output is normal and is not a reason to interrupt, terminate, retry, or launch a duplicate reviewer.
- End the wait early only when the reviewer completes, the reviewer process explicitly exits with an error, the user asks to stop, or the actual 30-minute deadline expires. Never kill a live reviewer merely because it appears slow.

## Prompt Length Budget (Hard Gate)

The prompt handed to each reviewer must stay **≤50 lines**, and must **never exceed 80 lines** — counting the prefix line, the shared body, and every interpolated value. Long prompts bury the instructions that matter and measurably degrade review quality.

- **Never inline bulk content.** Material under review (diffs, logs, prior findings, user-supplied context) goes into a file the reviewer reads itself; the prompt carries only the path plus a one-line instruction. This is why Step 1 has reviewers run `<DIFF_CMD>` themselves rather than embedding the diff.
- If `<ARGS>` or `<DISMISSED_LIST>` exceeds ~5 lines, write it to `./tmp/review-args-<ts>.txt` / `./tmp/review-dismissed-<ts>.txt` with a built-in file tool and reference the path instead of inlining it.
- **Count the lines of the assembled prompt file before dispatching.** Over 80 lines: move content into files or cut it. Never dispatch an over-budget prompt.
- When trimming, cut prose and examples first. Keep the hard boundaries intact: scope contract, static-review restriction, and output format.

## Per-Round Steps

### 1. Decide Review Scope

Reviewers run git commands themselves to obtain the diff. This skill does not put the diff into the prompt.

- Run `git status` to inspect repository state.
- If the working tree or index has changes -> `<DIFF_CMD>` = `git diff HEAD`.
- If the working tree is clean -> `<DIFF_CMD>` = `git diff master...HEAD`, labeled as a **branch-vs-master** review.
- Do not worry about diff size: the diff is not placed in the prompt, so generated files / large fixtures do not consume prompt budget.

### 2. Assemble The Shared Message Body (Same For Both Reviewers, Different Prefix Only)

```
Review the pending diff in this repo. First obtain the diff yourself by running (read-only):
  <DIFF_CMD>
Do not ask me to paste it; run the command and review its output. The repo's coding standards are in CLAUDE.md (Go modernize idioms, surgical changes, minimal abstractions). Check for:
  1. Correctness bugs (off-by-one, nil deref, error swallowing, missing context propagation)
  2. Edge cases the change doesn't handle (empty input, partial failure, concurrent access)
  3. Security issues (SQL injection, command injection, secret leakage)
  4. Backward compatibility breaks (DB schema, public APIs, file formats)
  5. CLAUDE.md / Go-standards violations (legacy CLI use, non-modern Go idioms, unused params)

Focus on issues that can realistically occur under this project's actual usage patterns and threat model. Do NOT raise must-fix / should-fix items for contrived edge cases that require callers to violate documented invariants, exceed schema-enforced limits, or invoke code paths that never co-execute in practice. If you're unsure whether a scenario is realistic, classify as nit and state the assumed trigger condition so the main agent can judge.

SCOPE IS THE DIFF. Only raise findings about code this diff adds or changes, or defects it introduces into the code it touches. Do NOT raise pre-existing problems in untouched code, refactors or new abstractions beyond what the change requires, requests to broaden the change (extra features, config knobs, defensive layers), exhaustive test matrices or tests for untouched paths, or style preferences no stated standard requires. A finding being technically correct does not make it in scope — if acting on it would make this change do more than it set out to do, omit it.

You are reviewing; do NOT propose code edits — list findings only, each with file:line and a one-sentence rationale. Classify each as must-fix / should-fix / nit.

STATIC SOURCE REVIEW ONLY. You may inspect source, repository instructions, git metadata, and diffs with read-only commands. Do NOT build, compile, reconfigure, install, package, test, run binaries or scripts, format, lint, or run analyzers. Do not modify files or generated outputs. The main agent performs verification separately.

Focus instruction from user (may be empty): <ARGS>

Previously dismissed items (do not re-raise unless you have new evidence that materially changes the judgment): <DISMISSED_LIST>
```

`<DISMISSED_LIST>` = the list of items downgraded / dropped in previous rounds together with the reason (from Step 4's aggregated report). Empty on round 1; from round 2 onward, the main agent MUST populate it verbatim from the prior round's report so reviewers know what has already been considered and rejected. Keep it to one terse line per item; once it passes ~5 lines, put it in a file and inline the path instead, per the Prompt Length Budget.

This body is ~20 lines by design, leaving the prefix line and dismissed list comfortable headroom under the 50-line target. Keep it that way — resist appending new guidance round over round; if a new instruction is needed, replace an existing line rather than adding one.

### 3. Dispatch Reviewers

Both reviewers use the same body, each with its own prefix line:

| Reviewer | Prefix line | Perspective |
|---|---|---|
| Codex | `Execute directly without asking for confirmation. Do not repeat or echo the request back. You are invoked as a sub-reviewer — perform a static source review yourself and output findings only. Do NOT invoke the multi-agent-review-plan or multi-agent-review-code skill. Do NOT call agy-wrapper, codex exec, or any other reviewer/agent. Do NOT build, test, install, execute, format, lint, or run analyzers. Read source and git metadata only; then review and return.` | Deep technical review, edge cases, line-level correctness |
| Antigravity | `Current working directory (absolute path): <WORKDIR>. Treat this as the repository root and resolve all relative paths from it. STATIC SOURCE REVIEW ONLY. Do NOT build, test, install, execute, format, lint, or run analyzers. Do NOT run any git write commands (commit, push, reset, etc.). Git repository and generated outputs are read-only for you. Inspect source and git metadata only, and provide findings as text in your response.` | High-level architecture, design consistency, alternative angles |

Transport:
- Resolve the current working directory to an absolute path when assembling the Antigravity prompt and substitute it for `<WORKDIR>` in the prefix. The absolute path MUST appear in the prompt itself; do not rely on `agy-wrapper` inheriting the correct process working directory.
- Write prompts to `./tmp/review-codex-prompt-<ts>.txt` and `./tmp/review-agy-prompt-<ts>.txt` respectively (fallback mode only needs the agy prompt).
- **Verify the line count of each assembled prompt file before dispatch** (`wc -l`). ≤50 is the target, >80 must not be dispatched.
- **Prompt files MUST be created using the agent's built-in Write / Edit tools** (Claude Code: `Write`; Codex CLI: its `apply_patch` / file-write tool). Do NOT generate them via shell (`echo`, `cat <<EOF`, `printf`, `tee`, `>` redirection, PowerShell `Set-Content`, etc.) — on Windows Git Bash, shell heredocs and quoting mangle backticks, `$`, backslashes, and CRLF, corrupting the prompt. The built-in file tools write the exact bytes.
- **Dual-review mode**: issue two Bash background calls side by side in one message (`run_in_background: true`, `timeout: 1800000`) to ensure parallelism. **Always wrap the reviewer command in `bash -lc "..."`** so it runs under a login shell (PATH / helper functions like `_cmake_ps` etc. are available). Use double quotes for the outer `bash -lc` argument and escape the inner double quotes for `$(bat ...)` — single quotes break argument passing on Windows Git Bash:
  ```bash
  bash -lc "codex exec -s read-only --skip-git-repo-check \"\$(bat --plain --paging=never ./tmp/review-codex-prompt-<ts>.txt)\""
  ```
  ```bash
  bash -lc "agy-wrapper --dangerously-skip-permissions --timeout 30m --print-timeout 30m -p \"\$(bat --plain --paging=never ./tmp/review-agy-prompt-<ts>.txt)\""
  ```
  Continue to Step 4 only after both return.
- **Single-review fallback mode (executor is Codex CLI)**: run only one path (still wrapped in `bash -lc "..."`):
  ```bash
  bash -lc "agy-wrapper --dangerously-skip-permissions --timeout 30m --print-timeout 30m -p \"\$(bat --plain --paging=never ./tmp/review-agy-prompt-<ts>.txt)\""
  ```
- Poll results with `TaskOutput` (or the environment's equivalent wait primitive) at intervals no longer than 60 seconds. Continue waiting on the same live reviewer for up to 30 minutes; do not terminate or duplicate it because it is quiet or slow. Delete temporary files only after the reviewer has completed or the true 30-minute deadline has expired.
- If one CLI (for example `agy-wrapper`) is not on PATH, **tell the user** and continue with the remaining reviewer. Do not pretend the missing reviewer also passed. In fallback mode, if `agy-wrapper` is missing, tell the user this round cannot be reviewed; do not fall back to Codex self-review.

### 4. Aggregate Findings

- **Apply the Hard Scope Contract first**: discard every out-of-scope finding before deduplication or classification, regardless of reviewer severity. Do not keep it as a nit and do not fix it "since it's cheap". In the aggregated report, state only how many findings were discarded as out of diff scope, plus any serious pre-existing problem surfaced as a separate note.
- **Deduplicate**: if both reviewers identify the same root cause at the same `file:line`, merge it into one item and note that both found it.
- **Reclassify** into **must-fix / should-fix / nit**: an item is **must-fix** only if at least one reviewer marks it must-fix **and** the main agent independently judges that it would cause a real problem; an item is **should-fix** if at least one reviewer marks it should-fix (or must-fix reclassified down) **and** the main agent judges it worth fixing. Reviewers can be wrong; do not rubber-stamp them.
- **Soft circuit breaker — filter unrealistic items before fixing** (the main agent MUST apply, in order):
  1. **Realistic-likelihood filter**: downgrade to nit (or drop entirely) any item whose triggering condition is nearly impossible in real production use — e.g. a `nil` deref that requires a caller to violate a documented invariant, an "unbounded input" concern on a field the schema already caps, a race that requires two goroutines that never actually run together. Ask: "Under what real workload does this fire?" If the answer is contrived, do not fix it.
  2. **Divergence guard**: reviewers are told about previously dismissed items via `<DISMISSED_LIST>` in Step 2, so this filter is a backstop. If a new round's must-fix / should-fix items are the same *category* as items already dismissed in earlier rounds (same reviewer re-raising a pattern under a new file:line, without adding new evidence), dismiss them by reference and do not re-litigate.
  3. **Cost / benefit sanity check**: downgrade should-fix items whose fix is materially larger than the risk they mitigate (e.g. adding a config knob and 50 lines of plumbing to guard against a 1-in-10⁶ edge case).
  4. **Consensus is not evidence**: both reviewers raising the same item does not make it valid or in scope. Apply the Hard Scope Contract and gates 1–3 to agreed items exactly as to single-reviewer items, and do not keep looping to satisfy reviewers on points you have dismissed.
  5. **No partial adoption**: accepting a discarded out-of-scope finding in reduced form is still scope divergence. Only the user can pull one back into scope.
  6. **State the reason** for every downgrade / drop in the aggregated report, so the user can override if they disagree.
- Before fixing, report the aggregated list — including downgrades and drops with reasons — to the user in Chinese.

### 5. Fix (When Must-Fix Or Should-Fix Items > 0)

- **Fix both must-fix and should-fix items**; leave nit items for the user to decide.
- Follow CLAUDE.md Rule 2: minimal surgical changes, no opportunistic surrounding refactors.
- Run any necessary build, tests, formatting, linting, analysis, or runtime verification as the main agent. Never delegate verification to a reviewer.
- After fixing, increment the round count and return to Step 1.

### 6. Exit Conditions

**Stop** and summarize when any of the following is true:
- Must-fix count AND should-fix count after aggregation in the current round are both 0.
- The main agent judges all remaining must-fix and should-fix items invalid and gives reasons (do not loop forever on disagreement).
- **Diff-growth / non-convergence guard**: the diff is > 1.5× its round-1 size due to review fixes rather than the original task, OR round N's must-fix count is not strictly less than round N-1's. Both indicate the loop is expanding the change instead of correcting it. Pause, report to the user, and let them pick a recovery path before continuing.

There is **no hard round cap** — keep looping as long as new in-scope must-fix or should-fix items keep appearing, **but** the non-convergence guard terminates a runaway loop. Rounds that produce only discarded out-of-scope findings count as convergence, not as new issues.

### Final Report (Chinese)

- How many rounds ran, and what each reviewer found in each round.
- Fixed: list every must-fix and should-fix item and how it was fixed.
- Not fixed: remaining nit items / must-fix or should-fix items the main agent judged invalid, with reasons.
- Points the user needs to decide.
