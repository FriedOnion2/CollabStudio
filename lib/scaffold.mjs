import fs from 'node:fs';
import path from 'node:path';

const SHARED_ASK_FIRST = `## 先问清单（以下动作必须先请示人类，其余直接推进）
- 删数据、停服、额外花钱、对外发消息（公开评论/通知他人）、改产品方向、新建或轮换密钥、修改权限。
- 错一次就变硬检查：每次人类纠正或审查退回，须在同一提交里用类型检查/守卫测试或结构调整永久拦住同类问题；实在做不到再写文字规则并说明原因。`;

const AGENTS_MD = `# AGENTS.md — Codex (GPT) 协作铁律

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

${SHARED_ASK_FIRST}
`;

const CLAUDE_MD = `# CLAUDE.md — Claude 协作铁律

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

${SHARED_ASK_FIRST}
`;

const GEMINI_MD = `# GEMINI.md — Antigravity (Gemini) 协作铁律

> 定位：高情商军师、总体架构设计师、前端体验与产品文案顾问（立项规划、独立第二方案、前端规范、文案/交互润色、设计验收）。

## 1. 必读顺序
1. \`docs/01-brief.md\` → \`02-frontend-spec.md\` → \`03-api-contract.md\` → \`04-tasks.md\` → \`05-review-log.md\`

## 2. 防幻觉与防越界
- 分析现有代码或线上事实时，必须先读源码/查输出再下结论；未核实的推断一律显式标注「推测」，绝不编造。
- 做「独立盲写方案」时只依据人类原话与客观背景，提出差异化视角。
- 做「文案与交互顾问」时：去掉冗长解释性说明文与技术黑话，站在真实使用者角度写短、准、自然的界面文字。
- 阶段 5 设计验收发现偏差时，只写结构化返工单（页面/组件/现状/期望）到 \`docs/05-review-log.md\`，不与 Codex/Claude 抢改业务源码。

${SHARED_ASK_FIRST}
`;

function buildDocs(name) {
  const today = new Date().toISOString().slice(0, 10);
  return {
    'AGENTS.md': AGENTS_MD,
    'CLAUDE.md': CLAUDE_MD,
    'GEMINI.md': GEMINI_MD,
    'docs/01-brief.md': `# ${name} — 总体架构与立项方案\n\n> 创建日期：${today} | 支持 Antigravity + Claude 独立双方案合并\n\n## 1. 原始需求与核心目标\n- 痛点与主路径：\n\n## 2. V1 范围与明确非目标（Non-Goals）\n- **V1 必做**：\n- **V1 不做**：\n\n## 3. 技术栈与模块边界\n- 前端 / 后端 / 存储：\n\n## 4. 双方案合并记录（如有）\n- 一致项 / 采纳项 / 拒绝与理由 / 待拍板项：\n`,
    'docs/02-frontend-spec.md': `# ${name} — 前端视觉、交互与文案规范\n\n## 1. Design Tokens\n- 色彩 / 字体 / 间距 / 圆角 / 动效：\n\n## 2. 页面与交互状态矩阵\n| 页面/组件 | 正常态 | Loading | 空态 | 报错态 | 禁用/边界态 |\n| :--- | :--- | :--- | :--- | :--- | :--- |\n| 示例 | | | | | |\n\n## 3. 文案润色检查（去机械说明文）\n- 这页给谁用 / 要让人做成什么 / 精简后文案：\n`,
    'docs/03-api-contract.md': `# ${name} — 前后端接口契约（SSOT）\n\n> 状态：**DRAFT（草案）**\n\n## 1. 全局约定\n- Base URL：\`/api\`\n\n## 2. 接口清单\n### \`GET /api/health\`\n\`\`\`json\n{ "ok": true }\n\`\`\`\n\n## 3. 变更记录\n- ${today}：初始化契约草案。\n`,
    'docs/03b-backend-design.md': `# ${name} — 后端详细设计\n\n> 阶段 3 填写（Codex / Claude）\n\n## 1. 数据模型与存储 Schema\n## 2. 独立后端模块分层\n## 3. 鉴权、并发与错误处理\n## 4. 契约审校意见\n`,
    'docs/04-tasks.md': `# ${name} — 垂直切片任务单\n\n## Milestone 1: 骨架与核心闭环\n- [ ] 初始化工程与合并前类型检查/测试基线\n- [ ] 实现核心后端接口与持久化\n- [ ] 按 \`02-frontend-spec.md\` 实现核心页面与全部交互状态\n- [ ] 跑通构建与自动化测试\n\n## Milestone 2: 进阶能力与打磨\n- [ ] 补充次级功能切片\n- [ ] 文案与交互润色 + 边界回归测试\n`,
    'docs/05-review-log.md': `# ${name} — 分级审查与防复发记录\n\n## 待设计确认（变更提议）\n- （暂无）\n\n## Codex 分级工程审查（最多 2 轮）\n- **Blocker（阻塞级，须含复现路径）**：暂无\n- **Suggestion（建议级）**：暂无\n\n## Claude 架构与独立复审\n- （暂无）\n\n## Antigravity 设计与文案验收单\n- （页面 / 组件 / 现状 / 期望）\n\n## 错一次 → 硬检查（Mistake → Guardrail 欠账表）\n- （记录已转化的类型检查 / 守卫测试，防止同类问题复发）\n`
  };
}

export function initProject(targetDir, projectName, { force = false } = {}) {
  const absDir = path.resolve(targetDir);
  const name = (projectName || path.basename(absDir) || 'NewProject').trim();
  fs.mkdirSync(path.join(absDir, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(absDir, 'prototypes'), { recursive: true });

  const created = [];
  const skipped = [];
  const writeOnce = (relPath, content) => {
    const full = path.join(absDir, relPath);
    if (!force && fs.existsSync(full)) { skipped.push(relPath); return; }
    fs.writeFileSync(full, content, 'utf8');
    created.push(relPath);
  };

  for (const [rel, content] of Object.entries(buildDocs(name))) writeOnce(rel, content);
  const state = {
    name, stage: 1, contractFrozen: false, reviewRound: 0,
    gates: { g1: false, g2: false, g3: false, g4: false, g5: false },
    updatedAt: new Date().toISOString()
  };
  writeOnce('.collab-state.json', JSON.stringify(state, null, 2) + '\n');
  return { dir: absDir, name, created, skipped };
}
