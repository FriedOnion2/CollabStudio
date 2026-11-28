export const workflows = {
  antigravityKickoff: {
    zh: `使用 dual-agent-collab 技能处理项目「{0}」{1}。
当前处于【阶段 1：立项与总体设计】。请先阅读 GEMINI.md，与我确认目标、V1 非目标与技术栈，完善 docs/01-brief.md，并同步 AGENTS.md / CLAUDE.md / GEMINI.md。未核实代码事实时须标注「推测」。`,
    en: `Use the dual-agent-collab skill for “{0}”{1}.
Stage 1: Project kickoff and architecture. Read GEMINI.md, confirm the goals, V1 non-goals and stack with me, update docs/01-brief.md, and sync AGENTS.md, CLAUDE.md and GEMINI.md. Mark unverified code claims as assumptions.`
  },
  antigravityDraft: {
    zh: `【Antigravity / Gemini · 独立盲写方案（Blind Draft）】
项目：「{0}」{1}。请先阅读 GEMINI.md。
⚠️ 请仅依据我的原始需求与客观背景，独立输出一份架构与产品方案（不迎合、不参考他方草稿），重点给出差异化思路、风险点与非目标清单；未核实代码之处明确标出「推测」。`,
    en: `Antigravity / Gemini | Independent draft
Project “{0}”{1}. Read GEMINI.md.
Draft an architecture and product proposal using only my original requirements and verified background. Set aside the other draft. Highlight distinct ideas, risks and non-goals, and label unverified code claims as assumptions.`
  },
  antigravityCopy: {
    zh: `【Antigravity / Gemini · 界面文案与交互顾问（去机械味）】
项目：「{0}」{1}。请阅读 docs/02-frontend-spec.md 及当前页面文案。
请以真实使用者的视角重写界面文案与交互提示：1) 这页给谁用、要让人做成什么；2) 删掉冗长的 AI 解释性废话与技术黑话；3) 给出「原文 → 改后 → 理由」对照表，供 Claude/Codex 核实采纳。`,
    en: `Antigravity / Gemini | UI copy and interaction review
Project “{0}”{1}. Read docs/02-frontend-spec.md and the current UI copy.
Identify the audience and its goal, then revise the copy and interaction hints to remove over-explanation and jargon. Provide a before/after/rationale table for Claude and Codex to review.`
  },
  antigravityFrontend: {
    zh: `继续项目「{0}」{1}，进入【阶段 2：前端设计与契约草案】。
请编写 docs/02-frontend-spec.md（Design Tokens、组件与正常/Loading/空态/报错态），起草 docs/03-api-contract.md，并在 docs/04-tasks.md 按垂直切片拆分 Milestone（第一个切片须含类型检查与测试基线）。`,
    en: `Continue “{0}”{1} in stage 2: frontend design and draft API contract.
Write docs/02-frontend-spec.md with design tokens, components, and normal, loading, empty and error states. Draft docs/03-api-contract.md and split docs/04-tasks.md into vertical milestones. Include type checks and a test baseline in the first slice.`
  },
  antigravityContract: {
    zh: `项目「{0}」{1}已完成阶段 3 后端细化。
请核实 docs/03b-backend-design.md 与 docs/03-api-contract.md 的修订意见；无冲突则将契约标为 FROZEN 并更新 .collab-state.json。`,
    en: `The backend design for “{0}”{1} is ready.
Review feedback in docs/03b-backend-design.md and docs/03-api-contract.md. If there are no conflicts, mark the contract FROZEN and update .collab-state.json.`
  },
  antigravityReview: {
    zh: `项目「{0}」{1}进入【阶段 5：设计与文案验收】。
请按用户真实路径对照 docs/02-frontend-spec.md 核验视觉还原度、交互状态与界面文案可读性；偏差只写入 docs/05-review-log.md（页面/组件/现状/期望），不直接抢改业务源码。`,
    en: `“{0}”{1} has reached stage 5: design and copy acceptance.
Follow actual user flows and check visual fidelity, interaction states and readability against docs/02-frontend-spec.md. Record deviations in docs/05-review-log.md with the page, component, current behavior and expected behavior. Leave application code untouched in this review.`
  },
  codexBackend: {
    zh: `【Codex | 项目：{0} | 阶段 3：后端细化与契约评审】
工作范围{1}。
请先阅读 AGENTS.md、docs/01-brief.md、docs/02-frontend-spec.md、docs/03-api-contract.md。
⚠️ 本轮禁止写业务代码，仅完成：
1. 编写后端详细设计到 docs/03b-backend-design.md（数据模型、独立模块边界、并发与错误处理）。
2. 审校 docs/03-api-contract.md 是否存在字段缺失、类型歧义或不可落地项。汇报请简短、先给结论。`,
    en: `Codex | “{0}” | Stage 3: Backend design and contract review
Scope{1}.
Read AGENTS.md, docs/01-brief.md, docs/02-frontend-spec.md and docs/03-api-contract.md.
Leave application code untouched this round. Write the data model, module boundaries, concurrency and error handling in docs/03b-backend-design.md. Review the API contract for missing fields, ambiguous types and impractical requirements. Lead with the outcome.`
  },
  codexImplementation: {
    zh: `【Codex | 项目：{0} | 阶段 4：硬核后端 / 切片编码 — {1}】
工作范围{2}。
契约已冻结。请严格遵守 AGENTS.md、02-frontend-spec.md、03-api-contract.md 与 03b-backend-design.md，独立完成 docs/04-tasks.md 中的「{3}」。
要求：接口与前端状态 100% 对齐，补齐自动化测试与构建验证，勾选 04-tasks.md，汇报只写结论、改动文件与验证结果。Web 前端构建须使用相对资源路径（如 Vite base: './'）以兼容子路径预览；禁止用简单几何体或空壳占位伪造完成验收。`,
    en: `Codex | “{0}” | Stage 4: Implement slice “{1}”
Scope{2}.
The contract is frozen. Follow AGENTS.md and docs/02-frontend-spec.md, docs/03-api-contract.md and docs/03b-backend-design.md. Implement “{3}” from docs/04-tasks.md. Verify that API behavior and UI states match, add automated tests, run the build and update the task list. Report the outcome, changed files and verification. Use relative asset paths for web builds (e.g. Vite base: './') so subpath previews work, and do not pass off stub or placeholder assets as completed deliverables.`
  },
  codexReview: {
    zh: `【Codex | 项目：{0} | 阶段 5：分级工程审查（最多 2 轮防死循环）】
工作范围{1}。
请先阅读 AGENTS.md 与 docs/01~04，对当前改动执行严格分级审查并写入 docs/05-review-log.md：
- **Blocker（阻塞级）**：仅限会算错钱、丢数据、越权、发错消息、引发发布事故的问题，且必须写出具体复现路径。
- **Suggestion（建议级）**：极端边界与优化建议，仅记录不挡上线。
默认使用高性价比审查深度，仅在涉及资金/鉴权/对外发送/关键写库文件时深挖；最多审 2 轮。`,
    en: `Codex | “{0}” | Stage 5: Tiered code review (up to two rounds)
Scope{1}.
Read AGENTS.md and docs/01–04, then record findings in docs/05-review-log.md.
- **Blocker**: incorrect monetary calculations, data loss, unauthorized access, misdirected messages or release incidents. Include concrete reproduction steps.
- **Suggestion**: edge cases and optimizations. Record these without blocking the release.
Prioritize money, authorization, outbound messages and critical persistence. Stop after two rounds.`
  },
  codexRegression: {
    zh: `【Codex | 项目：{0} | 错一次 → 硬检查（Mistake → Guardrail）】
工作范围{1}。
请阅读 docs/05-review-log.md 中刚被退回或人类纠正的问题：
1. 在同一修复提交里永久拦住这一类错误：优先写成类型检查或守卫测试（报错信息写清怎么改），其次改接口/目录让错代码写不出来；实在做不到再写文字规则并说明原因。
2. 已有违规记入 05-review-log.md 欠账表（只减不增），新代码零容忍。`,
    en: `Codex | “{0}” | Turn mistakes into checks
Scope{1}.
Read the rejected or corrected items in docs/05-review-log.md.
1. In the fix commit, prevent the class of error with a type check, regression test or interface change. Make test failures actionable. Document a rule only if the check cannot be enforced, and explain why.
2. Track existing violations in the review log and prevent new ones.`
  },
  claudeMerge: {
    zh: `【Claude | 项目：{0} | 阶段 1：双方案核实与合并】
工作范围{1}。
请先阅读 CLAUDE.md 与 docs/01-brief.md，把你自己的方案与 Gemini (Antigravity) 独立盲写方案放在一起核实：
1. 对照源码与客观事实核验 Gemini 标「推测」的部分。
2. 合并成一份最终方案写入 docs/01-brief.md，清晰列出：两份一致的 / 采纳 Gemini 的 / 不采纳及理由 / 需人类拍板的分歧点。`,
    en: `Claude | “{0}” | Stage 1: Verify and merge proposals
Scope{1}.
Read CLAUDE.md and docs/01-brief.md. Compare your proposal with Gemini’s independent draft. Verify Gemini’s assumptions against source and observable facts, then write the merged plan in docs/01-brief.md. Include agreements, adopted ideas, rejected ideas with reasons, and decisions for the user.`
  },
  claudeFrontend: {
    zh: `【Claude | 项目：{0} | 阶段 2：高审美前端视觉、动效与初版交互】
工作范围{1}。
请先阅读 CLAUDE.md、docs/01-brief.md 与 docs/02-frontend-spec.md，实现高完成度的前端视觉、动效与交互原型/页面。
动手前列全深浅色、移动端与空态/加载/报错态，全部改齐并实测；界面文案完成后提示我交给 Gemini 做「去机械味」润色。`,
    en: `Claude | “{0}” | Stage 2: Frontend visuals, motion and interaction
Scope{1}.
Read CLAUDE.md, docs/01-brief.md and docs/02-frontend-spec.md. Implement the frontend visuals, motion and interactions. Before editing, list light/dark themes, mobile layouts, and empty, loading and error states. Address and test them together. When UI copy is ready, flag it for Gemini’s copy review.`
  },
  claudeImplementation: {
    zh: `【Claude | 项目：{0} | 阶段 4：切片实现 / 改全与核实 — {1}】
工作范围{2}。
请阅读 CLAUDE.md、02-frontend-spec.md、03-api-contract.md 与 03b-backend-design.md，完成「{3}」（小改动与前端联调直接自己做，独立成块的重后端可派给 Codex）。
⚠️ 严格执行「改全与核实」：列全代码/文案/文档/测试同类位置一次改齐，按用户路径跑通验证后再勾选 04-tasks.md。Web 前端构建须使用相对资源路径（如 Vite base: './'）以兼容子路径预览；禁止用简单几何体或空壳占位伪造完成验收。`,
    en: `Claude | “{0}” | Stage 4: Implement and verify “{1}”
Scope{2}.
Read CLAUDE.md, docs/02-frontend-spec.md, docs/03-api-contract.md and docs/03b-backend-design.md. Implement “{3}”. Handle small changes and frontend integration directly. A self-contained backend task can go to Codex. Check all related code, copy, docs and tests, then verify actual user flows before checking off docs/04-tasks.md. Use relative asset paths for web builds (e.g. Vite base: './') so subpath previews work, and do not pass off stub or placeholder assets as completed deliverables.`
  },
  claudeReview: {
    zh: `【Claude | 项目：{0} | 阶段 5：独立复审 & 错一次变硬检查】
工作范围{1}。
请以独立架构师视角复核当前实现与 docs/05-review-log.md，重点排查漏改细节、状态不同步与体验断层；将结论写入「Claude 架构与独立复审」，并对被纠正的问题补齐类型/守卫测试永久防复发。`,
    en: `Claude | “{0}” | Stage 5: Independent review and regression checks
Scope{1}.
Review the implementation and docs/05-review-log.md as an independent architect. Look for incomplete changes, mismatched state and gaps in user flows. Record findings under “Claude architecture and independent review” and add type checks or regression tests for corrected issues.`
  },
  askFirst: {
    zh: `## 先问清单（以下动作必须先请示人类，其余直接推进）
- 删数据、停服、额外花钱、对外发消息（公开评论/通知他人）、改产品方向、新建或轮换密钥、修改权限。
- 错一次就变硬检查：每次人类纠正或审查退回，须在同一提交里用类型检查/守卫测试或结构调整永久拦住同类问题；实在做不到再写文字规则并说明原因。`,
    en: `## Ask the user before proceeding
- Ask before deleting data, stopping services, spending money, sending messages externally, changing product direction, creating or rotating secrets, or changing permissions. Proceed with other work.
- Turn corrections and review rejections into type checks, regression tests or structural changes in the fix commit. If enforcement is impractical, document the rule and explain why.`
  },
  codexRules: {
    zh: `# AGENTS.md — Codex (GPT) 协作铁律

> 定位：最严谨的硬核执行者与最终代码审查官（后端、算法、数据处理、查修 Bug、分级 Code Review）。

## 1. 必读顺序
1. \`docs/01-brief.md\` → \`02-frontend-spec.md\` → \`03-api-contract.md\` → \`03b-backend-design.md\` → \`04-tasks.md\` → \`05-review-log.md\`

## 2. 边界与交付
- 契约冻结前不写业务代码；冻结后禁止静默改动接口路径、字段名或返回结构。
- 只承接边界清晰的后端/切片任务；前端改动严格遵循 \`02-frontend-spec.md\` 与全部状态（正常/Loading/空态/报错/禁用）。
- 汇报先给结论、改动文件与验证结果，面向人类可读，不堆无结构日志。

## 3. 分级代码审查铁律（防死循环）
- **阻塞级（Blocker）**：仅限会算错钱、丢数据、越权、发错消息、引发发布事故的问题，且必须给出具体复现路径。
- **建议级（Suggestion）**：极端边界与优化建议，写入 \`docs/05-review-log.md\` 即可，不挡上线。
- **最多审 2 轮**：第 2 轮仍未收敛则停下交由人类拍板。

{0}
`,
    en: `# AGENTS.md — Codex (GPT) collaboration rules

> Role: Backend, algorithms, data processing, debugging and final tiered code review.

## 1. Reading order
1. \`docs/01-brief.md\` → \`02-frontend-spec.md\` → \`03-api-contract.md\` → \`03b-backend-design.md\` → \`04-tasks.md\` → \`05-review-log.md\`

## 2. Scope and delivery
- Begin application implementation after the contract freezes. Once frozen, raise changes to routes, field names or response structures before making them.
- Take clearly scoped backend or slice tasks. For frontend changes, follow \`02-frontend-spec.md\` and cover normal, loading, empty, error and disabled states.
- Lead reports with the outcome, changed files and verification.

## 3. Tiered code review
- **Blocker**: Incorrect monetary calculations, data loss, unauthorized access, misdirected messages or release incidents. Include concrete reproduction steps.
- **Suggestion**: Record edge cases and optimizations in \`docs/05-review-log.md\`.
- **Two rounds at most**. Ask the user to decide unresolved issues after round two.

{0}
`
  },
  claudeRules: {
    zh: `# CLAUDE.md — Claude 协作铁律

> 定位：高审美前端/动效专家、主控编排与独立深度复审（视觉、动效、系统拆分、双方案合并、复杂模块攻坚）。

## 1. 必读顺序
1. \`docs/01-brief.md\` → \`02-frontend-spec.md\` → \`03-api-contract.md\` → \`03b-backend-design.md\` → \`04-tasks.md\` → \`05-review-log.md\`

## 2. 改全与核实（防漏改、防没验证就报完成）
- 动手前列全同类位置（代码、文案、文档、测试、配置、深浅色与移动端），一次改齐。
- 交付前按用户真实路径走一遍并核实实际返回/页面效果；发现一处遗漏则顺手清查全部同类。
- 大架构方案与 Gemini (Antigravity) 各自盲写独立方案后，核实事实再合并（标明一致、采纳、拒绝理由与待拍板项）。
- 界面文案与交互初版完成后，交给 Gemini 润色「说人话」再核实采纳。

## 3. 派活边界
- 几十行小改、修审查项、与页面高频联调的接口自己顺手做；接口已定死的独立成块后端/算法再派给 Codex。

{0}
`,
    en: `# CLAUDE.md — Claude collaboration rules

> Role: Frontend visuals and motion, orchestration, proposal merging and independent review.

## 1. Reading order
1. \`docs/01-brief.md\` → \`02-frontend-spec.md\` → \`03-api-contract.md\` → \`03b-backend-design.md\` → \`04-tasks.md\` → \`05-review-log.md\`

## 2. Implement and verify
- List affected code, copy, docs, tests, settings, themes and mobile layouts. Update them together.
- Verify the actual response or page along real user flows. When you find an omission, check neighboring cases.
- Draft major proposals independently from Gemini. Verify facts before merging, and record agreements, decisions and reasons.
- Ask Gemini to review initial UI copy and interaction hints, then verify changes before adopting them.

## 3. Delegation
- Handle small fixes and tightly coupled frontend work directly. Codex can take self-contained backend work with a stable interface.

{0}
`
  },
  geminiRules: {
    zh: `# GEMINI.md — Antigravity (Gemini) 协作铁律

> 定位：高情商军师、总体架构设计师、前端体验与产品文案顾问（立项规划、独立第二方案、前端规范、文案/交互润色、设计验收）。

## 1. 必读顺序
1. \`docs/01-brief.md\` → \`02-frontend-spec.md\` → \`03-api-contract.md\` → \`04-tasks.md\` → \`05-review-log.md\`

## 2. 防幻觉与防越界
- 分析现有代码或线上事实时，必须先读源码/查输出再下结论；未核实的推断一律显式标注「推测」，绝不编造。
- 做「独立盲写方案」时只依据人类原话与客观背景，提出差异化视角。
- 做「文案与交互顾问」时：去掉冗长解释性说明文与技术黑话，站在真实使用者角度写短、准、自然的界面文字。
- 阶段 5 设计验收发现偏差时，只写结构化返工单（页面/组件/现状/期望）到 \`docs/05-review-log.md\`，不与 Codex/Claude 抢改业务源码。

{0}
`,
    en: `# GEMINI.md — Antigravity (Gemini) collaboration rules

> Role: Project planning, independent proposals, frontend UX, product copy and design acceptance.

## 1. Reading order
1. \`docs/01-brief.md\` → \`02-frontend-spec.md\` → \`03-api-contract.md\` → \`04-tasks.md\` → \`05-review-log.md\`

## 2. Evidence and scope
- Check source or observable output before making claims. Label unverified conclusions as assumptions.
- Draft independent proposals using the user’s original requirements and verified background.
- Write concise, natural UI copy based on what the user needs to do.
- In stage 5, record design deviations in \`docs/05-review-log.md\` with the page, component, current behavior and expected behavior. Leave application code untouched in this review.

{0}
`
  },
  brief: {
    zh: `# {0} — 总体架构与立项方案

> 创建日期：{1}{2} | 支持 Antigravity + Claude 独立双方案合并

## 1. 原始需求与核心目标
- 痛点与主路径：

## 2. V1 范围与明确非目标（Non-Goals）
- **V1 必做**：
- **V1 不做**：

## 3. 技术栈与模块边界
- 前端 / 后端 / 存储：

## 4. 双方案合并记录（如有）
- 一致项 / 采纳项 / 拒绝与理由 / 待拍板项：
`,
    en: `# {0} — Architecture and project brief

> Created {1}{2} | Supports independent Antigravity and Claude proposals

## 1. Requirements and goals
- Problem and main user flow:

## 2. V1 scope and non-goals
- **In scope**:
- **Out of scope**:

## 3. Stack and module boundaries
- Frontend / backend / storage:

## 4. Proposal merge notes (optional)
- Agreements / adopted ideas / rejected ideas and reasons / open decisions:
`
  },
  frontendSpec: {
    zh: `# {0} — 前端视觉、交互与文案规范

## 1. Design Tokens
- 色彩 / 字体 / 间距 / 圆角 / 动效：

## 2. 页面与交互状态矩阵
| 页面/组件 | 正常态 | Loading | 空态 | 报错态 | 禁用/边界态 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 示例 | | | | | |

## 3. 文案润色检查（去机械说明文）
- 这页给谁用 / 要让人做成什么 / 精简后文案：
`,
    en: `# {0} — Frontend visuals, interaction and copy

## 1. Design tokens
- Color / typography / spacing / radius / motion:

## 2. UI states
| Page or component | Normal | Loading | Empty | Error | Disabled or edge case |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Example | | | | | |

## 3. Copy review
- Audience / goal / revised copy:
`
  },
  apiContract: {
    zh: `# {0} — 前后端接口契约（SSOT）

> 状态：**DRAFT（草案）**

## 1. 全局约定
- Base URL：\`/api\`

## 2. 接口清单
### \`GET /api/health\`
\`\`\`json
{ "ok": true }
\`\`\`

## 3. 变更记录
- {1}：初始化契约草案。
`,
    en: `# {0} — API contract (SSOT)

> Status: **DRAFT**

## 1. Conventions
- Base URL: \`/api\`

## 2. Endpoints
### \`GET /api/health\`
\`\`\`json
{ "ok": true }
\`\`\`

## 3. Changelog
- {1}: Draft created.
`
  },
  backendDesign: {
    zh: `# {0} — 后端详细设计

> 阶段 3 填写（Codex / Claude）

## 1. 数据模型与存储 Schema
## 2. 独立后端模块分层
## 3. 鉴权、并发与错误处理
## 4. 契约审校意见
`,
    en: `# {0} — Backend design

> Stage 3 (Codex / Claude)

## 1. Data model and storage schema
## 2. Modules and layers
## 3. Authorization, concurrency and errors
## 4. Contract review
`
  },
  tasks: {
    zh: `# {0} — 垂直切片任务单

## Milestone 1: 骨架与核心闭环
- [ ] 初始化工程与合并前类型检查/测试基线
- [ ] 实现核心后端接口与持久化
- [ ] 按 \`02-frontend-spec.md\` 实现核心页面与全部交互状态
- [ ] 跑通构建与自动化测试

## Milestone 2: 进阶能力与打磨
- [ ] 补充次级功能切片
- [ ] 文案与交互润色 + 边界回归测试
`,
    en: `# {0} — Vertical slice tasks

## Milestone 1: Scaffold and core workflow
- [ ] Set up the project and baseline type checks and tests
- [ ] Implement the core API and persistence
- [ ] Build the core pages and UI states from \`02-frontend-spec.md\`
- [ ] Verify builds and automated tests

## Milestone 2: Follow-up features and polish
- [ ] Implement secondary feature slices
- [ ] Refine copy and interactions and test edge cases
`
  },
  reviewLog: {
    zh: `# {0} — 分级审查与防复发记录

## 待设计确认（变更提议）
- （暂无）

## Codex 分级工程审查（最多 2 轮）
- **Blocker（阻塞级，须含复现路径）**：暂无
- **Suggestion（建议级）**：暂无

## Claude 架构与独立复审
- （暂无）

## Antigravity 设计与文案验收单
- （页面 / 组件 / 现状 / 期望）

## 错一次 → 硬检查（Mistake → Guardrail 欠账表）
- （记录已转化的类型检查 / 守卫测试，防止同类问题复发）
`,
    en: `# {0} — Reviews and regression checks

## Open design decisions
- None yet

## Codex tiered code review (up to two rounds)
- **Blocker (include reproduction steps)**: None yet
- **Suggestion**: None yet

## Claude architecture and independent review
- None yet

## Antigravity design and copy acceptance
- Page / component / current behavior / expected behavior

## Regression checks
- Record checks that prevent corrected issues from recurring.
`
  },
};
