---
name: jira-issue-resolver
description: JIRA issue 端到端解决工作流。触发形如 "resolve JIRA XXXX-nn"、"解决 XXXX-nn"、"处理 XXXX-nn"、贴 jira.ismisv.com/browse/ URL 等意图。串起 DAG 定根 → 出方案 → /review-plan → 附方案 → 写码+测试 → /review → /commit → 回写 JIRA 的完整闭环，一次运行只处理一个 issue。用户故事无子任务时先拆再落地第一个子任务；父任务子任务全完成时走收尾捷径。
metadata:
  version: "1.1.0"
---

# jira-issue-resolver

指导 agent 按固定流程解决一个 JIRA issue：从解析 issue key 到最终把 commit id 回写 JIRA。**每一阶段都有硬门槛，不通过不进入下一阶段**。

## 触发场景

- "resolve JIRA issue SHELFECOMM-14"
- "解决 https://jira.ismisv.com/browse/SHELFECOMM-14"
- "处理 SHELFECOMM-14"、"帮我把 XXXX-nn 修了"
- 用户贴出 `https://jira.ismisv.com/browse/<KEY>-<N>` 明确要求处理

只有解析出 issue key（形如 `PROJECT-123`）时才启动本流程。用户只是问 "看下 XXXX-nn 讲什么"、"这单谁负责" 之类的只读查询，直接调 `/jira` skill 单点查询即可，**不要**进入本工作流。

## 关键不变量（违反则停手）

1. **一次运行只处理一个 issue**：沿 blocks/depends on/subtask 找到最上游的根节点，就它。找到根后不再回头处理其它节点，也不合并处理。若根 issue 是"用户故事"且没有已存在的子任务/关联任务，则本次运行在方案 approved 后先把它拆成多个子任务写回 JIRA，然后**只落地其中第一个子任务**（跑完 code+test+review+commit+JIRA 回写）就结束；剩余子任务和用户故事本身的收尾都留给用户下一次触发本 skill 时处理。
2. **plan 未 approve 不写代码**：无论 plan 来自 plan mode 还是普通对话，`/multi-agent-review-plan` 未收到 "approved" 之前不允许 Edit/Write 业务代码。
3. **代码改动必须配套测试**：功能代码写完必须新增或修改对应测试；只改产品代码不改测试直接判定阶段未完成。
4. **`/multi-agent-review-code` 不收敛不 commit**：`/multi-agent-review-code` 循环里只要 reviewer 还在提新问题就继续修，直到一轮回来没有新问题。旧问题回归也算新问题。
5. **JIRA 回写用 git commit 真值**：commit id 从 `git log -1 --format=%H` 取，不要凭印象或复用之前的哈希。
6. **plan 文件必须附到 JIRA**：不是贴正文，而是作为附件（attachment）上传，走 `/jira` skill 的附件接口。

## 步骤

### 1. 解析 issue key，抓详情

从用户输入抽出 issue key。URL 形式取 `/browse/` 之后那一段。

调用 `/jira` skill：
- 拉 issue 详情（summary / description / status / issue type / assignee / issuelinks / subtasks）。
- 特别关注：`issuelinks`（blocks / is blocked by / relates to / depends on）、`subtasks`、`parent`。

如果 issue 已经处于 Closed / Resolved / Done，直接告诉用户已关闭并给状态和最近的 comment 摘要，**不要**再往下走。

### 2. 沿 DAG 找根，锁定要处理的那个

构建有向依赖：
- 若本 issue 有 `is blocked by` / `depends on` 指向的其它 issue —— 那些是"上游"。
- 若本 issue 是某 parent 的 subtask，parent 不算上游（parent 通常是 tracker，不是 blocker）；但如果 parent 明确要求先做别的 subtask，参照 subtask 顺序。
- `relates to` 不算强依赖，**不**进入 DAG。

递归：对每个上游 issue 也拉一遍详情，看它是否又被别的 issue 阻塞。**只走 open / in-progress 状态的节点**——已 Resolved/Closed 的上游视作已满足，跳过。

在剩下的 open 节点里找**入度为 0**（没有仍在 open 的上游）的节点。若有多个，取用户请求的那条链上的那一个（离用户给的 key 最近的根）。**这就是本次要处理的 issue**，记为 `TARGET`。

