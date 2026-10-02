---
name: multi-agent-review-code
description: Review a code diff by sending prompts through the herdr skill to existing Codex and Antigravity sessions in adjacent panes, and fix confirmed in-scope findings. Use when the user or an authorized workflow requests a heavyweight review-and-fix loop; ordinary one-pass reviews use audit.
metadata:
  version: "1.4.0"
---

# multi-agent-review-code - Dual-Reviewer Ship-Readiness Loop

Heavyweight quality gate: external reviewers inspect the diff; the main agent fixes confirmed in-scope must-fix and should-fix items, then requests focused verification of those fixes and affected behavior.

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
- **Codex as sub-reviewer (an existing adjacent Codex session receives a parent agent's prompt through Herdr to review a diff)**: **do NOT run this skill at all**. The prompt from the parent agent already contains a review request; just perform the review directly and return findings. Never dispatch Codex, Antigravity, or any other reviewer/agent from here. The Codex prefix line in Step 3 below always carries this instruction, so if you see it in your incoming prompt, exit the skill immediately and just review.
- **Codex as main agent (a user directly asked Codex to run this review skill)**: **fall back to a single review** by running only Antigravity. Rationale: Codex self-review is equivalent to having the author review their own work, without an independent perspective; keep Antigravity as the external reviewer. In fallback mode:
  - Step 3 dispatches only Antigravity and skips the Codex path.
  - Step 4 aggregation is done as a "single reviewer"; descriptions such as "both reviewers found this" do not apply.
  - The final report must state that this round used **single-review fallback** mode and explain why, so the user does not mistakenly think Codex also approved it.
- **How to decide**:
  - Incoming prompt contains the sub-reviewer prefix from Step 3, OR the prompt is a direct review request forwarded by a parent agent → **sub-reviewer bypass**.
  - Executor is Codex and the user directly asked Codex to "run the review loop" / "review this diff with dual reviewers" → **single-review fallback**.
  - Otherwise → **default dual-review**.

**Review progression**: review the full task diff once. Subsequent rounds cover changes since the previous review, unresolved confirmed findings, and affected paths. Do not reopen settled findings without new evidence. Honor any explicit task budget and the Exit conditions below; a budget or reviewer failure is not a clean review.

## Static Review And Waiting Contract (Hard Gate)

- Reviewers perform **static source review only**. They may read source files, repository instructions, git status, logs, and diffs with read-only inspection commands.
- Reviewers must **never** build, compile, reconfigure, install, package, test, execute project binaries or scripts, format, lint, or run static/dynamic analyzers. This prohibition applies even when a reviewer believes verification would strengthen a finding.
- The main agent owns all build, test, formatter, linter, analyzer, and runtime verification outside reviewer sessions. After fixing findings, the main agent may run appropriate verification before dispatching the next static review round.
- Every reviewer prompt must repeat these restrictions explicitly. A generic "read-only" instruction is insufficient because builds and tests can still mutate generated outputs.
- Give every live reviewer the full configured allowance of up to **30 minutes**. Use `herdr agent prompt --wait --timeout 1800000` and an outer timeout of at least `1800000` ms.
- When a reviewer call yields a live task or cell, keep waiting on that same task/cell or Herdr agent in intervals no longer than 60 seconds until it completes or 30 minutes have elapsed since dispatch. Several minutes without output is normal and is not a reason to interrupt, terminate, retry, or launch a duplicate reviewer.
- End the wait early only when the reviewer completes, exits with an error, becomes blocked awaiting user input, the user asks to stop, or the actual 30-minute deadline expires. Never kill a live reviewer merely because it appears slow.
- The 30 minutes is a maximum allowance, not a minimum wait. While a reviewer is running, do independent work that does not change the source it is reviewing; wait only when the next dependent action needs its result.

## Prompt Length Budget (Hard Gate)

The prompt handed to each reviewer must stay **≤50 lines**, and must **never exceed 80 lines** — counting the prefix line, the shared body, and every interpolated value. Long prompts bury the instructions that matter and measurably degrade review quality.

- **Never inline bulk content.** Material under review (diffs, logs, prior findings, user-supplied context) goes into a file the reviewer reads itself; the prompt carries only the path plus a one-line instruction. This is why Step 1 has reviewers run `<DIFF_CMD>` themselves rather than embedding the diff.
- If `<ARGS>` or `<DISMISSED_LIST>` exceeds ~5 lines, write it to `./tmp/review-args-<ts>.txt` / `./tmp/review-dismissed-<ts>.txt` with a built-in file tool and reference the path instead of inlining it.
- **Count the lines of the assembled prompt file before dispatching.** Over 80 lines: move content into files or cut it. Never dispatch an over-budget prompt.
- When trimming, cut prose and examples first. Keep the hard boundaries intact: scope contract, static-review restriction, and output format.

## Reviewer Language

- Prefer English reviewer instructions while preserving the user's meaning. Keep source code, diffs, paths, identifiers, logs, and other artifacts unchanged.
- Accept understandable findings in any language; translate them for aggregation when needed. Never reject or rerun a review solely because of its language.
- User-facing updates and the final report follow the user's language unless the caller supplies a specific output contract.

## Per-Round Steps

### 1. Decide Review Scope

Reviewers run git commands themselves to obtain the diff. This skill does not put the diff into the prompt.

- Run `git status` to inspect repository state.
- On the first round, if the working tree or index has changes -> `<DIFF_CMD>` = `git diff HEAD`; otherwise use `git diff master...HEAD`, labeled as a **branch-vs-master** review. Limit it to the user's task scope if unrelated changes are present; include relevant untracked source separately.
- On later rounds, keep the original comparison base and narrow `<DIFF_CMD>` to files changed since the last review and affected callers. Describe the new fixes and unresolved findings in `<ARGS>` so reviewers do not repeat the full review of already accepted code.
- Tool output also consumes context. Inspect source and relevant hunks selectively; use generated artifacts only when they are needed to assess the change.

### 2. Assemble The Shared Message Body (Same For Both Reviewers, Different Prefix Only)

```
Review the scoped diff in this repo. On follow-up rounds, assess only the new fixes, unresolved findings, and affected behavior described in the focus instruction. First obtain the diff by running (read-only):
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

Prefer English output.

Review focus (user constraints, plus new fixes and unresolved findings on follow-up rounds): <ARGS>

Previously dismissed items (do not re-raise unless you have new evidence that materially changes the judgment): <DISMISSED_LIST>
```

`<DISMISSED_LIST>` = the list of items downgraded / dropped in previous rounds together with the reason (from Step 4's aggregated report). Empty on round 1; from round 2 onward, the main agent MUST populate it verbatim from the prior round's report so reviewers know what has already been considered and rejected. Keep it to one terse line per item; once it passes ~5 lines, put it in a file and inline the path instead, per the Prompt Length Budget.

This body is ~20 lines by design, leaving the prefix line and dismissed list comfortable headroom under the 50-line target. Keep it that way — resist appending new guidance round over round; if a new instruction is needed, replace an existing line rather than adding one.

### 3. Dispatch Reviewers

Both reviewers use the same body, each with its own prefix line:

| Reviewer | Prefix line | Perspective |
|---|---|---|
| Codex | `Execute directly without asking for confirmation. Do not repeat or echo the request back. Current working directory (absolute path): <WORKDIR>. Treat this as the repository root and resolve all relative paths from it. You are invoked as a sub-reviewer — perform a static source review yourself and output findings only. Prefer English output. Do NOT invoke the multi-agent-review-plan or multi-agent-review-code skill or call any other reviewer/agent. Do NOT build, test, install, execute, format, lint, or run analyzers. Do NOT modify files or run git write commands. Read source and git metadata only; then review and return.` | Deep technical review, edge cases, line-level correctness |
| Antigravity | `Current working directory (absolute path): <WORKDIR>. Treat this as the repository root and resolve all relative paths from it. Prefer English output. STATIC SOURCE REVIEW ONLY. Do NOT build, test, install, execute, format, lint, or run analyzers. Do NOT run any git write commands (commit, push, reset, etc.). Git repository and generated outputs are read-only for you. Inspect source and git metadata only, and provide findings as text in your response.` | High-level architecture, design consistency, alternative angles |

Transport through the `herdr` skill:
- Read and follow the `herdr` skill for session detection, live agent discovery, prompt submission, waiting, and response retrieval. Use the installed `herdr --help` and command groups for current syntax.
- Resolve the current repository root to an absolute path and substitute it for `<WORKDIR>` in both prefixes. Tell existing sessions to use this request's scope and context rather than assumptions from earlier pane work.
- Check `test "${HERDR_ENV:-}" = 1` as a fast path. When unset or false, confirm the session with the read-only commands `herdr status` and `herdr pane current --current`. If no current session or pane is identified, report that this session is not running inside Herdr and stop. Do not invoke a headless Codex process, use a command-line fallback, or invoke a direct Antigravity CLI.
- Inspect the caller's layout with `herdr pane layout --pane <caller-pane-id>`, then cross-reference `herdr pane list --workspace <workspace-id>` and `herdr agent list` to locate existing adjacent Codex and Antigravity/agy sessions. Use IDs returned by discovery when environment IDs are unavailable. Target each returned unique agent name or pane ID, never the calling pane. Do not infer IDs from sidebar order, create a pane, or start a replacement agent.
- Confirm each target is ready (`idle` or `done`) before submitting. If working, wait for that turn to settle; if blocked, inspect the UI and ask the user before answering it. An unknown state is not proof of readiness.
- Keep prompts within the existing line budget (≤50 target, never >80). Bulk material stays in files accessible from the specified repository root; send the concise prompt and file paths as one literal argument using a structured tool call or safe shell quoting.
- **Dual-review mode**: dispatch both prompts in parallel with `herdr agent prompt <codex-agent-name-or-pane-id> "<codex-prompt>" --wait --timeout 1800000` and `herdr agent prompt <agy-agent-name-or-pane-id> "<agy-prompt>" --wait --timeout 1800000`. Continue to Step 4 after both responses are retrieved or an unavailable reviewer is explicitly reported.
- **Single-review fallback mode (executor is Codex)**: send only the Antigravity prompt through its existing Herdr session with the same `--wait --timeout 1800000` allowance.
- If a Herdr command is denied by the terminal sandbox, rerun that same command through the terminal tool's `require_escalated` approval flow with a narrowly scoped `herdr` prefix rule when supported.
- Retrieve each response with `herdr agent read <target> --source recent-unwrapped --lines 120`; use `herdr agent get <target>` to inspect state. Wait on the same live call or agent in intervals no longer than 60 seconds, for up to 30 minutes. A timeout or stalled response does not prove delivery failed: inspect state and output before deciding whether a retry is warranted. Do not duplicate a live request or interrupt a quiet reviewer.
- If a larger recent read still cannot recover the completed response, follow the `herdr` skill's temporary Markdown file fallback. Do not request file output in the initial prompt.
- If an adjacent reviewer is unavailable, tell the user and use only the available external reviewer in dual-review mode, disclosing incomplete coverage. If neither is available, or Antigravity is unavailable in single-review fallback mode, report that this round cannot be reviewed. A missing required reviewer is not approval; do not substitute Codex self-review or a headless process.

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
- Before fixing, report the aggregated list — including downgrades and drops with reasons — in the user's language or the caller's specified report language. Check Exit conditions before starting another fix or review round.

### 5. Fix (When Must-Fix Or Should-Fix Items > 0)

- **Fix must-fix and should-fix items confirmed by the main agent as valid and in scope**; leave nit items for the user to decide.
- Follow CLAUDE.md Rule 2: minimal surgical changes, no opportunistic surrounding refactors.
- Run any necessary build, tests, formatting, linting, analysis, or runtime verification as the main agent. Never delegate verification to a reviewer.
- Verify the affected behavior, reusing passing checks on unchanged inputs. Then return to Step 1 for a focused review of the new fixes and affected paths; do not restart a full review of unchanged code.

### 6. Exit Conditions

**Check completion first** and summarize when either condition is true:
- Must-fix count AND should-fix count after aggregation in the current round are both 0.
- The main agent judges all remaining must-fix and should-fix items invalid and gives reasons (do not loop forever on disagreement).

For remaining work, apply these guards:

- **Scope-growth check**: growth beyond 1.5× the round-1 diff is a prompt for the main agent to check scope, not an automatic pause. Keep changes required by the task and remove review-driven scope drift.
- **Stalled review**: if two consecutive follow-up rounds resolve no confirmed issue and add no material evidence, stop repeating the review and report the unresolved issue and blocker. Ask only when a user decision or additional permission is needed; continue any independent, already authorized work. Counts alone, including must-fix staying at zero while should-fix items are resolved, do not establish a stall.
- Report budget exhaustion, unavailable reviewers, or unresolved findings as incomplete; never label them clean. Rounds producing only discarded out-of-scope findings count as convergence.

### Final Report

- How many rounds ran, and what each reviewer found in each round.
- Fixed: list every must-fix and should-fix item and how it was fixed.
- Not fixed: remaining nit items / must-fix or should-fix items the main agent judged invalid, with reasons.
- Points the user needs to decide.
