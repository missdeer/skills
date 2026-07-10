# codex skills

This is a Codex CLI skill collection. Each subdirectory is a skill that Codex can recognize (`SKILL.md` plus optional `scripts/`, `references/`, and `agents/`). Trigger scenarios are defined in the `description` field of each `SKILL.md` frontmatter, and Codex loads skills automatically based on user intent.

## Skills

| Skill | Purpose |
|-------|------|
| [agy](agy/SKILL.md) | Invoke Antigravity CLI for high-level plan, architecture, and direction reviews |
| [codex](codex/SKILL.md) | Invoke Codex CLI for line-level code, edge-case, and difficult bug consultation |
| [audit](audit/SKILL.md) | Use Codex for a single structured review of a pending diff |
| [multi-agent-review-plan](multi-agent-review-plan/SKILL.md) | Run a dual Codex + Antigravity review of the implementation plan before coding |
| [multi-agent-review-code](multi-agent-review-code/SKILL.md) | Run a dual-review ship-readiness loop on a pending diff before release |
| [commit](commit/SKILL.md) | Create one local git commit according to repository conventions |
| [jira](jira/SKILL.md) | Read and write jira.ismisv.com issues through REST API v2 |
| [jira-issue-resolver](jira-issue-resolver/SKILL.md) | End-to-end JIRA issue resolution workflow (DAG -> plan -> implementation -> JIRA update) |
| [notebooklm](notebooklm/SKILL.md) | Google NotebookLM automation: podcasts, reports, slides, and deep research |
| [pkg-go-dev](pkg-go-dev/SKILL.md) | Query the pkg.go.dev v1beta REST API for Go package docs, versions, and CVEs |
| [cctv-h5e-download](cctv-h5e-download/SKILL.md) | Download and decrypt CCTV/CNTV H5e encrypted HLS streams into local MP4 files |
| [cdb-debugging](cdb-debugging/SKILL.md) | Diagnose Windows crashes, startup failures, hangs, and dumps with scripted `cdb.exe` sessions |
| [cmake-build](cmake-build/SKILL.md) | Build, clean, and reconfigure GarmentStyleMatch through its Windows CMake wrapper commands |

## Structure

```
<skill-name>/
├── SKILL.md          # frontmatter: name / description / metadata
├── scripts/          # optional: scripts required by the skill
├── references/       # optional: static reference material
└── agents/           # optional: sub-agent definitions
```

## Install To Claude / Antigravity

Mount all skills in this directory into `~/.claude/skills/` and `~/.gemini/antigravity-cli/skills/` using directory links (Windows junctions or POSIX symlinks). If `CLAUDE_CONFIG_DIR` is set, the Claude path changes to `$CLAUDE_CONFIG_DIR/skills/`.

**Linux / macOS**

```bash
~/.codex/skills/link.sh
```

**Windows**

```powershell
pwsh -File $HOME\.codex\skills\link.ps1
```

You can also run `link.sh` directly under Git Bash, MSYS, or Cygwin; it forwards automatically to `link.ps1`. Re-running is safe: old links are removed before new links are created.
