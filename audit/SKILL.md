---
name: audit
description: 用 Codex CLI 对当前分支的待提交 diff 或 branch-vs-master diff 做单次结构化代码 review，输出 5 类问题（正确性 / 边界 / 安全 / 兼容性 / 编码规范）并按 必修/建议修/吹毛求疵 归类。当用户说"审一下当前改动""audit 一下""过一遍待提交的改动看看有没有问题""扫一下 diff"时使用。单次 review，不做 fix-loop。可选聚焦指令（如"只看 SQL""重点看错误处理""忽略测试文件"）通过 arguments 透传。
metadata:
  version: "1.0.0"
---

# audit — 让 Codex 对 pending diff 做单次结构化 review

单次 review、单个审阅者、不改代码、不循环。目标是尽快出一份"有哪些问题、多严重"的清单，交给用户判断。

## Step 1 — 决定 review scope

审阅者会自己跑 git 命令拿 diff（step 3 里说明），本 skill 只负责决定跑哪条命令。

- 先 `git status` 看仓库状态。
- 工作区或索引有改动 → scope 命令 = `git diff HEAD`（一并覆盖已 staged + unstaged）。
- 工作区干净 → scope 命令 = `git diff master...HEAD`，并向用户说明这是 **branch-vs-master** review，不是待提交改动 review。
- 把选中的命令称为 `<DIFF_CMD>`，代入 Step 2 消息。**不要**把 diff 内容塞进 prompt，让审阅者自己跑。

## Step 2 — 组装消息

`$ARGUMENTS` 里若带聚焦指令，原样透传（可为空）。消息必须以下面这一行开头，然后空一行，再拼 body：

    Execute directly without asking for confirmation. Do not repeat or echo the request back.

body：

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

## Step 3 — 跑 Codex

- 提示词落到 `./tmp/audit-prompt-<ts>.txt`（`<ts>` = `date +%s` 或类似标识，防并发覆盖）。
- Bash 后台跑：
  ```bash
  codex exec -s read-only --skip-git-repo-check "$(bat --plain --paging=never ./tmp/audit-prompt-<ts>.txt)"
  ```
  `run_in_background: true`、`timeout: 1800000`（30 分钟）。
- Codex 在仓库根跑，`<DIFF_CMD>` 会正常解析；`git diff` 在 `read-only` sandbox 下允许。
- 用 `TaskOutput` 轮询结果，跑完删掉临时 prompt 文件。

## Step 4 — 汇报

- 用**中文**汇总，按严重程度分三类：**必修 / 建议修 / 吹毛求疵**。
- 每条附 `file:line` 定位与一句话理由。
- **不要自动落地修复**——只列出、交给用户决定。
- 如果 Codex 返回空或"looks good"，如实说，不要为了"显得认真"编问题。
