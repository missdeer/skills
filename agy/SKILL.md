---
name: agy
description: Invoke the Antigravity CLI (agy-wrapper) for high-level plan reviews, requirement clarification, task planning, technical consultation, or architecture review of a formed idea. Use when the user wants to "ask antigravity/agy", "have antigravity review the plan", "have agy look at my design/idea/architecture", or "ask another large model for ideas". This is not for line-level code correctness review or multi-reviewer ship-readiness workflows; when the user has already decided and only implementation remains, do not consult it, just write the code.
metadata:
  version: "1.0.0"
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

3. **Transport method - run the wrapper directly**:
   - Write the prompt to `./tmp/agy-prompt-<ts>.txt` (`<ts>` should use `date +%s` or a similar identifier to avoid concurrent overwrites).
   - Run in Bash in the background:
     ```bash
     agy-wrapper --dangerously-skip-permissions --timeout 30m -p "$(bat --plain --paging=never ./tmp/agy-prompt-<ts>.txt)"
     ```
     `run_in_background: true`, `timeout: 1800000` (30 minutes).
   - Poll the result with `TaskOutput`.
   - Delete the temporary prompt file after it finishes.
   - If it reports `authentication failed or timed out`, **retry once**; if it fails again, return the original error text to the user instead of forcing it.

## After Receiving Antigravity's Response

- Summarize in **Chinese**, presented in three sections:
  - **Antigravity's Direction**
  - **Differences From The Current Approach**
  - **My Recommendation**
- If it conflicts with the current approach, **do not smooth over the conflict**: present both options and let the user choose.
- **Do not automatically implement its suggestions**; even if they look correct, surface them first and wait for the user's decision.
- Antigravity's output is an "external logic reference". When implementing code, refactor according to repository style instead of copying it verbatim.

## Trigger Examples

- User: "agy, review my field-splitting idea for this new report tab" -> package the problem statement, existing field list, and your splitting draft -> call agy.
- User: "have antigravity produce a step-by-step plan to migrate from X to Y" -> package the X/Y current state, constraints, and deadline -> call agy.
- User: "which layout option is best for this frontend page? give me a few prototype ideas" -> package the page goal, chosen UI library, and visual constraints -> call agy.
