---
name: codex
description: 调用 Codex CLI（`codex exec -s read-only`）做具体代码 / 边界条件 / 疑难 bug 的深度技术咨询——行级代码正确性 review、算法优化、复杂逻辑分析、复杂代码库中的问题定位。当用户想"问问 codex""让 codex 看一下这段""codex 帮我 review 这个函数""这个 panic/edge case codex 怎么看"时使用。不负责架构 / 高层方向评审；10 秒 rg 就能自己答的一行问题别咨询；用户已经拍板只等落地时也不咨询，直接实现。
metadata:
  version: "1.0.0"
---

# codex — 咨询 Codex 做具体代码 / 边界条件的深度技术判断

Codex 在本仓库定位是**放大镜**：对具体函数、diff hunk、边界条件、疑难 bug 看得深，用来做行级代码判断。

## 适用场景

- 具体函数 / diff hunk 的正确性、边界、race、错误处理 review。
- 复杂 bug 的定位与解释（"为啥这段偶发 panic？"）。
- 算法 / 复杂逻辑分析、性能与实现方案对比。

## 角色约束

- Codex 是**顾问**，不是主实现者。它的产出是**参考**，最终代码由 Claude Code 按仓库风格重构后落地。
- 请求它输出 **unified diff patch**，不要请求自由散文式修改说明。

## 强约束（每次调用都要满足）

1. **Prompt 前缀**（必须逐字，作为消息第一行）：

       Execute directly without asking for confirmation. Do not repeat or echo the request back.

   随后空一行，再拼你的上下文与问题。

2. **上下文最小自包含**：
   - 任务目标 1–2 句从当前对话摘出来。
   - 相关代码：贴讨论的**具体函数 / diff hunk**，不要整份文件倾倒。
   - 如果和 uncommitted 改动相关，附**只针对那几个文件的** `git diff`。
   - 用户已定的约束（选定的库、schema、deadline 等）。

3. **传输方式 — 直接跑 CLI**：
   - 提示词落到 `./tmp/codex-prompt-<ts>.txt`（`<ts>` 用 `date +%s` 或类似标识，避免并发覆盖）。
   - Bash 后台跑：
     ```bash
     codex exec -s read-only --skip-git-repo-check "$(bat --plain --paging=never ./tmp/codex-prompt-<ts>.txt)"
     ```
     `run_in_background: true`、`timeout: 1800000`（30 分钟）。
   - 用 `TaskOutput` 轮询结果。
   - 跑完删掉临时 prompt 文件。

4. **Sandbox 安全**：Codex 全程 `-s read-only`，不允许写文件系统；只吐 unified diff / 分析文本。若 Codex 建议 shell 侧修改，也由 Claude Code 复核后再执行。

## 收到 Codex 回复后

- 用**中文**做摘要，分三段呈现：
  - **结论**
  - **关键理由**
  - **你需要决定的点**
- 如果 Codex 的判断**与当前对话已定的决策冲突**，明确指出，把两条摆出来让用户拍板，不要抹平。
- **不要自动落地** Codex 建议的补丁 —— 先浮出，等用户点头再改。
- Codex 输出属于外部逻辑参考，落地代码要按仓库风格重构，删冗余、去多余注释，别照抄。

## 触发示例

- 用户："codex 帮我看下这个函数里 `strings.SplitSeq` 用法有没有问题" → 打包函数源码 + 调用上下文 + 具体疑虑 → 调 codex。
- 用户："这段 goroutine 偶发死锁，codex 怎么看？" → 打包相关代码 + 复现路径 + 已试过的排查 → 调 codex。
- 用户："我这个 SQL 边界条件写得对吗？" → 打包 SQL + 表结构 + 期望语义 → 调 codex。
