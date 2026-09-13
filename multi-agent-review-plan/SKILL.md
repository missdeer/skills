---
name: multi-agent-review-plan
description: Review a high-level plan with external reviewers before implementation. Use when the user or an authorized workflow requests multi-agent plan review; assess technology choices, architecture, and business rules, not code details.
metadata:
  version: "1.2.1"
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

**Breadth is a separate axis from the four categories above.** Within those categories, the plan covers only what the stated task actually requires. Content that does not trace back to the task's stated goal or acceptance criteria is out of scope **even when it is perfectly high-level** — this includes hypothetical edge cases, speculative failure modes, adjacent features, and capabilities designed for anticipated future needs. Belonging to one of the four permitted categories is necessary, not sufficient. The default answer to "should the plan also cover X?" is **no** unless X is required for the stated task to succeed.

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

## Prompt Length Budget (Hard Gate)

The prompt handed to each reviewer must stay **≤50 lines**, and must **never exceed 80 lines** — counting the prefix line, the shared body, and every interpolated value. Long prompts bury the instructions that matter and measurably degrade review quality.

- **Never inline bulk content.** The plan under review and any prior findings go into files the reviewer reads itself; the prompt carries only the path plus a one-line instruction. The plan is not compressed — it is simply moved out of the prompt.
- If `<DISMISSED_LIST>` exceeds ~5 lines, write it to `./tmp/review-plan-dismissed-<ts>.txt` with a built-in file tool and reference the path instead of inlining it.
- **Count the lines of the assembled prompt file before dispatching.** Over 80 lines: move content into files or cut it. Never dispatch an over-budget prompt.
- When trimming, cut prose and examples first. Keep the hard boundaries intact: Hard Scope Contract, review-only restriction, and output format.

## Reviewer Language

- Prefer English reviewer instructions while preserving the user's meaning. Keep the plan, source code, paths, identifiers, and other artifacts unchanged.
- Accept understandable findings in any language; translate them for aggregation when needed. Never reject or rerun a review solely because of its language.
- User-facing updates and the final report follow the user's language unless the caller supplies a specific output contract.

## Step 1 - Confirm There Is A Plan To Review

- Complex or multi-step tasks: if the conversation does not yet contain a structured high-level plan, **write one first** (it can be produced in the current conversation; no need to persist it). Include only: business goal / scope / non-goals; material technology choices and rationale; conceptual architecture and interactions; business flow, states, rules, boundaries, and acceptance points; high-level assumptions, risks, and open decisions within the Hard Scope Contract.
- Existing sufficient plan: skip the plan-writing step and use the existing plan directly.
- For a trivial task, a local review is sufficient unless external review was explicitly requested. Continue to implementation only if the user has authorized it; a review-only request does not authorize code changes.

**Pre-dispatch scope check**: check the full plan against the Hard Scope Contract before its first review; on follow-up rounds, check revised decisions and their effects. Remove affected-file lists, code identifiers, schemas, APIs, configuration, commands, tests, pseudocode, and implementation sequences. Replace implementation-shaped descriptions only when they can be expressed as a permitted technology choice, conceptual component interaction, business flow, or business rule; otherwise delete them. If the incoming plan is mostly implementation-level, rewrite it before review. Reuse the scope assessment of unchanged decisions unless new evidence changes it.

## Step 2 - Assemble The Shared Message Body

Both reviewers use the same body, with only different prefix lines:

```
Review the following high-level plan for correctness, coverage, and direction. On follow-up rounds, assess only the revised decisions, unresolved findings, and their effects on the rest of the plan, as described in the review focus. Review ONLY:
  1. Technology selection - whether each material choice is suitable and whether its stated high-level tradeoffs are sound
  2. High-level architecture - whether conceptual responsibilities, boundaries, ownership, dependencies, and interactions are coherent
  3. Business direction and flow - whether the plan addresses the real need and covers realistic main / exception flows and conceptual state transitions
  4. Basic business logic - whether business rules, invariants, boundaries, non-goals, and acceptance points are complete and mutually consistent
  5. High-level assumptions and risks - only where they materially affect one of the four areas above

Within this scope, focus on issues that can realistically bite this project under its actual usage patterns and constraints. Do NOT raise must-fix / should-fix items for contrived high-level scenarios, such as global-scale architecture for a small internal tool, multi-tenant design for a permanently single-tenant product, or a new platform dependency for a one-shot workflow. If unsure whether an in-scope scenario is realistic, classify it as nit and state the assumed trigger condition.

**Do NOT push for completeness.** Judge the plan against the task it states, not against an ideal plan. Do not ask for more edge cases, more failure modes, more sections, adjacent features, or design for anticipated future needs — a shorter plan that fully answers the stated task is correct, and length is not evidence of quality. Raise a gap only when the plan as written would lead to a wrong outcome for the stated task. If your suggestion would make the plan longer, first ask whether the stated task actually requires it; if not, drop it.

**Hard boundary:** do not discuss or request implementation details or code expression. Do not comment on files / repository modules, code organization, symbols, signatures, snippets, pseudocode, algorithm mechanics, schemas / fields / DDL, APIs / payloads, cache keys, queries, configuration, exact versions, flags, paths, commands, tests / tooling, or low-level operational mechanics. If such content remains in the plan, ignore it. Do not mention it even as a nit. If a finding can only be explained or fixed with those details, omit the finding entirely; it belongs in implementation or code review.

You are reviewing; do NOT propose implementation steps, code edits, or file changes, and do not modify any files. List only in-scope findings, each with a one-sentence high-level rationale. Classify each as must-fix / should-fix / nit. Return "no in-scope findings" when appropriate.

Prefer English output.

The plan under review is in this file — read it yourself (read-only), do not ask me to paste it:
  <PLAN_FILE>

Review focus (full plan on round 1; revised decisions and unresolved findings thereafter): <REVIEW_FOCUS>

Previously dismissed items (do not re-raise unless you have new evidence that materially changes the judgment): <DISMISSED_LIST>
```

