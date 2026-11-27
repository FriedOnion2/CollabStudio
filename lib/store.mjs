import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initProject } from './scaffold.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.COLLAB_DATA_DIR || path.resolve(__dirname, '../data');
const REGISTRY_PATH = path.join(DATA_DIR, 'registry.json');

export const ALLOWED_DOCS = [
  { key: 'AGENTS.md', label: 'AGENTS.md', owner: 'Codex 铁律' },
  { key: 'CLAUDE.md', label: 'CLAUDE.md', owner: 'Claude 铁律' },
  { key: 'GEMINI.md', label: 'GEMINI.md', owner: 'Gemini 铁律' },
  { key: 'docs/01-brief.md', label: '01 总体设计', owner: '总体规划' },
  { key: 'docs/02-frontend-spec.md', label: '02 前端规范', owner: '前端/文案' },
  { key: 'docs/03-api-contract.md', label: '03 接口契约', owner: '三端契约' },
  { key: 'docs/03b-backend-design.md', label: '03b 后端设计', owner: 'Codex/Claude' },
  { key: 'docs/04-tasks.md', label: '04 切片任务', owner: '规划/执行' },
  { key: 'docs/05-review-log.md', label: '05 审查验收', owner: '分级审查' }
];

const DEFAULT_STATE = (name) => ({
  name,
  stage: 1,
  contractFrozen: false,
  gates: { g1: false, g2: false, g3: false, g4: false, g5: false },
  updatedAt: new Date().toISOString()
});

export function loadRegistry() {
  try {
    if (!fs.existsSync(REGISTRY_PATH)) return [];
    const parsed = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
    return Array.isArray(parsed.projects) ? parsed.projects : [];
  } catch {
    return [];
  }
}

export function saveRegistry(projects) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify({ projects }, null, 2) + '\n', 'utf8');
}

export function registerProject(dir, name) {
  const absDir = path.resolve(dir);
  const projects = loadRegistry();
  const idx = projects.findIndex((p) => p.dir.toLowerCase() === absDir.toLowerCase());
  const entry = {
    dir: absDir,
    name: (name || path.basename(absDir)).trim(),
    addedAt: idx >= 0 ? projects[idx].addedAt : new Date().toISOString()
  };
  if (idx >= 0) projects[idx] = entry;
  else projects.unshift(entry);
  saveRegistry(projects);
  return entry;
}

export function unregisterProject(dir) {
  const absDir = path.resolve(dir).toLowerCase();
  const projects = loadRegistry().filter((p) => p.dir.toLowerCase() !== absDir);
  saveRegistry(projects);
  return projects;
}

export async function scaffoldProject(dir, name) {
  return initProject(dir, name);
}

export function readProjectState(dir, fallbackName) {
  const statePath = path.join(dir, '.collab-state.json');
  const base = DEFAULT_STATE(fallbackName || path.basename(dir));
  try {
    if (!fs.existsSync(statePath)) return base;
    const raw = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    return {
      ...base,
      ...raw,
      gates: { ...base.gates, ...(raw.gates || {}) }
    };
  } catch {
    return base;
  }
}

export function writeProjectState(dir, patch) {
  const current = readProjectState(dir);
  const next = {
    ...current,
    ...patch,
    gates: { ...current.gates, ...(patch.gates || {}) },
    updatedAt: new Date().toISOString()
  };
  fs.writeFileSync(path.join(dir, '.collab-state.json'), JSON.stringify(next, null, 2) + '\n', 'utf8');
  return next;
}

export function parseTasks(markdown = '') {
  const milestones = [];
  let current = null;
  for (const rawLine of markdown.split(/\r?\n/)) {
    const heading = rawLine.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      current = { title: heading[1], tasks: [], doneCount: 0, totalCount: 0 };
      milestones.push(current);
      continue;
    }
    const item = rawLine.match(/^\s*-\s+\[([ xX])\]\s+(.+)$/);
    if (item) {
      if (!current) {
        current = { title: '未分组任务', tasks: [], doneCount: 0, totalCount: 0 };
        milestones.push(current);
      }
      const done = item[1].toLowerCase() === 'x';
      current.tasks.push({ text: item[2].trim(), done });
      current.totalCount += 1;
      if (done) current.doneCount += 1;
    }
  }
  return milestones;
}

export function inspectProject(dir, fallbackName) {
  const absDir = path.resolve(dir);
  const exists = fs.existsSync(absDir);
  const state = exists ? readProjectState(absDir, fallbackName) : DEFAULT_STATE(fallbackName || path.basename(absDir));
  const docs = ALLOWED_DOCS.map((d) => {
    const full = path.join(absDir, d.key);
    const stat = exists && fs.existsSync(full) ? fs.statSync(full) : null;
    return { ...d, exists: Boolean(stat), size: stat ? stat.size : 0, mtime: stat ? stat.mtime.toISOString() : null };
  });
  const tasksPath = path.join(absDir, 'docs/04-tasks.md');
  const milestones = exists && fs.existsSync(tasksPath)
    ? parseTasks(fs.readFileSync(tasksPath, 'utf8'))
    : [];
  const totalTasks = milestones.reduce((a, m) => a + m.totalCount, 0);
  const doneTasks = milestones.reduce((a, m) => a + m.doneCount, 0);
  const protoDir = path.join(absDir, 'prototypes');
  const prototypes = exists && fs.existsSync(protoDir)
    ? fs.readdirSync(protoDir).filter((f) => !f.startsWith('.'))
    : [];
  return { dir: absDir, exists, state, docs, milestones, progress: { done: doneTasks, total: totalTasks }, prototypes };
}
