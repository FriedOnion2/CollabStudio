import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { initProject } from './scaffold.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.COLLAB_DATA_DIR || path.resolve(__dirname, '../data');
const REGISTRY_PATH = path.join(DATA_DIR, 'registry.json');

const SCAN_IGNORE = new Set([
  'node_modules', '.git', '.svn', '.hg', 'dist', 'build', 'out', 'release', 'target',
  'venv', '.venv', '__pycache__', '.next', '.nuxt', '.vite', '.cache', '.idea', '.vscode',
  'docs', 'prototypes', 'coverage', 'logs', 'tmp', 'temp', 'assets', 'public', 'static'
]);

const SUBPROJECT_MARKERS = [
  { file: '.collab-state.json', tag: 'Collab' },
  { file: 'package.json', tag: 'Node' },
  { file: 'pyproject.toml', tag: 'Python' },
  { file: 'requirements.txt', tag: 'Python' },
  { file: 'Cargo.toml', tag: 'Rust' },
  { file: 'go.mod', tag: 'Go' },
  { file: 'pom.xml', tag: 'Java' },
  { file: 'build.gradle', tag: 'Gradle' },
  { file: 'CMakeLists.txt', tag: 'C/C++' },
  { file: 'docs/01-brief.md', tag: 'Docs' }
];

export const ALLOWED_DOCS = [
  { key: 'AGENTS.md', label: 'AGENTS.md', owner: 'Codex 铁律', isRule: true },
  { key: 'CLAUDE.md', label: 'CLAUDE.md', owner: 'Claude 铁律', isRule: true },
  { key: 'GEMINI.md', label: 'GEMINI.md', owner: 'Gemini 铁律', isRule: true },
  { key: 'docs/01-brief.md', label: '01 总体设计', owner: '总体规划' },
  { key: 'docs/02-frontend-spec.md', label: '02 前端规范', owner: '前端/文案' },
  { key: 'docs/03-api-contract.md', label: '03 接口契约', owner: '三端契约' },
  { key: 'docs/03b-backend-design.md', label: '03b 后端设计', owner: 'Codex/Claude' },
  { key: 'docs/04-tasks.md', label: '04 切片任务', owner: '规划/执行' },
  { key: 'docs/05-review-log.md', label: '05 审查验收', owner: '分级审查' }
];

export const DEFAULT_STAGE_ROUTING = () => ({
  '1': { cli: 'antigravity', model: '', effort: 'high' },
  '2': { cli: 'claude', model: '', effort: 'high' },
  '3': { cli: 'codex', model: '', effort: 'high' },
  '4': { cli: 'codex', model: '', effort: 'medium' },
  '5': { cli: 'codex', model: '', effort: 'xhigh' }
});

function mergeStageRouting(base, incoming) {
  const out = {};
  for (const k of ['1', '2', '3', '4', '5']) {
    out[k] = {
      ...(base[k] || { cli: 'codex', model: '', effort: '' }),
      ...((incoming && incoming[k]) || {})
    };
  }
  return out;
}

function normalizeRelPath(p = '') {
  return String(p || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '');
}

function normalizeSubprojects(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const item of list) {
    if (!item || !item.relPath) continue;
    const relPath = normalizeRelPath(item.relPath);
    if (!relPath || relPath === '.' || relPath.startsWith('..')) continue;
    const key = relPath.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: item.id || crypto.randomUUID().slice(0, 8),
      name: String(item.name || path.basename(relPath)).trim(),
      relPath,
      addedAt: item.addedAt || new Date().toISOString()
    });
  }
  return out;
}