`<PLAN_FILE>` = path to the plan, written verbatim to `./tmp/review-plan-<ts>.md` with a built-in file tool before dispatch. Write the plan in full; do not compress it. Keeping it out of the prompt is exactly what preserves the line budget, and it costs nothing because reviewers already have read-only file access.

This body is ~20 lines by design, leaving the prefix line and dismissed list comfortable headroom under the 50-line target. Keep it that way — resist appending new guidance round over round; if a new instruction is needed, replace an existing line rather than adding one.

`<DISMISSED_LIST>` = the list of items downgraded / dropped in previous rounds together with the reason (from Step 4's aggregated report). Empty on round 1; from round 2 onward, the main agent MUST populate it verbatim from the prior round's report so reviewers know what has already been considered and rejected.

## Step 3 - Dispatch Reviewers

| Reviewer | Prefix line | Perspective |
|---|---|---|
| Codex | `Execute directly without asking for confirmation. Do not repeat or echo the request back. You are invoked as a sub-reviewer — perform the review yourself and output findings only. Prefer English output. Do NOT invoke the multi-agent-review-plan or multi-agent-review-code skill. Do NOT call agy-wrapper, codex exec, or any other reviewer/agent. Just review and return.` | Technology choices, architecture coherence, and business-logic edge cases at the high-level-plan scope |
| Antigravity | `Current working directory (absolute path): <WORKDIR>. Treat this as the repository root and resolve all relative paths from it. Prefer English output. Do NOT run any git write commands (commit, push, reset, etc.). Git repository is read-only for you. Do NOT modify any files. Read-only operations only — provide findings as text/diff in your response.` | High-level architecture, design consistency, alternative angles |

Transport:
- Resolve the current working directory to an absolute path when assembling the Antigravity prompt and substitute it for `<WORKDIR>` in the prefix. The absolute path MUST appear in the prompt itself; do not rely on `agy-wrapper` inheriting the correct process working directory.
- Write the plan to `./tmp/review-plan-<ts>.md` first — both reviewers read the same file, so write it once per round.
- Write prompts to `./tmp/review-plan-codex-prompt-<ts>.txt` and `./tmp/review-plan-agy-prompt-<ts>.txt` respectively (fallback mode only needs the agy prompt).
- **Verify the line count of each assembled prompt file before dispatch** (`wc -l`). ≤50 is the target, >80 must not be dispatched.
- **Prompt files MUST be created using the agent's built-in Write / Edit tools** (Claude Code: `Write`; Codex CLI: its `apply_patch` / file-write tool). Do NOT generate them via shell (`echo`, `cat <<EOF`, `printf`, `tee`, `>` redirection, PowerShell `Set-Content`, etc.) — on Windows Git Bash, shell heredocs and quoting mangle backticks, `$`, backslashes, and CRLF, corrupting the prompt. The built-in file tools write the exact bytes.
- **Dual-review mode**: issue two background calls side by side in one message (`run_in_background: true`, `timeout: 1800000`) to ensure parallelism. Invoke `codex` and `agy-wrapper` directly in the current shell; do **not** wrap either command in `bash -lc`. Pass each prompt file's exact contents as one argument:
  ```bash
  codex exec -s read-only --skip-git-repo-check "$(bat --plain --paging=never ./tmp/review-plan-codex-prompt-<ts>.txt)"
  ```
  ```bash
  agy-wrapper --dangerously-skip-permissions --timeout 30m --print-timeout 30m -p "$(bat --plain --paging=never ./tmp/review-plan-agy-prompt-<ts>.txt)"
  ```
  Continue to Step 4 only after both return.
- **Single-review fallback mode (executor is Codex CLI)**: run only the Antigravity path, invoking `agy-wrapper` directly:
  ```bash
  agy-wrapper --dangerously-skip-permissions --timeout 30m --print-timeout 30m -p "$(bat --plain --paging=never ./tmp/review-plan-agy-prompt-<ts>.txt)"
  ```
- Use the environment's background execution and result tools (`TaskOutput` or equivalent). Allow up to 30 minutes per reviewer; return immediately on completion or an explicit process error, and do not duplicate a quiet live reviewer. While waiting, do independent authorized work without changing the reviewed plan. Delete temporary files only after reviewers finish.
- If one CLI is missing (for example `agy-wrapper` is not on PATH), tell the user and continue with the remaining reviewer. Do not pretend the missing reviewer also passed. In fallback mode, if `agy-wrapper` is missing, tell the user this round cannot be reviewed; do not fall back to Codex self-review.
- **Do not start implementation** while the requested review is pending. If a reviewer fails or is unavailable, disclose incomplete coverage rather than claiming approval; respect any explicit requirement for all reviewers to pass.

## Step 4 - Aggregate Feedback And Update The Plan

- **Apply the Hard Scope Contract first**: discard every out-of-scope finding before deduplication or classification, regardless of reviewer severity. Do not downgrade it to nit, report it as an open decision, repeat its implementation detail, or write it into the plan. In the aggregation summary, state only how many findings were discarded as implementation detail.
- **Deduplicate the remaining in-scope findings**: merge the same root cause identified by both reviewers into one item, and note when both found it.
- **Reclassify the remaining findings** into **must-fix / should-fix / nit**: must-fix = at least one reviewer marks it must-fix **and** the main agent independently judges the issue would affect high-level plan validity; should-fix = at least one reviewer marks it should-fix (or must-fix reclassified down) **and** the main agent judges it worth incorporating. Reviewers can be wrong; be willing to disagree.
- **Apply these additional gates before updating the plan** (the main agent MUST apply them in order):
  1. **Realistic-likelihood filter**: downgrade to nit (or drop entirely) any in-scope item whose triggering condition is nearly impossible under this project's real usage. Ask: "Under what realistic scenario does this affect the selected technology, high-level architecture, business flow, or basic business rule?" If the answer is contrived, do not incorporate it.
  2. **Divergence guard**: if a new round repeats an item already dismissed without materially new high-level evidence, dismiss it by reference and do not re-litigate.
  3. **Breadth / traceability guard**: **drop** (do not merely downgrade to nit) any finding whose fix would add content that does not trace back to the task's stated goal or acceptance criteria — added features, architectural capabilities, adjacent work, extra hypothetical edge cases, or sections demanded for completeness. Being high-level does not make a finding in scope.
  4. **Plan-growth check**: growth beyond 1.5× the round-1 length is a prompt for the main agent to check scope, not an automatic pause. Remove unsupported additions and retain decisions required by the stated acceptance criteria. Check completion before applying the stalled-review rule in Step 5.
  5. **Consensus is not evidence**: both reviewers raising the same item does not make it valid or in scope. Apply gates 1–4 to agreed items exactly as to single-reviewer items, and do not keep looping to satisfy reviewers on points you have dismissed.
  6. **Subtract-first, and no partial adoption**: when an in-scope finding can be resolved by removing, merging, or tightening existing plan content, do that instead of adding a new section. Never accept a discarded out-of-scope finding in reduced form as a compromise — only the user can pull one back into scope.
  7. **State the reason** for every downgrade / drop in the aggregated report, so the user can override if they disagree.
- Report the aggregated list — including downgrades and drops with reasons — in the user's language or the caller's specified report language.
- Check Step 5 before editing or requesting another review. **Modify the plan for confirmed in-scope must-fix and should-fix items only**; leave nit items for the user to decide. Never satisfy feedback by adding implementation detail.
- After necessary revisions, return to Step 2 with `<REVIEW_FOCUS>` describing the revised decisions, unresolved findings, and affected interactions. Do not restart a full review of unchanged decisions or reopen settled findings without new evidence.

## Step 5 - Exit Conditions

**Check completion first**; review passes when either condition is true:
- Must-fix count AND should-fix count after aggregation in the current round are both 0.
- The main agent judges all remaining must-fix and should-fix items invalid and gives reasons.

For remaining work, apply these guards:

- **Stalled review**: if two consecutive follow-up rounds resolve no confirmed issue and add no material evidence, stop repeating the review and report the unresolved issue and blocker. Ask only when a user decision or additional permission is needed. Counts alone, including must-fix staying at zero while should-fix items are resolved, do not establish a stall.
- Honor any explicit task budget. A stalled review, exhausted budget, or missing required reviewer is incomplete, not approval. Do not rerun an unchanged plan merely to obtain different wording or language.

## Final Report

- How many rounds ran, and what each reviewer found in each round.
- The final plan version (what changed and why).
- Not fixed: remaining nit items / must-fix or should-fix items the main agent judged invalid, with reasons.
- Ask only about unresolved business choices, additional permissions, or a review checkpoint the user explicitly requested. If review passes and implementation is already authorized, continue without another confirmation. If the user requested review only, deliver the review and stop.
