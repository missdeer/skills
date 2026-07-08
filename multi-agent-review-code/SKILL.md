---
name: multi-agent-review-code
description: 用 Codex + Antigravity 双评审并行审 pending diff（或 branch-vs-master diff）→ 聚合去重 → 只修必修项 → 再 review，直到无新问题或轮次上限。发版前 / merge 前的 ship-readiness 重量级质量闸。当用户说"review 一下""过一遍双评审再合""ship 前扫一次""跑一轮 review loop"时使用。可选聚焦指令通过 arguments 透传。
metadata:
  version: "1.0.0"
---

# multi-agent-review-code — 双评审 ship-readiness 闭环

重量级质量闸：Codex + Antigravity 并行 review pending diff → 聚合 → 只修必修项 → 再 review，循环到干净或触顶。

## 执行模式：双评审 vs 单评审降级

在开始之前，判断当前执行本 skill 的 agent 身份：

- **默认（Claude 等）**：双评审——Codex + Antigravity 并行。
- **执行方本身就是 Codex CLI**：**降级为单评审**——只跑 Antigravity。理由：Codex 自审等于让作者审自己的作业，没有独立视角；只留 Antigravity 作为外部审阅者。降级时：
  - Step 3 只派发 Antigravity 一路，跳过 Codex 那一路。
  - Step 4 聚合按"单审阅者"进行，"两家都命中"这类描述不适用。
  - 最终汇报里注明本轮为**降级单评审**模式，并说明原因（避免用户误以为 Codex 也过了）。
- **判断方法**：若不能确定当前 agent 身份，按默认双评审执行；若上下文明确来自 Codex（如通过 `codex exec` 派生的子任务、prompt 明确标注执行方为 codex 等），走降级路径。

**轮次预算**：无限 review→fix 轮次，直到本轮无必修项，或触发下面的 Exit 条件。

## 每轮步骤

### 1. 决定 review scope

审阅者会自己跑 git 命令拿 diff，本 skill 不把 diff 塞 prompt。

- `git status` 看仓库状态。
- 工作区或索引有改动 → `<DIFF_CMD>` = `git diff HEAD`。
- 工作区干净 → `<DIFF_CMD>` = `git diff master...HEAD`，标为 **branch-vs-master** review。
- 不用担心 diff 大小 —— diff 不进 prompt，生成文件 / 大 fixture 都不成本。

### 2. 组装共享消息 body（两个审阅者一致，只有前缀不同）

```
Review the pending diff in this repo. First obtain the diff yourself by running (read-only):
  <DIFF_CMD>
Do not ask me to paste it; run the command and review its output. The repo's coding standards are in CLAUDE.md (Go modernize idioms, surgical changes, minimal abstractions). Check for:
  1. Correctness bugs (off-by-one, nil deref, error swallowing, missing context propagation)
  2. Edge cases the change doesn't handle (empty input, partial failure, concurrent access)
  3. Security issues (SQL injection, command injection, secret leakage)
  4. Backward compatibility breaks (DB schema, public APIs, file formats)
  5. CLAUDE.md / Go-standards violations (legacy CLI use, non-modern Go idioms, unused params)

You are reviewing; do NOT propose code edits — list findings only, each with file:line and a one-sentence rationale. Classify each as must-fix / should-fix / nit.

Focus instruction from user (may be empty): <ARGS>
```

### 3. 派发审阅者

两个审阅者用同样的 body，各自加自己的前缀行：

| Reviewer | 前缀行 | 视角 |
|---|---|---|
| Codex | `Execute directly without asking for confirmation. Do not repeat or echo the request back.` | 深度技术、边界、行级正确性 |
| Antigravity | `Do NOT run any git write commands (commit, push, reset, etc.). Git repository is read-only for you. Do NOT modify any files. Read-only operations only — provide findings as text/diff in your response.` | 高层架构、设计一致性、备选角度 |

传输：
- prompt 分别落到 `./tmp/review-codex-prompt-<ts>.txt` 和 `./tmp/review-agy-prompt-<ts>.txt`（降级模式只需要 agy 那份）。
- **双评审模式**：一条消息内并列两个 Bash 后台调用（`run_in_background: true`，`timeout: 1800000`），确保并行：
  ```bash
  codex exec -s read-only --skip-git-repo-check "$(bat --plain --paging=never ./tmp/review-codex-prompt-<ts>.txt)"
  ```
  ```bash
  agy-wrapper --dangerously-skip-permissions --timeout 30m -p "$(bat --plain --paging=never ./tmp/review-agy-prompt-<ts>.txt)"
  ```
  两个都返回后再进 Step 4。
- **降级单评审模式（执行方是 Codex CLI）**：只跑一路：
  ```bash
  agy-wrapper --dangerously-skip-permissions --timeout 30m -p "$(bat --plain --paging=never ./tmp/review-agy-prompt-<ts>.txt)"
  ```
- `TaskOutput` 轮询结果，跑完删临时文件。
- 若一个 CLI（比如 `agy-wrapper`）不在 PATH，**告诉用户**并用剩下的那个继续，不要假装另一个也通过了。降级模式下若 `agy-wrapper` 缺失，直接告诉用户本轮无法评审，不要回落到 Codex 自审。

### 4. 聚合发现

- **去重**：两个审阅者对同一 `file:line` 同一根因，合并为一条并注明两家都命中。
- **重分级**为 **必修 / 建议修 / 吹毛求疵**：一条被列为**必修**的条件是——至少一个审阅者标为 must-fix **并且** Claude 自己判断确实会出问题。审阅者会错，别橡皮章。
- 修之前把聚合清单用中文报给用户。

### 5. 修（仅当必修项 > 0）

- **只修必修项**，建议修 / 吹毛求疵留给用户拍板。
- 按 CLAUDE.md Rule 2：最小外科式改动，不顺手重构周边代码。
- 修完轮次 +1，回到 Step 1。

### 6. 退出条件

以下任一为真时**停止**并汇总：
- 已跑 3 轮（无论是否还有必修）。
- 本轮聚合后必修 = 0。
- 剩余的必修项 Claude 判断全部无效并给出理由（不要在分歧上死循环）。

### 最终汇报（中文）

- 跑了几轮、每轮各 reviewer 找到什么。
- 已修：列出每个必修项及其修法。
- 未修：剩余的 建议修 / 吹毛求疵 / Claude 判断无效的必修，附理由。
- 用户需要决定的点。
