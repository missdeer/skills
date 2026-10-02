---
name: codex
description: Send deep technical consultation prompts to an existing Codex session in an adjacent pane through the herdr skill for line-level code review, edge cases, algorithm analysis, and difficult bug localization. Use when the user wants to "ask codex", "have codex look at this snippet", "have codex review this function", or "ask codex about this panic/edge case". This is not for architecture or high-level direction review; do not consult it for one-line questions you can answer yourself with 10 seconds of rg; when the user has already decided and only implementation remains, do not consult it either, just implement.
metadata:
  version: "1.1.0"
---

# codex - Consult Codex For Deep Technical Judgment On Specific Code / Edge Cases

In this repository, Codex is the **magnifying glass**: it looks deeply at specific functions, diff hunks, edge cases, and difficult bugs, and is used for line-level code judgment.

## Use Cases

- Correctness, edge-case, race, and error-handling review of specific functions / diff hunks.
- Localization and explanation of complex bugs ("why does this occasionally panic?").
- Algorithm / complex logic analysis, performance review, and implementation approach comparison.

## Role Constraints

- Codex is a **consultant**, not the primary implementer. Its output is **reference material**; final code is implemented by the main agent after refactoring to match repository style.
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
   - The current repository's absolute path. Tell the existing session to resolve paths from that root and use this request's context rather than assumptions from earlier pane work.

3. **Transport method - use the existing Codex pane through the `herdr` skill**:
   - Read and follow the `herdr` skill for session detection, live agent discovery, prompt submission, waiting, and response retrieval. Use the installed `herdr --help` and command groups for current syntax.
   - Check `test "${HERDR_ENV:-}" = 1` as a fast path. When unset or false, confirm the session with the read-only commands `herdr status` and `herdr pane current --current`. If no current session or pane is identified, report that this session is not running inside Herdr and stop.
   - Inspect the caller's layout with `herdr pane layout --pane <caller-pane-id>`, then cross-reference `herdr pane list --workspace <workspace-id>` and `herdr agent list` to locate the existing adjacent pane whose recognized agent is Codex. Use IDs returned by discovery when environment IDs are unavailable. Target its returned unique agent name or pane ID, never the calling pane. Do not infer IDs from pane order, create a pane, or start a replacement agent.
   - Confirm the target is ready (`idle` or `done`) before submitting. If it is working, wait for that turn to settle; if blocked, inspect the UI and ask the user before answering it. An unknown state is not proof of readiness.
   - Send the exact prompt (including the required prefix as line one) with `herdr agent prompt <codex-agent-name-or-pane-id> "<prompt>" --wait --timeout 1800000`. Pass prompt text as one literal argument using a structured tool call or safe shell quoting. Do not invoke a headless Codex process or use a command-line fallback.
   - If a Herdr command is denied by the terminal sandbox, rerun that same command through the terminal tool's `require_escalated` approval flow with a narrowly scoped `herdr` prefix rule when supported.
   - Retrieve the response with `herdr agent read <target> --source recent-unwrapped --lines 120`; use `herdr agent get <target>` to inspect state. Wait on the same live call or agent in intervals no longer than 60 seconds, allowing up to 30 minutes. A timeout or stalled response does not prove delivery failed: inspect state and output before deciding whether a retry is warranted. Do not duplicate a live request or interrupt a quiet consultant.
   - If a larger recent read still cannot recover the completed response, follow the `herdr` skill's temporary Markdown file fallback. Do not request file output in the initial prompt.
   - If Herdr or an adjacent Codex session is unavailable, tell the user and stop; do not launch a replacement session.

4. **Review-only safety**: An existing interactive session does not inherit a read-only sandbox from this skill. Explicitly instruct it in every prompt to inspect source and git metadata only, not modify files, run git write commands, build, test, install, execute project binaries or scripts, format, lint, or run analyzers; return unified diffs / analysis text only. It must not invoke other reviewers or review-loop skills. The main agent reviews suggested changes before execution.

## After Receiving Codex's Response

- Summarize in **Chinese**, presented in three sections:
  - **Conclusion**
  - **Key Reasons**
  - **Decisions You Need To Make**
- If Codex's judgment **conflicts with decisions already made in the current conversation**, call that out clearly, present both paths, and let the user decide. Do not smooth over the conflict.
- **Do not automatically implement** Codex's suggested patch; surface it first and wait for the user's approval.
- Codex output is external logic reference material. When implementing, refactor to repository style, remove redundancy and unnecessary comments, and do not copy it verbatim.

## Trigger Examples

- User: "codex, check whether this function's `strings.SplitSeq` usage has issues" -> package the function source, call context, and specific concern -> send it to the adjacent Codex pane through Herdr.
- User: "this goroutine occasionally deadlocks; what does codex think?" -> package the relevant code, reproduction path, and investigation already tried -> send it to the adjacent Codex pane through Herdr.
- User: "is this SQL edge case correct?" -> package the SQL, table schema, and expected semantics -> send it to the adjacent Codex pane through Herdr.
