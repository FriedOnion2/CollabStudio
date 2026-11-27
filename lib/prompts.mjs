import { t } from './locale.mjs';
export const STAGES = [
  { id: 1, key: 'g1', title: '立项与双方案规划', owner: 'AGY × Claude', gateLabel: '需求与总体方案已拍板' },
  { id: 2, key: 'g2', title: '前端视觉、文案与契约', owner: 'AGY × Claude', gateLabel: '视觉/文案/契约草案已确认' },
  { id: 3, key: 'g3', title: '后端细化与契约冻结', owner: 'Codex / Claude', gateLabel: '前后端契约已冻结' },
  { id: 4, key: 'g4', title: '垂直切片与硬核编码', owner: 'Codex / Claude', gateLabel: '切片编码与守卫测试通过' },
  { id: 5, key: 'g5', title: '分级审查与设计验收', owner: '三端协同验收', gateLabel: '≤2轮审查 + 设计验收全绿' }
];

export function buildPrompts(project, milestoneTitle = 'Milestone 1') {
  const dir = project.dir;
  const rawName = project.state?.name || t("当前项目");
  const name = project.isSubproject && project.parentName
    ? `${project.parentName} / ${rawName}`
    : rawName;
  const scopeHint = project.isSubproject && project.parentDir
    ? t("（子项目目录：{0}，所属主项目根目录：{1}；请同时遵守主项目根目录的规则与总体架构约束）", dir, project.parentDir)
    : t("（目录：{0}）", dir);
  const stage = project.state?.stage || 1;
  const ms = milestoneTitle || 'Milestone 1';

  const antigravity = {
    1: t("antigravityKickoff", name, scopeHint),
    blind: t("antigravityDraft", name, scopeHint),
    copy: t("antigravityCopy", name, scopeHint),
    2: t("antigravityFrontend", name, scopeHint),
    3: t("antigravityContract", name, scopeHint),
    5: t("antigravityReview", name, scopeHint)
  };

  const codex = {
    stage3: t("codexBackend", name, scopeHint),
    stage4: t("codexImplementation", name, ms, scopeHint, ms),
    stage5Review: t("codexReview", name, scopeHint),
    guardrail: t("codexRegression", name, scopeHint)
  };

  const claude = {
    merge: t("claudeMerge", name, scopeHint),
    stage2: t("claudeFrontend", name, scopeHint),
    stage4: t("claudeImplementation", name, ms, scopeHint, ms),
    stage5Review: t("claudeReview", name, scopeHint)
  };

  return {
    recommendedAntigravity: antigravity[stage] || antigravity[1],
    antigravityByStage: antigravity,
    codex,
    claude
  };
}
