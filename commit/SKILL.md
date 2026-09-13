---
name: commit
description: Create one local Git commit when committing is authorized by the user, directly or within an explicitly requested workflow. Follow repository message conventions; do not push or perform product-code fixes.
metadata:
  version: "1.0.0"
---

# commit - Create One Local Git Commit According To Repository Conventions

Single-commit workflow. It is only responsible for turning staged / working-tree changes into one commit that matches repository style. **Do not push, amend, force, or rebase**.

## Preconditions

- Execute this skill only when the user has authorized a commit, directly or as part of an explicitly requested workflow that includes committing. Reuse that authorization for the same scope; otherwise do not commit proactively.
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

1. Use the environment's built-in file-editing tool to write or replace `./tmp/commit_message.txt` directly; do not delete it first or generate it with a heredoc / `echo`.
2. Run:
   ```bash
   git commit -F ./tmp/commit_message.txt
   ```
3. Run `git status` to confirm the commit succeeded.

## Step 4 - Handle The Result

- **GPG signing failure**: **stop**, tell the user why it failed, and ask them to commit manually. Do not try to bypass it with `--no-gpg-sign`.
- **pre-commit hook failure**: report that the commit did not happen and return the findings to the calling implementation workflow. This skill does not fix product code. If the existing task authorizes those fixes, that workflow may fix and verify them, then retry this commit without asking again. For a commit-only request, report the blocker and ask before expanding into product-code fixes. Do not bypass the hook or use `--amend` on the previous commit.
- **Success**: report the new commit hash and subject to the user in one confirmation line. Do not write a long summary (the user can inspect the diff).
- Whether it succeeds or fails, **do not push**.