告诉用户："你给的 X 依赖 Y（Y 又依赖 Z，Z 是 open 状态的根）→ 本次只处理 Z，完成后本 skill 结束；X 需要下一轮再启动。"如果 `TARGET` 就是用户输入的 key，也明确说 "无未完成上游，直接处理它"。

### 2.5 父任务收尾捷径（若适用则短路后续步骤）

**触发条件（全部满足才执行）**：
- `TARGET` 是父类型 issue（用户故事 / Story，或含子任务的 Task），即它至少有一个 subtask 或至少一条 `is blocked by` / `depends on` 指向别的 issue，且这些下游 issue 都是它的"实现子任务"（不是无关的依赖）。
- 上述所有子任务 / 关联任务的状态都是 Resolved / Closed / Done。
- `TARGET` 自身仍是 open（未 Resolved / Closed / Done）。
- **约定**：父任务不应有独立的工作内容——所有可交付的代码工作都归属子任务。若你发现父任务的 description / 验收标准里还有明显未落地在任何子任务上的功能点，**停手**并告诉用户"父任务似乎还残留独立工作内容 X，需要先补一个子任务再收尾"，让用户决定是补子任务还是把工作明确挂到已有子任务上。

满足时按下列做法收尾（**跳过步骤 3–9，直接进入本节的回写**）：

1. 用 `/jira` skill 汇总所有子任务的 key、状态、以及各自 comment 里记录过的 commit 短哈希（拿不到就再查一遍每个子任务最近一条 comment）。
2. 在 `TARGET` 上加一条 comment：列出所有子任务 key、commit 短哈希、交付说明；一句话结论"所有子任务已完成，父任务收尾"。
3. **切状态**：根据 `TARGET` 当前可用 transition，切到合适的下一状态（通常是 "In Review" 或 "Resolved"，取决于团队流程和父任务的定位）；拿不准就问用户。
4. 直接进入步骤 11 收尾，本次运行结束——**不**触发 plan、code、test、review、commit。

若不满足条件，跳过本节，进入步骤 3。

### 3. 出方案（plan mode 或对话式）

自行判断：
- 变更点清楚、影响范围小 → 直接在对话里写方案。
- 变更点多、需要探索代码 → 进 plan mode（`EnterPlanMode`）。
- 拿不准 → 一句话问用户 "要不要我先出方案再动手？"，用户说不用就跳过评审直接进步骤 6（但一般不建议）。

方案必须包含：
- 目标（对齐 JIRA issue 的验收标准）
- 影响的文件 / 模块清单
- 每步改动的意图
- 测试策略（新增/修改哪些用例，怎么跑）
- 风险与回退

### 4. `/multi-agent-review-plan` 评审循环

**不允许跳过**。写完方案，立刻调 `/multi-agent-review-plan`（该命令会把方案分发给 Codex + AntiGravity 做只读评审）。

- 收集所有 reviewer 反馈。
- 合理的问题 → 修方案 → 再跑 `/multi-agent-review-plan`。
- 直到最新一轮没有新的合理问题（reviewer 明确 approved 或不再提新问题）为止。

**只有 approved 后才能进入步骤 5。**

### 4.5 用户故事拆子任务（仅限特定条件）

**触发条件（全部满足才执行）**：
- `TARGET.issuetype` 是 "用户故事" / "Story"（同义），且
- `TARGET.subtasks` 为空、且没有 `is blocked by` / `depends on` 指向的其它任务（也即步骤 2 已判定它是 open 根、无子任务、无下游任务）。

若不满足，跳过本步，直接进入步骤 5。

满足时按下列做法拆分：

