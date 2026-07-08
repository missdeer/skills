---
name: agy
description: 调用 Antigravity CLI（agy-wrapper）做高层方案评审、需求澄清、任务规划、技术知识咨询，或对已成型思路做架构审查。当用户想"问问 antigravity/agy""让 antigravity 评一下方案""agy 帮我看看设计/思路/架构""让另一个大模型出主意"时使用。不负责行级代码正确性审查、也不负责多评审 ship-readiness 工作流；用户已经拍板只等落地时，不咨询，直接写代码。
metadata:
  version: "1.0.0"
---

# agy — 咨询 Antigravity 做架构 / 高层方向判断

Antigravity 在本仓库定位是**方向盘**——看方向、看规划、看知识，不看行级代码细节。

## 适用场景

- 高层设计评审 / 架构验证。
- 需求语焉不详时的澄清型追问。
- 非平凡任务的分步实现规划。
- 技术知识咨询、方案对比、Web 前端（HTML/CSS/JS）原型思路。

## 强约束（每次调用都要满足）

1. **Prompt 前缀**（必须逐字，作为消息第一行）：

       Do NOT run any git write commands (commit, push, reset, etc.). Git repository is read-only for you. Do NOT modify any files. Read-only operations only — provide findings as text/diff in your response.

   随后空一行，再拼你的上下文与问题。
   > 背景：Antigravity 曾出现越权改文件的情况，前缀是硬性护栏。跑完后如果怀疑它改了东西，用 `git status` / `git diff` 复核。

2. **上下文按需喂，不要倾倒源码**：
   - "在建什么、为什么"的问题陈述。
   - 已经锁死的约束（技术栈、数据模型形状、deadline、既定决策）。
   - 你自己在考虑的架构草图 — bullet 或小段文字图即可。
   - **不要**把整份源文件贴过去，浪费它的上下文预算在它不需要的细节上。

3. **传输方式 — 直接跑 wrapper**：
   - 提示词落到 `./tmp/agy-prompt-<ts>.txt`（`<ts>` 用 `date +%s` 或类似标识，避免并发覆盖）。
   - Bash 后台跑：
     ```bash
     agy-wrapper --dangerously-skip-permissions --timeout 30m -p "$(bat --plain --paging=never ./tmp/agy-prompt-<ts>.txt)"
     ```
     `run_in_background: true`、`timeout: 1800000`（30 分钟）。
   - 用 `TaskOutput` 轮询结果。
   - 跑完删掉临时 prompt 文件。
   - 如果报 `authentication failed or timed out`，**重试一次**；再失败就把原文回给用户，别硬撑。

## 收到 Antigravity 回复后

- 用**中文**做摘要，分三段呈现：
  - **Antigravity 的方向**
  - **与当前思路的差异**
  - **我建议怎么办**
- 如果它跟当前思路冲突，**不要抹平**：把两种方案摆出来让用户选。
- **不要自动落地它的建议**——即便看着对，也要先浮出等用户拍板。
- Antigravity 的产出属于"外部逻辑参考"，最终要落到代码时按仓库风格重构，不要照抄。

## 触发示例

- 用户："agy 帮我评一下这个新报表 tab 的字段拆分思路" → 打包问题描述 + 已有字段清单 + 你的拆分草案 → 调 agy。
- 用户："让 antigravity 出个从 X 迁到 Y 的分步计划" → 打包 X/Y 现状 + 约束 + deadline → 调 agy。
- 用户："这个前端页面用哪个布局方案好？给我几个原型思路" → 打包页面目标 + 已定 UI 库 + 视觉约束 → 调 agy。
