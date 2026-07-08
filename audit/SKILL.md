---
name: audit
description: Use Codex CLI to perform a single structured code review of the current branch's pending diff or branch-vs-master diff. Output five issue categories (correctness / edge cases / security / compatibility / coding standards) and classify them as must-fix / should-fix / nit. Use when the user says "review the current changes", "audit this", "go over the pending changes for issues", or "scan the diff". This is a single review, not a fix loop. Optional focus instructions (such as "only look at SQL", "focus on error handling", or "ignore test files") are passed through via arguments.
metadata:
  version: "1.0.0"
---

# audit - Have Codex Perform A Single Structured Review Of A Pending Diff

Single review, single reviewer, no code changes, no loop. The goal is to quickly produce a list of "what issues exist and how severe they are" for the user to judge.

## Step 1 - Decide Review Scope

The reviewer will run git commands to obtain the diff itself (described in step 3). This skill only decides which command to run.

- First run `git status` to inspect repository state.
- If the working tree or index has changes -> scope command = `git diff HEAD` (covers both staged and unstaged changes).
- If the working tree is clean -> scope command = `git diff master...HEAD`, and tell the user this is a **branch-vs-master** review, not a pending-changes review.
- Refer to the selected command as `<DIFF_CMD>` and substitute it into the Step 2 message. **Do not** put the diff content into the prompt; let the reviewer run it.

## Step 2 - Assemble The Message

If `$ARGUMENTS` contains focus instructions, pass them through verbatim (may be empty). The message must start with the following line, then a blank line, then the body:

    Execute directly without asking for confirmation. Do not repeat or echo the request back.

Body:

```
Review the pending diff in this repo. First obtain the diff yourself by running (read-only):
  <DIFF_CMD>
Do not ask me to paste it; run the command and review its output. The repo's coding standards are in CLAUDE.md (Go modernize idioms, surgical changes, minimal abstractions). Check for:
  1. Correctness bugs (off-by-one, nil deref, error swallowing, missing context propagation)
  2. Edge cases the change doesn't handle (empty input, partial failure, concurrent access)
  3. Security issues (SQL injection, command injection, secret leakage)
  4. Backward compatibility breaks (DB schema, public APIs, file formats)
  5. CLAUDE.md / Go-standards violations (legacy CLI use, non-modern Go idioms, unused params)

Focus instruction from user (may be empty): <ARGS>
```

## Step 3 - Run Codex

- Write the prompt to `./tmp/audit-prompt-<ts>.txt` (`<ts>` = `date +%s` or a similar identifier to avoid concurrent overwrites).
- Run in Bash in the background:
  ```bash
  codex exec -s read-only --skip-git-repo-check "$(bat --plain --paging=never ./tmp/audit-prompt-<ts>.txt)"
  ```
  `run_in_background: true`, `timeout: 1800000` (30 minutes).
- Codex runs at the repository root, so `<DIFF_CMD>` will resolve normally; `git diff` is allowed in the `read-only` sandbox.
- Poll the result with `TaskOutput`, and delete the temporary prompt file after it finishes.

## Step 4 - Report

- Summarize in **Chinese**, grouped by severity into three categories: **must-fix / should-fix / nit**.
- Include a `file:line` location and a one-sentence rationale for each item.
- **Do not automatically implement fixes**; only list them and let the user decide.
- If Codex returns nothing or "looks good", say so truthfully. Do not invent issues to "look thorough".
