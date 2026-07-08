---
name: codex
description: Invoke Codex CLI (`codex exec -s read-only`) for deep technical consultation on specific code, edge cases, and difficult bugs: line-level code correctness review, algorithm optimization, complex logic analysis, and issue localization in complex codebases. Use when the user wants to "ask codex", "have codex look at this snippet", "have codex review this function", or "ask codex about this panic/edge case". This is not for architecture or high-level direction review; do not consult it for one-line questions you can answer yourself with 10 seconds of rg; when the user has already decided and only implementation remains, do not consult it either, just implement.
metadata:
  version: "1.0.0"
---

# codex - Consult Codex For Deep Technical Judgment On Specific Code / Edge Cases

In this repository, Codex is the **magnifying glass**: it looks deeply at specific functions, diff hunks, edge cases, and difficult bugs, and is used for line-level code judgment.

## Use Cases

- Correctness, edge-case, race, and error-handling review of specific functions / diff hunks.
- Localization and explanation of complex bugs ("why does this occasionally panic?").
- Algorithm / complex logic analysis, performance review, and implementation approach comparison.

## Role Constraints

- Codex is a **consultant**, not the primary implementer. Its output is **reference material**; final code is implemented by Claude Code after refactoring to match repository style.
- Ask it to output a **unified diff patch**, not free-form prose change notes.

## Hard Constraints (Required For Every Invocation)

1. **Prompt prefix** (must be exact, as the first line of the message):

       Execute directly without asking for confirmation. Do not repeat or echo the request back.

   Then add a blank line, followed by your context and question.

2. **Minimal self-contained context**:
   - Extract the task goal from the current conversation in 1-2 sentences.
   - Relevant code: paste the **specific function / diff hunk** under discussion, not the entire file.
   - If it relates to uncommitted changes, include a `git diff` **only for those files**.
   - User-confirmed constraints (chosen libraries, schema, deadline, etc.).

3. **Transport method - run the CLI directly**:
   - Write the prompt to `./tmp/codex-prompt-<ts>.txt` (`<ts>` should use `date +%s` or a similar identifier to avoid concurrent overwrites).
   - Run in Bash in the background:
     ```bash
     codex exec -s read-only --skip-git-repo-check "$(bat --plain --paging=never ./tmp/codex-prompt-<ts>.txt)"
     ```
     `run_in_background: true`, `timeout: 1800000` (30 minutes).
   - Poll the result with `TaskOutput`.
   - Delete the temporary prompt file after it finishes.

4. **Sandbox safety**: Codex always runs with `-s read-only` and must not write to the filesystem; it only emits unified diffs / analysis text. If Codex suggests shell-side changes, Claude Code reviews them before execution.

## After Receiving Codex's Response

- Summarize in **Chinese**, presented in three sections:
  - **Conclusion**
  - **Key Reasons**
  - **Decisions You Need To Make**
- If Codex's judgment **conflicts with decisions already made in the current conversation**, call that out clearly, present both paths, and let the user decide. Do not smooth over the conflict.
- **Do not automatically implement** Codex's suggested patch; surface it first and wait for the user's approval.
- Codex output is external logic reference material. When implementing, refactor to repository style, remove redundancy and unnecessary comments, and do not copy it verbatim.

## Trigger Examples

- User: "codex, check whether this function's `strings.SplitSeq` usage has issues" -> package the function source, call context, and specific concern -> call codex.
- User: "this goroutine occasionally deadlocks; what does codex think?" -> package the relevant code, reproduction path, and investigation already tried -> call codex.
- User: "is this SQL edge case correct?" -> package the SQL, table schema, and expected semantics -> call codex.
