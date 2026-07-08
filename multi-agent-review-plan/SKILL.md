---
name: multi-agent-review-plan
description: 在动手实现前，把当前任务的执行计划送给 Codex + Antigravity 并行做方案评审 → 聚合意见 → 修改计划 → 再评审，直到无新问题。用于在写代码前对齐方向，避免做完才发现方向错。当用户说"评一下我的方案""动手前先 review 计划""方案先过一遍双评审""看看这么做行不行"时使用。审阅者只评审，不改文件。
metadata:
  version: "1.0.0"
---

# multi-agent-review-plan — 双评审对方案 / 执行计划做闭环 review

在**动手写代码之前**用 Codex + Antigravity 双评审对齐方向。目标是避免走错方向做完才发现要重来。

## 执行模式：双评审 vs 单评审降级

在开始之前，判断当前执行本 skill 的 agent 身份：

- **默认（Claude 等）**：双评审——Codex + Antigravity 并行。
- **执行方本身就是 Codex CLI**：**降级为单评审**——只跑 Antigravity。理由：Codex 自审等于让方案作者审自己的方案，没有独立视角；只留 Antigravity 作为外部审阅者。降级时：
  - Step 3 只派发 Antigravity 一路，跳过 Codex 那一路。
  - Step 4 聚合按"单审阅者"进行，"两家都命中"这类描述不适用。
  - 最终汇报里注明本轮为**降级单评审**模式，并说明原因（避免用户误以为 Codex 也过了）。
- **判断方法**：若不能确定当前 agent 身份，按默认双评审执行；若上下文明确来自 Codex（如通过 `codex exec` 派生的子任务、prompt 明确标注执行方为 codex 等），走降级路径。

## Step 1 — 确认有计划可评

- 复杂或多步任务：如果对话里还没有一份结构化的执行计划，**先写一份**（当前对话内产出即可，不必落盘），涵盖：目标、拆分步骤、关键决策点、涉及的文件 / 模块、验证方式。
- 已有足够计划：跳过写计划这一步，直接用现有的。
- 如果任务本身足够琐碎（1–2 步一次落地），本 skill 不适用，直接实现。

## Step 2 — 组装共享消息 body

两个审阅者用同样的 body，只有前缀行不同：

```
Review the following implementation plan for correctness, coverage, and direction. The repo's coding standards are in CLAUDE.md (Go modernize idioms, surgical changes, minimal abstractions, no speculative abstractions). Check for:
  1. 方向是否正确 —— 是否命中真实需求，是否有更直接的路径
  2. 步骤是否完备 —— 是否漏掉必要步骤（迁移、回滚、验证、清理）
  3. 风险与边界 —— 潜在破坏面、兼容性、并发 / 事务、数据一致性
  4. 依赖与前置 —— 是否假定了不成立的前提，是否漏了外部约束
  5. 可验证性 —— 完成时如何证明"完成"，验证手段是否可执行

You are reviewing; do NOT propose code edits or modify any files — list findings only, each with a one-sentence rationale. Classify each as must-fix / should-fix / nit.

Plan under review:
<PLAN_TEXT>
```

`<PLAN_TEXT>` = Step 1 里那份计划的原文，不要压缩。

## Step 3 — 派发审阅者

| Reviewer | 前缀行 | 视角 |
|---|---|---|
| Codex | `Execute directly without asking for confirmation. Do not repeat or echo the request back.` | 深度技术、边界、行级正确性 |
| Antigravity | `Do NOT run any git write commands (commit, push, reset, etc.). Git repository is read-only for you. Do NOT modify any files. Read-only operations only — provide findings as text/diff in your response.` | 高层架构、设计一致性、备选角度 |

传输：
- prompt 分别落到 `./tmp/review-plan-codex-prompt-<ts>.txt` 和 `./tmp/review-plan-agy-prompt-<ts>.txt`（降级模式只需要 agy 那份）。
- **双评审模式**：一条消息内并列两个 Bash 后台调用（`run_in_background: true`，`timeout: 1800000`），确保并行：
  ```bash
  codex exec -s read-only --skip-git-repo-check "$(bat --plain --paging=never ./tmp/review-plan-codex-prompt-<ts>.txt)"
  ```
  ```bash
  agy-wrapper --dangerously-skip-permissions --timeout 30m -p "$(bat --plain --paging=never ./tmp/review-plan-agy-prompt-<ts>.txt)"
  ```
  两个都返回后再进 Step 4。
- **降级单评审模式（执行方是 Codex CLI）**：只跑一路：
  ```bash
  agy-wrapper --dangerously-skip-permissions --timeout 30m -p "$(bat --plain --paging=never ./tmp/review-plan-agy-prompt-<ts>.txt)"
  ```
- `TaskOutput` 轮询结果，跑完删临时文件。
- 若一个 CLI 缺失（比如 `agy-wrapper` 不在 PATH），告诉用户并用剩下的那个继续，不要伪装另一个也过了。降级模式下若 `agy-wrapper` 缺失，直接告诉用户本轮无法评审，不要回落到 Codex 自审。
- 在**所有审阅者反馈拿到之前，不要动手实现**。

## Step 4 — 聚合意见并更新计划

- **去重**：两家指出的同一根因合并成一条，两家都命中要注明。
- **重分级**为 **必修 / 建议修 / 吹毛求疵**：必修 = 至少一家标 must-fix **且** Claude 自己判断该问题会影响方案成立。审阅者会错，敢于反对。
- 用**中文**把聚合清单报给用户。
- **只按必修项修改计划**，建议修 / 吹毛求疵留给用户拍板。
- 计划改完轮次 +1，回到 Step 2 再评。

## Step 5 — 退出条件

以下任一为真时**停止**：
- 已跑 3 轮（无论是否还有必修）。
- 本轮聚合后必修 = 0。
- 剩余的必修项 Claude 判断全部无效并给出理由。

## 最终汇报（中文）

- 跑了几轮、每轮各 reviewer 找到什么。
- 计划的最终版本（改过哪些点、为什么改）。
- 未修：剩余的 建议修 / 吹毛求疵 / 被 Claude 判为无效的必修，附理由。
- 用户需要决定的点 —— 明确请用户确认后才动手实现。
