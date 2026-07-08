# codex skills

Codex CLI 的 skill 集合，每个子目录是一个可被 codex 识别的 skill（`SKILL.md` + 可选 `scripts/` / `references/` / `agents/`）。触发场景写在 `SKILL.md` frontmatter 的 `description` 里，codex 按用户意图自动装载。

## Skills

| Skill | 用途 |
|-------|------|
| [agy](agy/SKILL.md) | 调用 Antigravity CLI 做高层方案 / 架构 / 方向评审 |
| [codex](codex/SKILL.md) | 调用 Codex CLI 做行级代码 / 边界条件 / 疑难 bug 咨询 |
| [audit](audit/SKILL.md) | 用 Codex 对 pending diff 做单次结构化 review |
| [multi-agent-review-plan](multi-agent-review-plan/SKILL.md) | 动手前用 Codex + Antigravity 双评审执行计划 |
| [multi-agent-review-code](multi-agent-review-code/SKILL.md) | 发版前对 pending diff 跑双评审 ship-readiness 闭环 |
| [commit](commit/SKILL.md) | 按仓库约定完成一次本地 git 提交 |
| [jira](jira/SKILL.md) | 通过 REST API v2 读写 jira.ismisv.com issue |
| [jira-issue-resolver](jira-issue-resolver/SKILL.md) | JIRA issue 端到端解决工作流（DAG → 方案 → 落地 → 回写） |
| [notebooklm](notebooklm/SKILL.md) | Google NotebookLM 自动化：播客 / 报告 / 幻灯片 / 深研 |
| [pkg-go-dev](pkg-go-dev/SKILL.md) | 查询 pkg.go.dev v1beta REST API 拿 Go 包文档 / 版本 / CVE |
| [cctv-h5e-download](cctv-h5e-download/SKILL.md) | 下载并解密 CCTV/CNTV H5e HLS 加密流为本地 MP4 |
| [codex-primary-runtime](codex-primary-runtime/) | Codex 作为 primary runtime 的占位配置 |

## 结构约定

```
<skill-name>/
├── SKILL.md          # frontmatter: name / description / metadata
├── scripts/          # 可选：skill 依赖的脚本
├── references/       # 可选：静态参考资料
└── agents/           # 可选：子 agent 定义
```
