import { t } from './locale.mjs';
import fs from 'node:fs';
import path from 'node:path';

function buildDocs(name, { includeRules = true, parentName = '' } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const scopeNote = parentName ? t(" | 所属主项目：{0}", parentName) : '';
  const docs = {
    'docs/01-brief.md': t("brief", name, today, scopeNote),
    'docs/02-frontend-spec.md': t("frontendSpec", name),
    'docs/03-api-contract.md': t("apiContract", name, today),
    'docs/03b-backend-design.md': t("backendDesign", name),
    'docs/04-tasks.md': t("tasks", name),
    'docs/05-review-log.md': t("reviewLog", name)
  };
  if (includeRules) {
    const askFirst = t("askFirst");
    return {
      'AGENTS.md': t("codexRules", askFirst),
      'CLAUDE.md': t("claudeRules", askFirst),
      'GEMINI.md': t("geminiRules", askFirst),
      ...docs
    };
  }
  return docs;
}

export function initProject(targetDir, projectName, { force = false, includeRules = true, parentName = '' } = {}) {
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

  for (const [rel, content] of Object.entries(buildDocs(name, { includeRules, parentName }))) {
    writeOnce(rel, content);
  }
  const state = {
    name,
    stage: 1,
    contractFrozen: false,
    reviewRound: 0,
    gates: { g1: false, g2: false, g3: false, g4: false, g5: false },
    stageRouting: {
      '1': { cli: 'antigravity', model: '', effort: 'high' },
      '2': { cli: 'claude', model: '', effort: 'high' },
      '3': { cli: 'codex', model: '', effort: 'high' },
      '4': { cli: 'codex', model: '', effort: 'medium' },
      '5': { cli: 'codex', model: '', effort: 'xhigh' }
    },
    ...(parentName ? {} : { subprojects: [] }),
    updatedAt: new Date().toISOString()
  };
  writeOnce('.collab-state.json', JSON.stringify(state, null, 2) + '\n');
  return { dir: absDir, name, created, skipped };
}