1. 依据 approved plan 中"每步改动的意图"和"影响的文件 / 模块清单"，把工作切成 2~N 个相互独立、可单独交付并跑测试的任务。每个任务应聚焦一个可验证的验收点，粒度过大要再切。
2. 用 `/jira` skill 在 `TARGET` 项目下创建对应数量的子任务（issuetype 通常为 "任务" / "Sub-task"，随项目配置而定，拿不准就问用户），并把每个新任务作为 `TARGET` 的 subtask 或用 `is blocked by` 关联回 `TARGET`。
3. 每个子任务的 summary 写明它交付的功能片段，description 复制 plan 中对应部分（含验收点、影响文件、测试策略）。
4. 记录本次生成的子任务 key 列表 `SUBTASKS = [key1, key2, ...]`，顺序按依赖 / 落地顺序排。
5. 在 `TARGET`（用户故事）上加一条 comment：列出所有 `SUBTASKS`，说明"按顺序逐个执行，每次运行处理一个；本次先落地 `SUBTASKS[0]`，其余请下次触发本 skill 再逐个处理"。

**重新锁定 TARGET**：拆分完成后，把 `TARGET` **改指为 `SUBTASKS[0]`**（第一个子任务）。步骤 5 之后的所有 "TARGET" 引用（附件、代码、测试、review、commit、回写）都作用在这一个子任务上。整体 approved plan 中对应 `SUBTASKS[0]` 的那一段就是它的方案，无需再跑一遍 `/multi-agent-review-plan`。

用户故事本身不在本次运行内做状态回写；下一次运行处理 `SUBTASKS[1]` 时，用户故事仍处于"拆分完待逐个消化"的状态即可。所有子任务都落完之后，用户再次触发本 skill 传用户故事的 key，步骤 2 的 DAG 会判定它无 open 上游、步骤 2.5 会检测到它是"所有子任务已完成的父任务" → 走**父任务收尾捷径**关闭它，不再走代码流程。

### 5. 把 approved 方案作为附件贴到 JIRA

- 将最终方案写入 `${project_root_dir}/tmp/jira-plan-<TARGET>.md`（`TARGET` 是当前锁定的 issue：非拆分场景是原始根 issue；拆分场景是 `SUBTASKS[0]`）。
- 通过 `/jira` skill 把该文件作为**附件**（attachment）上传到 `TARGET` issue。
- 顺带在 issue 加一条 comment，简述 "已附最终方案，进入实现"，方便相关人追踪。
- 拆分场景下，同时把完整方案文件作为附件上传到**用户故事本身**一份（子任务这份是子集，用户故事持有全量方便日后串联）。

### 6. 写业务代码

按当前 `TARGET` 对应的方案段落落地代码。遵守 CLAUDE.md 六条规则（尤其 Rule 2 最小变更、Rule 3 先读后写）。

**若走了步骤 4.5 拆分**：当前 `TARGET = SUBTASKS[0]`，代码改动只覆盖它的验收范围；不要提前动其他子任务的文件/模块，也不要把"顺手一起改了"塞进本次 commit——那会让 JIRA 每个子任务对应一个 commit 的追溯关系失效。

### 7. 写/改测试（硬门槛）

- 新功能 → 新增测试用例覆盖 golden path + 至少一个边界。
- Bug 修复 → 新增一个能复现 bug 的测试（先跑失败、修完跑通）。
- 修改现有行为 → 更新受影响的测试断言，且断言要绑定"为什么"（业务规则），不是绑定当前返回值（对齐 CLAUDE.md Rule 5）。
- 跑测试确认全绿；有 skip 的必须解释原因，不允许静默 skip。

### 8. `/multi-agent-review-code` Multi-agent ship-readiness loop

**不允许跳过**。调 `/multi-agent-review-code`（多 reviewer 复审当前变更）。

- 每一轮收集 reviewer 提出的问题。
- 只要还有新问题（哪怕上一轮修复引入的回归）→ 修 → 再跑 `/multi-agent-review-code`。
- 直到一整轮 reviewer 都没再提新问题为止。
- 期间可以适度用 `/audit` / `/codex` / `/agy` 做定向咨询。

### 9. `/commit`

`/multi-agent-review-code` 收敛后，调 `/commit` skill 提交本地修改。commit message 里体现 JIRA key（如 `(TARGET-KEY)`）便于追踪。

提交后拿 commit id：

```bash
git log -1 --format=%H
```

记录短哈希（前 12 位）和完整哈希备用。

### 10. 回写 JIRA：状态 + 变更说明 + commit id

用 `/jira` skill，作用在当轮的 `TARGET`（走拆分时即 `SUBTASKS[0]`；否则即原始根 issue）：