const DEFAULT_STATE = (name) => ({
  name,
  stage: 1,
  contractFrozen: false,
  gates: { g1: false, g2: false, g3: false, g4: false, g5: false },
  stageRouting: DEFAULT_STAGE_ROUTING(),
  subprojects: [],
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

export async function scaffoldProject(dir, name, opts = {}) {
  return initProject(dir, name, opts);
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
      gates: { ...base.gates, ...(raw.gates || {}) },
      stageRouting: mergeStageRouting(base.stageRouting, raw.stageRouting),
      subprojects: normalizeSubprojects(raw.subprojects)
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
    stageRouting: mergeStageRouting(current.stageRouting, patch.stageRouting),
    subprojects: patch.subprojects !== undefined
      ? normalizeSubprojects(patch.subprojects)
      : current.subprojects,
    updatedAt: new Date().toISOString()
  };
  fs.mkdirSync(path.resolve(dir), { recursive: true });
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

export function resolveSubprojectDir(rootDir, relOrAbs) {
  const absRoot = path.resolve(rootDir);
  const raw = String(relOrAbs || '').trim();
  if (!raw) throw new Error('请填写子项目路径');
  const candidate = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(absRoot, raw);
  const rel = path.relative(absRoot, candidate);
  if (!rel || rel === '.' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('子项目目录必须位于主项目目录内部');
  }
  return { absDir: candidate, relPath: normalizeRelPath(rel) };
}

export function registerSubproject(rootDir, { relPath, name, initScaffold = true, includeRules = false }) {
  const absRoot = path.resolve(rootDir);
  if (!fs.existsSync(absRoot)) throw new Error('主项目目录不存在');
  const rootState = readProjectState(absRoot);
  const resolved = resolveSubprojectDir(absRoot, relPath);
  const subName = String(name || path.basename(resolved.absDir)).trim();

  if (initScaffold) {
    initProject(resolved.absDir, subName, { includeRules, parentName: rootState.name });
  } else {
    fs.mkdirSync(resolved.absDir, { recursive: true });
    if (!fs.existsSync(path.join(resolved.absDir, '.collab-state.json'))) {
      writeProjectState(resolved.absDir, { name: subName });
    }
  }

  const list = [...rootState.subprojects];
  const idx = list.findIndex((s) => s.relPath.toLowerCase() === resolved.relPath.toLowerCase());
  const entry = {
    id: idx >= 0 ? list[idx].id : crypto.randomUUID().slice(0, 8),
    name: subName,
    relPath: resolved.relPath,
    addedAt: idx >= 0 ? list[idx].addedAt : new Date().toISOString()
  };
  if (idx >= 0) list[idx] = entry;
  else list.push(entry);

  writeProjectState(absRoot, { subprojects: list });
  return { entry, absDir: resolved.absDir, relPath: resolved.relPath };
}

export function unregisterSubproject(rootDir, relPath) {
  const absRoot = path.resolve(rootDir);
  const norm = normalizeRelPath(relPath).toLowerCase();
  const rootState = readProjectState(absRoot);
  const next = rootState.subprojects.filter((s) => s.relPath.toLowerCase() !== norm);
  return writeProjectState(absRoot, { subprojects: next });
}

export function scanSubprojectCandidates(rootDir) {
  const absRoot = path.resolve(rootDir);
  if (!fs.existsSync(absRoot)) throw new Error('主项目目录不存在');
  const registered = new Set(readProjectState(absRoot).subprojects.map((s) => s.relPath.toLowerCase()));
  const candidates = [];

  function walk(currentDir, depth) {
    if (depth > 2) return;
    let entries = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      if (ent.name.startsWith('.') || SCAN_IGNORE.has(ent.name.toLowerCase())) continue;
      const full = path.join(currentDir, ent.name);
      const rel = normalizeRelPath(path.relative(absRoot, full));
      const tags = [];
      for (const m of SUBPROJECT_MARKERS) {
        if (fs.existsSync(path.join(full, m.file)) && !tags.includes(m.tag)) {
          tags.push(m.tag);
        }
      }
      const alreadyAdded = registered.has(rel.toLowerCase());
      if (tags.length > 0 || depth === 1) {
        candidates.push({
          name: ent.name,
          relPath: rel,
          absDir: full,
          tags,
          hasCollab: tags.includes('Collab'),
          alreadyAdded
        });
      }
      // If depth 1 is a grouping dir (e.g. apps/, packages/, services/) without its own marker, inspect depth 2
      if (depth === 1 && !tags.includes('Collab')) {
        walk(full, 2);
      }
    }
  }

  walk(absRoot, 1);
  candidates.sort((a, b) => {
    if (a.alreadyAdded !== b.alreadyAdded) return a.alreadyAdded ? 1 : -1;
    if (a.tags.length !== b.tags.length) return b.tags.length - a.tags.length;
    return a.relPath.localeCompare(b.relPath);
  });
  return candidates;
}

export function inspectNode(dir, fallbackName, { parentDir = null, parentName = '', relPath = '' } = {}) {
  const absDir = path.resolve(dir);
  const exists = fs.existsSync(absDir);
  const state = exists ? readProjectState(absDir, fallbackName) : DEFAULT_STATE(fallbackName || path.basename(absDir));
  const docs = ALLOWED_DOCS.map((d) => {
    const full = path.join(absDir, d.key);
    const stat = exists && fs.existsSync(full) ? fs.statSync(full) : null;
    const inherited = Boolean(!stat && d.isRule && parentDir && fs.existsSync(path.join(parentDir, d.key)));
    return {
      ...d,
      exists: Boolean(stat),
      inherited,
      size: stat ? stat.size : 0,
      mtime: stat ? stat.mtime.toISOString() : null
    };
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
  return {
    dir: absDir,
    exists,
    isSubproject: Boolean(parentDir),
    parentDir: parentDir ? path.resolve(parentDir) : null,
    parentName: parentName || '',
    relPath: relPath || '',
    state,
    docs,
    milestones,
    progress: { done: doneTasks, total: totalTasks },
    prototypes
  };
}

export function inspectProject(dir, fallbackName) {
  const root = inspectNode(dir, fallbackName);
  const subList = (root.state.subprojects || []).map((s) => {
    const subAbs = path.resolve(root.dir, s.relPath);
    const node = inspectNode(subAbs, s.name, {
      parentDir: root.dir,
      parentName: root.state.name,
      relPath: s.relPath
    });
    return {
      id: s.id,
      name: node.state.name || s.name,
      relPath: s.relPath,
      dir: node.dir,
      exists: node.exists,
      stage: node.state.stage,
      contractFrozen: node.state.contractFrozen,
      gates: node.state.gates,
      stageRouting: node.state.stageRouting,
      progress: node.progress
    };
  });

  const aggDone = root.progress.done + subList.reduce((acc, s) => acc + s.progress.done, 0);
  const aggTotal = root.progress.total + subList.reduce((acc, s) => acc + s.progress.total, 0);

  return {
    ...root,
    subprojects: subList,
    aggregateProgress: { done: aggDone, total: aggTotal }
  };
}

export function findParentProject(targetDir) {
  const absTarget = path.resolve(targetDir).toLowerCase();
  for (const reg of loadRegistry()) {
    const absRoot = path.resolve(reg.dir);
    if (absRoot.toLowerCase() === absTarget) return null;
    const rootState = readProjectState(absRoot, reg.name);
    for (const s of rootState.subprojects || []) {
      const subAbs = path.resolve(absRoot, s.relPath);
      if (subAbs.toLowerCase() === absTarget) {
        return {
          parentDir: absRoot,
          parentName: rootState.name || reg.name,
          relPath: s.relPath,
          subName: s.name
        };
      }
    }
  }
  return null;
}

export function inspectScope(dir, fallbackName) {
  const parent = findParentProject(dir);
  if (parent) {
    const node = inspectNode(dir, fallbackName || parent.subName, {
      parentDir: parent.parentDir,
      parentName: parent.parentName,
      relPath: parent.relPath
    });
    const rootInfo = inspectProject(parent.parentDir, parent.parentName);
    return {
      ...node,
      siblings: rootInfo.subprojects,
      subprojects: []
    };
  }
  return inspectProject(dir, fallbackName);
}
