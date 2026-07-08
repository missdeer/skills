---
name: commit
description: Commit the current repository's local changes to git with a conventional English commit message, following this repository's conventions (no co-author line, write the message to `./tmp/commit_message.txt` and use `git commit -F`, stop and hand off to the user on GPG failure). Use when the user says "commit", "submit these changes", "help me commit these changes", or "commit this". Only create a single commit; do not push and do not perform pre-commit fixes.
metadata:
  version: "1.0.0"
---

# commit - Create One Local Git Commit According To Repository Conventions

Single-commit workflow. It is only responsible for turning staged / working-tree changes into one commit that matches repository style. **Do not push, amend, force, or rebase**.

## Preconditions

- Execute this skill only when the user **explicitly asks for a commit**; otherwise do not commit proactively.
- Run all git operations at the **repository root**. If cwd is not the root, switch there before starting.
- **Use English for the commit message**.
- **Do not add a co-author** line (repository convention).
- Do not use a heredoc to write the message, and do not use `-m`; always use `./tmp/commit_message.txt` + `git commit -F`.
- **Do not skip hooks / signing** (do not add `--no-verify` / `--no-gpg-sign`) unless the user explicitly asks.

## Step 1 - Inspect Repository State First

Run in parallel:
- `git status` (do not add `-uall`, to avoid blowing memory in large repositories)
- `git diff` (unstaged working-tree changes)
- `git diff --cached` (staged changes)
- `git log -n 10 --oneline` (align with this repository's commit message style)

Understand the **exact scope** and **style template** for this commit before continuing.

## Step 2 - Draft The Commit Message

- Analyze staged changes plus changes that will be added, determine the change type (feat / fix / refactor / test / docs / build / chore / ...), and follow the repository's existing commit style (inspect the actual `git log` format, such as `type(scope): subject`).
- Keep the subject line concise and focus on **why**, not **what**; 1-2 sentences is usually enough.
- **Do not** commit files that may contain secrets (`.env`, `credentials.json`, etc.); if the user specifically asks to commit them, warn them first.
- Prefer `git add` by filename for the items to commit, to avoid pulling sensitive files or large binaries in with `git add -A` / `git add .`.

## Step 3 - Write The Message And Commit

1. If `./tmp/commit_message.txt` already exists, delete it first.
2. Use the **Write tool** (**not** a heredoc / `echo`) to write the message to `./tmp/commit_message.txt`.
3. Run:
   ```bash
   git commit -F ./tmp/commit_message.txt
   ```
4. Run `git status` to confirm the commit succeeded.

## Step 4 - Handle The Result

- **GPG signing failure**: **stop**, tell the user why it failed, and ask them to commit manually. Do not try to bypass it with `--no-gpg-sign`.
- **pre-commit hook failure**: the commit did not happen. After fixing the hook-reported issues, **create a new commit** (do not `--amend` the previous commit, which would incorrectly modify history).
- **Success**: report the new commit hash and subject to the user in one confirmation line. Do not write a long summary (the user can inspect the diff).
- Whether it succeeds or fails, **do not push**.
