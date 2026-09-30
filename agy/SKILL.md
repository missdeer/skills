---
name: agy
description: Send high-level plan reviews, requirement clarification, task planning, technical consultation, or architecture-review prompts to an existing Antigravity session through Herdr. Use when the user wants to "ask antigravity/agy", "have antigravity review the plan", "have agy look at my design/idea/architecture", or "ask another large model for ideas". This is not for line-level code correctness review or multi-reviewer ship-readiness workflows; when the user has already decided and only implementation remains, do not consult it, just write the code.
metadata:
  version: "1.1.0"
---

# agy - Consult Antigravity For Architecture / High-Level Direction

In this repository, Antigravity is the **steering wheel**: it reviews direction, planning, and knowledge, not line-level code details.

## Use Cases

- High-level design review / architecture validation.
- Clarifying follow-up questions when requirements are vague.
- Step-by-step implementation planning for non-trivial tasks.
- Technical consultation, solution comparison, and Web frontend (HTML/CSS/JS) prototyping ideas.

## Hard Constraints (Required For Every Invocation)

1. **Prompt prefix** (must be exact, as the first line of the message):

       Do NOT run any git write commands (commit, push, reset, etc.). Git repository is read-only for you. Do NOT modify any files. Read-only operations only — provide findings as text/diff in your response.

   Then add a blank line, followed by your context and question.
   > Background: Antigravity has previously modified files without authorization. The prefix is a hard guardrail. After it finishes, if you suspect it changed anything, verify with `git status` / `git diff`.

2. **Provide context on demand; do not dump source code**:
   - A problem statement covering "what is being built and why".
   - Constraints that are already fixed (tech stack, data model shape, deadline, existing decisions).
   - The architecture sketch you are considering; bullets or a short text diagram are enough.
   - **Do not** paste entire source files; that wastes its context budget on details it does not need.

3. **Transport method - use the existing Antigravity pane through Herdr**:
   - Before any control command, check `test "${HERDR_ENV:-}" = 1` as a fast path. This environment variable is not sufficient proof by itself; when it is unset or false, confirm the session with the read-only commands `herdr status` and `herdr pane current --current`. Continue only when those commands identify a current Herdr session or pane; otherwise report that the session is not running inside Herdr and stop. Do not invoke an Antigravity CLI directly.
   - Inspect the caller's layout with `herdr pane layout --pane "$HERDR_PANE_ID"`, then cross-reference `herdr pane list --workspace "$HERDR_WORKSPACE_ID"` and `herdr agent list` to locate the existing adjacent pane whose recognized agent is Antigravity/agy. Use the returned unique agent name or pane ID; do not infer IDs from pane order, and do not start a replacement agent or create a new layout.
   - Send the exact prompt (including the required prefix as line one) to that session with `herdr agent prompt <agy-agent-name-or-pane-id> "<prompt>" --wait --timeout 1800000`. This sends the prompt into the live pane; do not call `agy`, `agy-wrapper`, or pass the prompt to either CLI.
   - If a Herdr command is denied by the Codex terminal sandbox, rerun the same `herdr` command with the terminal tool's `require_escalated` approval flow (and a narrowly scoped `herdr` prefix rule when supported). Do not bypass Herdr by invoking an Antigravity CLI.
   - Read the returned response with the prompt result, or use `herdr agent get <target>` and `herdr agent read <target> --source recent-unwrapped --lines 120` when the response is not included. A timeout or stalled response is not proof that delivery failed: inspect the agent state and recent output before retrying. Retry once only after confirming the previous turn did not complete; otherwise return the original error to the user.

## After Receiving Antigravity's Response

- Summarize in **Chinese**, presented in three sections:
  - **Antigravity's Direction**
  - **Differences From The Current Approach**
  - **My Recommendation**
- If it conflicts with the current approach, **do not smooth over the conflict**: present both options and let the user choose.
- **Do not automatically implement its suggestions**; even if they look correct, surface them first and wait for the user's decision.
- Antigravity's output is an "external logic reference". When implementing code, refactor according to repository style instead of copying it verbatim.

## Trigger Examples

- User: "agy, review my field-splitting idea for this new report tab" -> package the problem statement, existing field list, and your splitting draft -> send it to the adjacent Antigravity pane through Herdr.
- User: "have antigravity produce a step-by-step plan to migrate from X to Y" -> package the X/Y current state, constraints, and deadline -> send it to the adjacent Antigravity pane through Herdr.
- User: "which layout option is best for this frontend page? give me a few prototype ideas" -> package the page goal, chosen UI library, and visual constraints -> send it to the adjacent Antigravity pane through Herdr.
