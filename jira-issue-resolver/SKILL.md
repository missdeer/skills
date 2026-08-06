---
name: jira-issue-resolver
description: End-to-end JIRA issue resolution workflow. Trigger for intents such as "resolve JIRA XXXX-nn", "fix XXXX-nn", "handle XXXX-nn", or a jira.ismisv.com/browse/ URL. It runs the full loop of finding the DAG root, producing and tersely reviewing a brief change plan, attaching the plan, coding and testing, reviewing code, committing, and writing back to JIRA. One run handles only one issue. If a story has no subtasks, split it first and implement only the first subtask; if all subtasks of a parent are complete, use the parent closeout shortcut.
metadata:
  version: "1.5.0"
---

# jira-issue-resolver

Guide the agent through a fixed process to resolve one JIRA issue: from parsing the issue key to writing the final commit id back to JIRA. **Every phase has a hard gate; do not enter the next phase unless the current one passes.**

## Trigger Scenarios

- "resolve JIRA issue SHELFECOMM-14"
- "fix https://jira.ismisv.com/browse/SHELFECOMM-14"
- "handle SHELFECOMM-14" / "help me fix XXXX-nn"
- The user pastes `https://jira.ismisv.com/browse/<KEY>-<N>` and clearly asks for it to be handled

Start this workflow only when an issue key can be parsed (shape: `PROJECT-123`). If the user is only asking a read-only question such as "what is XXXX-nn about" or "who owns this ticket", call the `/jira` skill for a point query and **do not** enter this workflow.

## Key Invariants (Stop If Violated)

1. **One run handles only one issue**: follow blocks / depends on / subtask links to find the most upstream root node, and handle only that node. After finding the root, do not go back and handle other nodes, and do not merge multiple issues into one run. If the root is Story-scope (Story type, or Task / Epic type whose scope spans ≥3 loosely coupled deliverables or ≥800-line diff) and has no existing subtasks / linked implementation tasks, follow step 4.5: split into subtasks in JIRA **before** writing a subtask-scoped plan, then **implement only the first subtask** in this run (code + test + review + commit + JIRA writeback), then stop. Leave the remaining subtasks and the parent closeout for later user-triggered runs.
2. **Do not write code before the plan is approved**: regardless of whether the plan comes from plan mode or normal conversation, do not Edit / Write product code until `/multi-agent-review-plan` has returned "approved".
3. **Code changes must include matching tests**: after product code is written, add or modify corresponding tests. Changing product code without tests means the phase is incomplete.
4. **Do not commit until `/multi-agent-review-code` converges**: as long as reviewers raise new issues in the `/multi-agent-review-code` loop, keep fixing and reviewing until a full round returns with no new issues. Reintroduced old issues also count as new issues.
5. **Use the real git commit value for JIRA writeback**: obtain the commit id from `git log -1 --format=%H`; do not rely on memory or reuse a previous hash.
6. **The plan file must be attached to JIRA**: do not paste it into the body. Upload it as an attachment through the `/jira` skill's attachment interface.
Invariants 7-9 constrain three independent axes — **depth** (how far down), **breadth** (how far out), **granularity** (how many pieces). A plan can satisfy one and violate another, so check all three.

7. **Depth and length — produce only a brief change plan**: the plan is a terse list of intended changes, not a design document or detailed solution. The author and reviewers must omit implementation detail, extended rationale, alternatives, architecture walkthroughs, and exhaustive flows.
8. **Breadth — scope is defined by the JIRA issue, and only by it**: the plan answers exactly what `TARGET`'s description and acceptance criteria ask, nothing more. Content that does not trace back to a line in the issue is out of scope by default and must be removed — including hypothetical edge cases, speculative failure modes, and peripheral concerns. This binds the plan author and every reviewer equally: the default answer to "should we also cover X?" is **no** unless X is required to satisfy the stated acceptance criteria, and out-of-scope reviewer requests are discarded regardless of severity label. Work subtract-first — when a round ends with the plan longer than it started, justify it in one sentence or revert the growth.
9. **Granularity — restraint on splitting**: creating linked tasks under a story or subtasks under a task is a heavy operation that forces multiple runs and delays delivery. Carefully evaluate necessity, never split over minor issues, and when in doubt do not split (see step 4.5).

## Steps

### 1. Parse The Issue Key And Fetch Details

Extract the issue key from the user's input. For URLs, take the segment after `/browse/`.

