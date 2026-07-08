---
name: commit
description: 把当前仓库的本地改动提交到 git，用英文写规范 commit message，遵守本仓库约定（不加 co-author、message 走 `./tmp/commit_message.txt` 落盘 + `git commit -F`、GPG 失败停手交给用户）。当用户说"commit""提交""帮我提交这些改动""commit 一下"时使用。只做单次提交，不做 push、不做 pre-commit fix。
metadata:
  version: "1.0.0"
---

# commit — 按仓库约定完成一次本地 git 提交

单次提交流程，只负责把 staged / working tree 的改动写成一次符合仓库风格的 commit。**不 push、不 amend、不 force、不 rebase**。

## 前置约束

- 只在用户**明确要求提交**时才执行本 skill；否则不要主动 commit。
- 所有 git 操作都在**仓库根目录**跑。开始前如果 cwd 不是根目录，先切过去。
- **commit message 用英文**。
- **不加 co-author** 行（本仓库约定）。
- 不使用 heredoc 写 message，也不用 `-m`；一律走 `./tmp/commit_message.txt` + `git commit -F`。
- **不要跳过 hook / 签名**（不加 `--no-verify` / `--no-gpg-sign`），除非用户明确要求。

## Step 1 — 先看仓库状态

并行跑：
- `git status`（不加 `-uall`，避免大仓库爆内存）
- `git diff`（工作区未 staged 的改动）
- `git diff --cached`（已 staged 的改动）
- `git log -n 10 --oneline`（对齐本仓库 commit message 风格）

看清楚这次要提交的**具体范围**和**风格模板**再往下走。

## Step 2 — 起草 commit message

- 分析 staged + 将要 add 的改动，判断变更性质（feat / fix / refactor / test / docs / build / chore / ...），沿用本仓库现有 commit 风格（看 `git log` 的实际格式，例如 `type(scope): subject`）。
- 主题行简明，聚焦"**为什么**"而不是"**做了什么**"，1–2 句为宜。
- 涉及可能含密钥的文件（`.env`、`credentials.json` 等）**不要**提交；如果用户点名要提交，先警告他。
- 优先按文件名把要提交的东西 `git add` 进来，避免 `git add -A` / `git add .` 把敏感文件或大 binary 一起卷入。

## Step 3 — 落盘 message 并提交

1. 如果 `./tmp/commit_message.txt` 已存在，先删掉。
2. 用 **Write 工具**（**不是** heredoc / `echo`）把 message 写到 `./tmp/commit_message.txt`。
3. 执行：
   ```bash
   git commit -F ./tmp/commit_message.txt
   ```
4. 跑 `git status` 确认提交成功。

## Step 4 — 结果处理

- **GPG 签名失败**：**停手**，告诉用户失败原因，请他手动 commit。不要尝试 `--no-gpg-sign` 绕过。
- **pre-commit hook 失败**：commit 没发生。修复 hook 报的问题后**创建新 commit**（不要 `--amend` 上一个 commit——那会误改历史）。
- **成功**：向用户报出新 commit 的 hash 与 subject 一行确认，不要长篇总结（改动内容用户能自己看 diff）。
- 无论成功失败，**不做 push**。
