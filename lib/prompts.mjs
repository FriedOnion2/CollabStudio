export const STAGES = [
  { id: 1, key: 'g1', title: '立项与双方案规划', owner: 'AGY × Claude', gateLabel: '需求与总体方案已拍板' },
  { id: 2, key: 'g2', title: '前端视觉、文案与契约', owner: 'AGY × Claude', gateLabel: '视觉/文案/契约草案已确认' },
  { id: 3, key: 'g3', title: '后端细化与契约冻结', owner: 'Codex / Claude', gateLabel: '前后端契约已冻结' },
  { id: 4, key: 'g4', title: '垂直切片与硬核编码', owner: 'Codex / Claude', gateLabel: '切片编码与守卫测试通过' },
  { id: 5, key: 'g5', title: '分级审查与设计验收', owner: '三端协同验收', gateLabel: '≤2轮审查 + 设计验收全绿' }
];

export function buildPrompts(project, milestoneTitle = 'Milestone 1') {
  const dir = project.dir;
  const rawName = project.state?.name || '当前项目';
  const name = project.isSubproject && project.parentName
    ? `${project.parentName} / ${rawName}`
    : rawName;
  const scopeHint = project.isSubproject && project.parentDir
    ? `（子项目目录：${dir}，所属主项目根目录：${project.parentDir}；请同时遵守主项目根目录的规则与总体架构约束）`
    : `（目录：${dir}）`;
  const stage = project.state?.stage || 1;
  const ms = milestoneTitle || 'Milestone 1';

  const antigravity = {
    1: `使用 dual-agent-collab 技能处理项目「${name}」${scopeHint}。\n当前处于【阶段 1：立项与总体设计】。请先阅读 GEMINI.md，与我确认目标、V1 非目标与技术栈，完善 docs/01-brief.md，并同步 AGENTS.md / CLAUDE.md / GEMINI.md。未核实代码事实时须标注「推测」。`,
    blind: `【Antigravity / Gemini · 独立盲写方案（Blind Draft）】\n项目：「${name}」${scopeHint}。请先阅读 GEMINI.md。\n⚠️ 请仅依据我的原始需求与客观背景，独立输出一份架构与产品方案（不迎合、不参考他方草稿），重点给出差异化思路、风险点与非目标清单；未核实代码之处明确标出「推测」。`,
    copy: `【Antigravity / Gemini · 界面文案与交互顾问（去机械味）】\n项目：「${name}」${scopeHint}。请阅读 docs/02-frontend-spec.md 及当前页面文案。\n请以真实使用者的视角重写界面文案与交互提示：1) 这页给谁用、要让人做成什么；2) 删掉冗长的 AI 解释性废话与技术黑话；3) 给出「原文 → 改后 → 理由」对照表，供 Claude/Codex 核实采纳。`,
    2: `继续项目「${name}」${scopeHint}，进入【阶段 2：前端设计与契约草案】。\n请编写 docs/02-frontend-spec.md（Design Tokens、组件与正常/Loading/空态/报错态），起草 docs/03-api-contract.md，并在 docs/04-tasks.md 按垂直切片拆分 Milestone（第一个切片须含类型检查与测试基线）。`,
    3: `项目「${name}」${scopeHint}已完成阶段 3 后端细化。\n请核实 docs/03b-backend-design.md 与 docs/03-api-contract.md 的修订意见；无冲突则将契约标为 FROZEN 并更新 .collab-state.json。`,
    5: `项目「${name}」${scopeHint}进入【阶段 5：设计与文案验收】。\n请按用户真实路径对照 docs/02-frontend-spec.md 核验视觉还原度、交互状态与界面文案可读性；偏差只写入 docs/05-review-log.md（页面/组件/现状/期望），不直接抢改业务源码。`
  };

  const codex = {
    stage3: `【Codex | 项目：${name} | 阶段 3：后端细化与契约评审】\n工作范围${scopeHint}。\n请先阅读 AGENTS.md、docs/01-brief.md、docs/02-frontend-spec.md、docs/03-api-contract.md。\n⚠️ 本轮禁止写业务代码，仅完成：\n1. 编写后端详细设计到 docs/03b-backend-design.md（数据模型、独立模块边界、并发与错误处理）。\n2. 审校 docs/03-api-contract.md 是否存在字段缺失、类型歧义或不可落地项。汇报请简短、先给结论。`,
    stage4: `【Codex | 项目：${name} | 阶段 4：硬核后端 / 切片编码 — ${ms}】\n工作范围${scopeHint}。\n契约已冻结。请严格遵守 AGENTS.md、02-frontend-spec.md、03-api-contract.md 与 03b-backend-design.md，独立完成 docs/04-tasks.md 中的「${ms}」。\n要求：接口与前端状态 100% 对齐，补齐自动化测试与构建验证，勾选 04-tasks.md，汇报只写结论、改动文件与验证结果。`,
    stage5Review: `【Codex | 项目：${name} | 阶段 5：分级工程审查（最多 2 轮防死循环）】\n工作范围${scopeHint}。\n请先阅读 AGENTS.md 与 docs/01~04，对当前改动执行严格分级审查并写入 docs/05-review-log.md：\n- **Blocker（阻塞级）**：仅限会算错钱、丢数据、越权、发错消息、引发发布事故的问题，且必须写出具体复现路径。\n- **Suggestion（建议级）**：极端边界与优化建议，仅记录不挡上线。\n默认使用高性价比审查深度，仅在涉及资金/鉴权/对外发送/关键写库文件时深挖；最多审 2 轮。`,
    guardrail: `【Codex | 项目：${name} | 错一次 → 硬检查（Mistake → Guardrail）】\n工作范围${scopeHint}。\n请阅读 docs/05-review-log.md 中刚被退回或人类纠正的问题：\n1. 在同一修复提交里永久拦住这一类错误：优先写成类型检查或守卫测试（报错信息写清怎么改），其次改接口/目录让错代码写不出来；实在做不到再写文字规则并说明原因。\n2. 已有违规记入 05-review-log.md 欠账表（只减不增），新代码零容忍。`
  };

  const claude = {
    merge: `【Claude | 项目：${name} | 阶段 1：双方案核实与合并】\n工作范围${scopeHint}。\n请先阅读 CLAUDE.md 与 docs/01-brief.md，把你自己的方案与 Gemini (Antigravity) 独立盲写方案放在一起核实：\n1. 对照源码与客观事实核验 Gemini 标「推测」的部分。\n2. 合并成一份最终方案写入 docs/01-brief.md，清晰列出：两份一致的 / 采纳 Gemini 的 / 不采纳及理由 / 需人类拍板的分歧点。`,
    stage2: `【Claude | 项目：${name} | 阶段 2：高审美前端视觉、动效与初版交互】\n工作范围${scopeHint}。\n请先阅读 CLAUDE.md、docs/01-brief.md 与 docs/02-frontend-spec.md，实现高完成度的前端视觉、动效与交互原型/页面。\n动手前列全深浅色、移动端与空态/加载/报错态，全部改齐并实测；界面文案完成后提示我交给 Gemini 做「去机械味」润色。`,
    stage4: `【Claude | 项目：${name} | 阶段 4：切片实现 / 改全与核实 — ${ms}】\n工作范围${scopeHint}。\n请阅读 CLAUDE.md、02-frontend-spec.md、03-api-contract.md 与 03b-backend-design.md，完成「${ms}」（小改动与前端联调直接自己做，独立成块的重后端可派给 Codex）。\n⚠️ 严格执行「改全与核实」：列全代码/文案/文档/测试同类位置一次改齐，按用户路径跑通验证后再勾选 04-tasks.md。`,
    stage5Review: `【Claude | 项目：${name} | 阶段 5：独立复审 & 错一次变硬检查】\n工作范围${scopeHint}。\n请以独立架构师视角复核当前实现与 docs/05-review-log.md，重点排查漏改细节、状态不同步与体验断层；将结论写入「Claude 架构与独立复审」，并对被纠正的问题补齐类型/守卫测试永久防复发。`
  };

  return {
    recommendedAntigravity: antigravity[stage] || antigravity[1],
    antigravityByStage: antigravity,
    codex,
    claude
  };
}