Call the `/jira` skill:
- Fetch issue details (summary / description / status / issue type / assignee / issuelinks / subtasks).
- Pay special attention to `issuelinks` (blocks / is blocked by / relates to / depends on), `subtasks`, and `parent`.

If the issue is already Closed / Resolved / Done, tell the user it is already closed, include the status and a summary of recent comments, and **do not** continue.

### 2. Follow The DAG To Find The Root And Lock The Target

Build a directed dependency graph:
- If this issue has `is blocked by` / `depends on` links to other issues, those issues are "upstream".
- If this issue is a subtask of a parent, the parent is not upstream (the parent is usually a tracker, not a blocker); however, if the parent explicitly requires another subtask first, follow the subtask order.
- `relates to` is not a hard dependency and **does not** enter the DAG.

Recurse: fetch details for each upstream issue and check whether it is blocked by other issues. **Only traverse open / in-progress nodes**; treat Resolved / Closed upstream issues as satisfied and skip them.

Among the remaining open nodes, find nodes with **in-degree 0** (no still-open upstream dependencies). If there are multiple, choose the one on the user's requested chain that is closest to the key the user provided. **This is the issue handled in this run**, recorded as `TARGET`.

Tell the user: "The issue X you provided depends on Y (and Y depends on Z, which is the open root) -> this run will only handle Z and then stop; X requires another run later." If `TARGET` is the user-provided key, explicitly say "There are no unfinished upstream dependencies, so I will handle it directly."

### 2.5 Parent Closeout Shortcut (Short-Circuit Later Steps When Applicable)

**Trigger conditions (all must be true)**:
- `TARGET` is a parent-type issue (Story, or a Task containing subtasks), meaning it has at least one subtask or at least one `is blocked by` / `depends on` link to another issue, and those downstream issues are its "implementation subtasks" rather than unrelated dependencies.
- All of those subtasks / linked tasks are Resolved / Closed / Done.
- `TARGET` itself is still open (not Resolved / Closed / Done).
- **Status-only completion rule**: for parent closeout, a subtask's Jira status is the sole authority on whether that subtask is complete. Do not inspect or reinterpret its description, acceptance details, comments, attachments, tests, commits, or other internal evidence to challenge a Resolved / Closed / Done status. Internal completion belongs to the subtask workflow and must not be re-audited from the parent.
- **Convention**: parent tasks should not contain independent implementation work. All deliverable work belongs to subtasks. Stop only when the parent explicitly contains work that is not assigned to any subtask at all; do not infer unfinished parent work by re-evaluating the internals of a completed subtask.