1. **加 comment**：包含
   - 本次改动摘要（做了什么、影响哪些文件/模块）
   - 测试情况（新增/修改的测试，运行结果）
   - git commit id（完整哈希 + 短哈希）
   - 分支名（`git rev-parse --abbrev-ref HEAD`）
2. **切状态**：根据 issue 当前状态和可用 transition，切到合适的下一状态（通常是 "In Review" 或 "Resolved"，取决于团队流程）。先用 `/jira` 列可用 transition，再挑最贴合"代码已完成、待验收"语义的那个；拿不准就问用户。

用户故事本身**不**在本次运行内做状态回写。

### 11. 收尾

告诉用户：
- 处理的是 `TARGET`（若和用户输入 key 不同，重申一次）。
- commit id、JIRA 新状态（若走了步骤 2.5 父任务收尾捷径，则说明"无代码变更，仅收尾状态从 X 切到 Y"）。
- 拆分场景：额外告诉用户"用户故事 <key> 已拆成 `SUBTASKS = [...]`，本次落地 `SUBTASKS[0]`，下一次触发本 skill 会自动挑到 `SUBTASKS[1]`（步骤 2 的 DAG 判定）；所有子任务落完后再触发一次本 skill 传用户故事 key，即会走步骤 2.5 关闭用户故事"。
- 走步骤 2.5 收尾捷径场景：明确告诉用户"父任务 <key> 已根据所有子任务的完成情况收尾，本次未产生代码变更/commit"。
- 若还有下游未处理的 issue（步骤 2 里绕过的那些），提示用户 "如需继续，请再次触发本 skill 处理 <下一个 key>"。

**本 skill 到此结束，不自动进入下一个（未处理的）根 issue 或下一个子任务。**

## 反模式（别犯）

- ❌ 拿到 issue 就直接开写——没先看 DAG，可能修完发现是上游 issue 修完就顺带解决了。
- ❌ plan 写完不评审直接干——`/multi-agent-review-plan` 是硬门槛，很多设计问题在此拦截，成本最低。
- ❌ 方案贴在 JIRA comment 里而不是附件——正文过长影响追溯；用附件。
- ❌ 只改产品代码不改测试——测试通过 ≠ 功能对，且下次回归无护栏。
- ❌ `/multi-agent-review-code` 提了问题挑轻的修、跳过重的——reviewer 提的每个新问题都要么修、要么用一句话解释为什么不修（并让下一轮 reviewer 认可）。
- ❌ commit id 靠脑补或复用旧的——必须现取 `git log -1 --format=%H`。
- ❌ 一次处理多个 issue、连着刷 DAG——本 skill 一次一个根节点，处理完就停。
- ❌ 已 Closed 的 issue 还继续走流程——步骤 1 里就该止损。
- ❌ 用户故事没子任务也不拆，plan approve 后直接一把梭写 500 行——违反步骤 4.5；粒度过大 review 和回归风险都无法收敛。
- ❌ 拆完子任务后一次运行连着落地 `SUBTASKS[0]`、`SUBTASKS[1]`……——违反"一次运行只处理一个"不变量；每次运行只落地一个子任务，剩余的等下次触发。
- ❌ 拆完子任务后本次运行就顺手把用户故事状态切成 Resolved——用户故事的状态回写留给"所有子任务都完成后再触发一次本 skill、走步骤 2.5 父任务收尾捷径"的那次运行，本次不动它。
- ❌ 用户传的是全部子任务已完成的父任务，还照常跑 plan→code→review 流程——违反步骤 2.5；父任务不应有独立工作内容，此时只做汇总回写和状态切换。
- ❌ 步骤 2.5 检测到父任务确有未落地的独立工作内容还硬走捷径关掉——错误关闭会让实际未做完的功能被淹没。应停手、告诉用户"父任务残留 X 未落地"，让用户先补子任务。
- ❌ 一次 commit 打包多个子任务——JIRA 每条子任务都需要独立的 commit id 做追溯，混在一起后期无法拆开。
- ❌ 已有子任务/关联任务的用户故事再触发步骤 4.5 拆分——步骤 4.5 只针对"无子任务且无下游"的孤儿用户故事；已有子任务的场景走步骤 2 的 DAG 逻辑，改处理其中一个 open 子任务。