When the conditions are met, close out as follows (**skip steps 3-9 and go directly to this section's writeback**):

1. Use the `/jira` skill to summarize every subtask's key, status, and commit short hash recorded in each subtask's comments. Reading comments here is only for summary extraction and must not affect the completion decision; if a hash is unavailable, record it as unavailable and continue.
2. Add a comment to `TARGET`: list all subtask keys, commit short hashes, and delivery notes; conclude in one sentence that all subtasks are complete and the parent is being closed out.
3. **Transition status**: based on the transitions currently available on `TARGET`, move it to the appropriate next status (usually "In Review" or "Resolved", depending on the team workflow and the parent's role); ask the user if unsure.
4. Go directly to step 11 for closeout and end this run. **Do not** trigger plan, code, test, review, or commit.

If the conditions are not met, skip this section and continue to step 3.

### 3. Produce A Brief Change Plan

**First evaluate scope for step 4.5 splitting.** If `TARGET` matches the step 4.5 trigger, jump there before writing this plan.

**Then check whether the issue already ships with a plan.** Inspect the description and plan-shaped attachments through `/jira`. Extract only the brief change decisions; do not reproduce a detailed design.

- **Approved and sufficient**: condense it to the format below, skip steps 4 and 5, write the local copy, and continue to step 6.
- **Incomplete or unapproved**: retain only relevant decisions, fill only acceptance-blocking gaps, and continue to step 4.
- **In doubt**: ask the user in one sentence "the issue already has document X attached, treat it as the final plan or run review again?" and follow the user's decision.

Write the plan directly after enough read-only investigation to understand the ticket. Keep private analysis as detailed as needed; keep the emitted plan extremely short.

**Required format**:
- **3–7 flat bullets and normally no more than 15 non-empty lines**, including headings.
- State only: the outcome/scope, the concrete change points, and how acceptance will be verified.
- Add a risk, assumption, technology choice, or open decision only when it can block or materially redirect the change.
- One sentence per bullet. No paragraphs, nested lists, background, ticket restatement, rationale history, alternatives, component inventories, exhaustive flows, or boilerplate sections.
- Do not include files, symbols, schemas, endpoints, payloads, commands, test cases, pseudocode, or other implementation detail.
- Delete every bullet that does not trace directly to the JIRA description or acceptance criteria.

Complexity may justify more investigation, never a longer emitted plan. Exceed the line budget only when omitting a distinct acceptance requirement would make the plan incorrect; state that exception in one line.

### 4. `/multi-agent-review-plan` Review Loop

**Do not skip this.** After writing the plan, immediately call `/multi-agent-review-plan` (the command distributes the plan to Codex + AntiGravity for read-only review).

- Collect all reviewer feedback.
- Pass this **concise review contract** to every reviewer; it overrides that skill's normal report verbosity for this workflow:
  - Check only for a contradiction, wrong direction, or missing requirement that would materially mislead implementation.
  - Return `no actionable findings` or findings only. Write each finding as one sentence containing severity, the gap, and the affected acceptance requirement.
  - Do not restate or summarize the plan, praise it, narrate the review round, propose a detailed fix, compare alternatives, list nits, or raise speculative scenarios.
- Deduplicate and triage silently. Discard anything that is untraceable, implementation-shaped, speculative, or merely completeness-seeking; do not report discarded items individually.
- Amend only actionable gaps, using the fewest words possible and staying within the step 3 budget, then review again.
- Stop when a round returns no actionable findings. Report only the round count and final status; do not provide a round-by-round narrative.

**Only after approval may you enter step 5.**

### 4.5 Split A Story-Scope Root Into Subtasks

**Trigger conditions (all must be true)**:
- `TARGET.subtasks` is empty, AND there are no `is blocked by` / `depends on` links to other tasks (meaning step 2 has determined it is an open root with no subtasks and no downstream tasks), AND
- One of:
  - `TARGET.issuetype` is "Story" or an equivalent story type, OR
  - `TARGET.issuetype` is "Task" / "任务" / "Epic" but its **scope is Story-equivalent**: the description spans ≥3 loosely coupled deliverables (e.g. multiple tabs, multiple new fact tables, multiple independent modules), or the expected diff is ≥800 lines / touches ≥6 files (rough estimate from the plan or from analogous prior tickets in the same project). If unsure, ask the user in one sentence "this task looks Story-scope — split into subtasks first, or handle in one commit?" and follow their decision.

If the conditions are not met, skip this step and continue directly to step 5.

**Restraint principle**: subtask creation adds JIRA overhead, forces multiple runs, and delays delivery. Split only when the work genuinely cannot land as one coherent commit. If a Story-scope root can be delivered in a single reviewable commit with clear structure (even ~800–1200 lines), prefer to keep it whole. When in doubt, ask the user in one sentence — do not default to split. Also keep the decomposition itself minimal: prefer the smallest number of subtasks that carve the work along real functional boundaries (usually 2–4), never split for symmetry or "one per file" reasons.

**Split happens BEFORE the subtask-scoped brief change plan is written**, not after. When the conditions are met, the flow is:

1. **Skip the step 3 plan for now** — write a brief decomposition plan using the same format and budget, plus one bullet per proposed subtask. Hard ceiling: 20 non-empty lines. Include only the outcome, functional slices, dependency order, and acceptance point for each slice.
2. Run `/multi-agent-review-plan` under the step 4 concise review contract.
3. Once the decomposition plan is approved, use the `/jira` skill to create that number of subtasks under the `TARGET` project (issuetype is usually "Task" / "Sub-task", depending on project configuration; ask the user if unsure), and make each new task a subtask of `TARGET` or link it back to `TARGET` with `is blocked by`. For each subtask, write a summary describing the delivered functional slice and copy its relevant bullet into the description.
4. Record the generated subtask key list as `SUBTASKS = [key1, key2, ...]`, ordered by dependency / implementation order.
5. Add a comment to `TARGET` (the story / task): list all `SUBTASKS` and explain that they should be executed in order, one per run; this run will implement `SUBTASKS[0]` first, and the remaining subtasks should be handled by triggering this skill again later.
6. Attach the decomposition plan to `TARGET` once for future linking.

**Relock TARGET and write the subtask-1 plan**: after splitting, set `TARGET` to `SUBTASKS[0]`. Write and review a fresh brief change plan under steps 3–4 for this subtask only.

All "TARGET" references after this section (step 5 attachment, code, tests, review, commit, writeback) apply to this one subtask.

Do not write back status to the story / parent task itself during this run. When the next run handles `SUBTASKS[1]`, the parent remains in the "split and waiting to be consumed one by one" state. After all subtasks are complete, if the user triggers this skill again with the parent key, step 2's DAG will determine there are no open upstream dependencies, and step 2.5 will detect that it is a "parent whose subtasks are all complete" -> use the **parent closeout shortcut** to close it, without running the code workflow again.

### 5. Attach The Approved Plan To JIRA

- Write the final plan to `${project_root_dir}/tmp/jira-plan-<TARGET>.md` (`TARGET` is the currently locked issue: in non-split scenarios it is the original root issue; in split scenarios it is `SUBTASKS[0]`).
- Use the `/jira` skill to upload the file to the `TARGET` issue as an **attachment**.
- Also add a comment to the issue briefly saying that the final plan has been attached and implementation is starting, so related people can track it.
- In split scenarios, also upload the full plan file as an attachment to the **story itself** (the subtask copy is a subset; the story holds the full version for future linking).

### 6. Write Product Code

Implement the current `TARGET`'s approved outcome and acceptance scope. Decide all code-level details only now; do not retrofit them into the approved plan. Follow the six CLAUDE.md rules (especially Rule 2, minimal changes, and Rule 3, read before writing).

**If step 4.5 splitting happened**: the current `TARGET = SUBTASKS[0]`, and code changes must cover only its acceptance scope. Do not modify files / modules for other subtasks ahead of time, and do not include "while I was here" changes in this commit; doing so breaks the traceability where each JIRA subtask maps to one commit.

### 7. Write / Update Tests (Hard Gate)

- New feature -> add tests covering the golden path plus at least one edge case.
- Bug fix -> add a test that reproduces the bug (run it failing first, then make it pass).
- Existing behavior change -> update affected test assertions, and bind assertions to "why" (business rule), not the current return value (aligned with CLAUDE.md Rule 5).
- Run tests and confirm they are all green; explain any skipped tests. Silent skips are not allowed.

### 8. `/multi-agent-review-code` Multi-Agent Ship-Readiness Loop

**Do not skip this.** Call `/multi-agent-review-code` (multiple reviewers re-review the current changes).

- Pass every reviewer the same restraint standard: return actionable findings only, one sentence each with severity and location; omit praise, summaries, category boilerplate, detailed remediation plans, nits, speculative concerns, and round narration. A clean review returns `no actionable findings`. Brevity changes presentation, not review coverage.
- Aggregate by deduplicating findings and listing only issues that require a change. Do not expose discarded findings unless one blocks convergence.
- As long as there are new issues (even regressions introduced by the previous fix) -> fix -> run `/multi-agent-review-code` again.
- Continue until a full reviewer round raises no new issues.
- During the loop, you may use `/audit` / `/codex` / `/agy` for focused consultation as appropriate.

### 9. `/commit`

After `/multi-agent-review-code` converges, call the `/commit` skill to commit local changes. Include the JIRA key in the commit message (for example `(TARGET-KEY)`) for traceability.

After committing, obtain the commit id:

```bash
git log -1 --format=%H
```

Record the short hash (first 12 characters) and the full hash for later use.

### 10. Write Back To JIRA: Status + Change Notes + Commit Id

Use the `/jira` skill on the current round's `TARGET` (in split scenarios this is `SUBTASKS[0]`; otherwise it is the original root issue):

1. **Add a comment** containing:
   - Summary of this change (what was done and which files / modules were affected)
   - Test status (tests added / modified and run results)
   - Git commit id (full hash + short hash)
   - Branch name (`git rev-parse --abbrev-ref HEAD`)
2. **Transition status**: based on the issue's current status and available transitions, move it to the appropriate next status (usually "In Review" or "Resolved", depending on the team workflow). First list available transitions with `/jira`, then pick the transition that best matches "code complete, awaiting acceptance"; ask the user if unsure.

Do **not** write back status to the story itself during this run.

### 11. Closeout

Tell the user:
- Which `TARGET` was handled (if different from the user-provided key, state that again).
- Commit id and the new JIRA status (if the step 2.5 parent closeout shortcut was used, explain that there were no code changes and only the closeout status changed from X to Y).
- Split scenario: additionally tell the user that story `<key>` has been split into `SUBTASKS = [...]`, this run implemented `SUBTASKS[0]`, the next trigger of this skill will automatically pick `SUBTASKS[1]` (by step 2's DAG decision), and after all subtasks are complete, triggering this skill once more with the story key will use step 2.5 to close the story.
- Step 2.5 closeout shortcut scenario: explicitly tell the user that parent `<key>` was closed out based on all subtasks being complete, and this run produced no code changes / commit.
- If there are still unhandled downstream issues (the ones skipped in step 2), tell the user: "To continue, trigger this skill again for <next key>."

**This skill ends here. Do not automatically continue to the next unhandled root issue or next subtask.**

## Anti-Patterns (Avoid)

- Do not start coding immediately after receiving an issue. Without checking the DAG first, you may discover later that fixing an upstream issue would have resolved it.
- Do not write a plan and implement without review. `/multi-agent-review-plan` is a hard gate, and it catches many design issues at the lowest cost.
- Do not turn the brief change plan or any review into a design document. Emit only decisions and actionable gaps; implementation detail belongs to implementation.
- Do not paste the plan into a JIRA comment instead of an attachment. Long body text harms traceability; use an attachment.
- Do not change product code without tests. Passing tests does not prove the feature is correct, and future regressions will have no guardrail.
- Do not cherry-pick easy reviewer issues from `/multi-agent-review-code` while skipping harder ones. Fix every actionable issue before the next round.
- Do not invent a commit id or reuse an old one. Always fetch it live with `git log -1 --format=%H`.
- Do not handle multiple issues or keep walking the DAG in one run. This skill handles one root node per run and stops after it is done.
- Do not continue the workflow for an already Closed issue. Step 1 should stop it.
- Do not skip splitting when a Story or a Story-scope Task / Epic has no subtasks and then implement 500+ lines after plan approval. That violates step 4.5; overly large granularity makes review and regression risk impossible to contain. Type == "Task" is NOT a get-out-of-splitting card — scope is what matters.
- Do not implement `SUBTASKS[0]`, `SUBTASKS[1]`, ... in one run after splitting. That violates the "one run handles only one issue" invariant; each run implements one subtask, and the rest wait for later triggers.
- Do not casually transition the story to Resolved during the same run after splitting. Story status writeback is reserved for the later run where all subtasks are complete and step 2.5 uses the parent closeout shortcut.
- Do not run the normal plan->code->review workflow when the user provides a parent whose subtasks are all complete. That violates step 2.5; parent tasks should not have independent implementation work, so only summary writeback and status transition are needed.
- Do not force the step 2.5 shortcut when the parent has explicit work that is not assigned to any subtask. Stop, identify the unassigned parent work, and ask the user to add or assign a subtask first.
- Do not block parent closeout by re-auditing the internal details of a Resolved / Closed / Done subtask. Its Jira status is authoritative for the parent workflow, even when its comments or attachments contain caveats, stale notes, or incomplete evidence.
- Do not bundle multiple subtasks into one commit. Each JIRA subtask needs its own commit id for traceability, and mixed commits are hard to split later.
- Do not trigger step 4.5 splitting for a root that already has subtasks / linked implementation tasks. Step 4.5 only applies to orphan roots (Story or Story-scope Task) with no subtasks and no downstream tasks; if subtasks already exist, use step 2's DAG logic and handle one open subtask.
- Do not blindly rewrite a plan when the issue description / attachments already contain a sufficient approved plan. Condense and adopt it as described in step 3.
- Do not skip `/multi-agent-review-plan` on a plan you wrote yourself just because "the issue also has an old plan attached". The step 3 skip is only for adopting the existing plan as-is; any plan you author or substantively edit must still pass the review gate.
- Do not create linked tasks or subtasks casually. Splitting is a heavy operation and must be justified by real inability to deliver as one commit; do not diverge into subtask creation over minor issues, and prefer keeping work whole when in doubt.
- Do not let plans or reviews grow with hypothetical edge cases, speculative failure modes, peripheral concerns, or detailed remedies.
- Do not treat reviewer consensus as proof that a finding is in scope. Multiple reviewers can be out of scope simultaneously; discard and move on rather than looping to appease them.
- Do not accept an out-of-scope reviewer request in condensed form as a compromise. Partial adoption is still scope divergence; only the user can pull something back into scope.
- Do not answer reviewer feedback by growing the plan when tightening or removing content resolves it, and do not add template sections.
- Do not write narrative plans or review reports. Use terse bullets and omit everything that does not change the next action.
