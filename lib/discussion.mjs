import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { writeProjectState } from './store.mjs';

const DISCUSSION_FILE = '.collab-discussion.json';
const REFS_DIR = '.collab-refs';
const MAX_SINGLE_FILE_CHARS = 20_000;
const MAX_TOTAL_ATTACH_CHARS = 60_000;

const TEXT_EXTS = new Set([
  '.md', '.markdown', '.txt', '.json', '.jsonc', '.yaml', '.yml', '.toml', '.ini', '.env',
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.vue', '.svelte', '.html', '.htm', '.css', '.scss', '.less',
  '.py', '.go', '.rs', '.java', '.kt', '.c', '.h', '.cpp', '.hpp', '.cs', '.rb', '.php', '.sh', '.ps1', '.bat', '.cmd',
  '.sql', '.csv', '.tsv', '.xml', '.svg', '.graphql', '.proto', '.dockerfile', '.gitignore', '.log'
]);

function isLikelyTextFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (TEXT_EXTS.has(ext)) return true;
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(1024);
    const bytes = fs.readSync(fd, buf, 0, 1024, 0);
    fs.closeSync(fd);
    for (let i = 0; i < bytes; i += 1) {
      if (buf[i] === 0) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function defaultDiscussion() {
  return {
    planLocked: false,
    lockedAt: null,
    attachments: [],
    messages: [],
    updatedAt: new Date().toISOString()
  };
}

export function readDiscussion(dir) {
  const absDir = path.resolve(dir);
  const full = path.join(absDir, DISCUSSION_FILE);
  try {
    if (!fs.existsSync(full)) return defaultDiscussion();
    const raw = JSON.parse(fs.readFileSync(full, 'utf8'));
    const base = defaultDiscussion();
    const attachments = Array.isArray(raw.attachments)
      ? raw.attachments.map((a) => ({ ...a, exists: Boolean(a.path && fs.existsSync(a.path)) }))
      : [];
    return {
      ...base,
      ...raw,
      attachments,
      messages: Array.isArray(raw.messages) ? raw.messages : []
    };
  } catch {
    return defaultDiscussion();
  }
}

export function saveDiscussion(dir, data) {
  const absDir = path.resolve(dir);
  const next = {
    ...defaultDiscussion(),
    ...data,
    updatedAt: new Date().toISOString()
  };
  fs.mkdirSync(absDir, { recursive: true });
  fs.writeFileSync(path.join(absDir, DISCUSSION_FILE), JSON.stringify(next, null, 2) + '\n', 'utf8');
  return next;
}

export function addAttachmentPaths(dir, filePaths = []) {
  const disc = readDiscussion(dir);
  for (const rawPath of filePaths) {
    if (!rawPath) continue;
    const absPath = path.resolve(String(rawPath));
    if (!fs.existsSync(absPath)) continue;
    const stat = fs.statSync(absPath);
    if (!stat.isFile()) continue;
    if (disc.attachments.some((a) => a.path && a.path.toLowerCase() === absPath.toLowerCase())) continue;
    disc.attachments.push({
      id: crypto.randomUUID().slice(0, 8),
      name: path.basename(absPath),
      path: absPath,
      size: stat.size,
      isText: isLikelyTextFile(absPath),
      addedAt: new Date().toISOString()
    });
  }
  return saveDiscussion(dir, disc);
}

export function addUploadedAttachments(dir, uploads = []) {
  const absDir = path.resolve(dir);
  const refsDir = path.join(absDir, REFS_DIR);
  fs.mkdirSync(refsDir, { recursive: true });
  const disc = readDiscussion(absDir);

  for (const item of uploads) {
    if (!item || !item.name) continue;
    const safeName = path.basename(String(item.name)).replace(/[<>:"/\\|?*]/g, '_');
    const target = path.join(refsDir, safeName);
    if (item.base64) {
      fs.writeFileSync(target, Buffer.from(item.base64, 'base64'));
    } else {
      fs.writeFileSync(target, String(item.content ?? ''), 'utf8');
    }
    const stat = fs.statSync(target);
    const existingIdx = disc.attachments.findIndex((a) => a.path && a.path.toLowerCase() === target.toLowerCase());
    const entry = {
      id: existingIdx >= 0 ? disc.attachments[existingIdx].id : crypto.randomUUID().slice(0, 8),
      name: safeName,
      path: target,
      size: stat.size,
      isText: isLikelyTextFile(target),
      addedAt: new Date().toISOString()
    };
    if (existingIdx >= 0) disc.attachments[existingIdx] = entry;
    else disc.attachments.push(entry);
  }
  return saveDiscussion(absDir, disc);
}

export function removeAttachment(dir, attachId) {
  const disc = readDiscussion(dir);
  disc.attachments = disc.attachments.filter((a) => a.id !== attachId);
  return saveDiscussion(dir, disc);
}

export function clearDiscussion(dir, { keepAttachments = true } = {}) {
  const disc = readDiscussion(dir);
  disc.messages = [];
  disc.planLocked = false;
  disc.lockedAt = null;
  if (!keepAttachments) disc.attachments = [];
  return saveDiscussion(dir, disc);
}

export function appendDiscussionMessage(dir, msg) {
  const disc = readDiscussion(dir);
  const entry = {
    id: crypto.randomUUID().slice(0, 8),
    createdAt: new Date().toISOString(),
    ...msg
  };
  disc.messages.push(entry);
  saveDiscussion(dir, disc);
  return entry;
}

export function updateDiscussionMessage(dir, msgId, patch) {
  const disc = readDiscussion(dir);
  const idx = disc.messages.findIndex((m) => m.id === msgId);
  if (idx >= 0) {
    disc.messages[idx] = { ...disc.messages[idx], ...patch };
    saveDiscussion(dir, disc);
    return disc.messages[idx];
  }
  return null;
}

function readAttachmentsContext(attachments = [], { compact = false } = {}) {
  if (!attachments.length) return '';
  let budget = compact ? 12_000 : MAX_TOTAL_ATTACH_CHARS;
  const singleCap = compact ? 4_000 : MAX_SINGLE_FILE_CHARS;
  const blocks = [];

  for (const att of attachments) {
    if (!att.path || !fs.existsSync(att.path)) {
      blocks.push(`- 附件「${att.name}」路径不存在：${att.path}`);
      continue;
    }
    if (!att.isText) {
      blocks.push(`- 非文本附件「${att.name}」（${att.size} bytes），本地路径：\`${att.path}\`（如需查看请直接按路径读取）`);
      continue;
    }
    if (compact && att.size > singleCap) {
      blocks.push(`- 大型参考文件「${att.name}」（${att.size} bytes），本地路径：\`${att.path}\`（前轮已研读；如需核对具体行请直接按路径读取）`);
      continue;
    }
    try {
      let text = fs.readFileSync(att.path, 'utf8');
      let truncated = false;
      const limit = Math.min(singleCap, budget);
      if (limit <= 0) {
        blocks.push(`- 文本附件「${att.name}」路径：\`${att.path}\`（因上下文长度限制未展开，请按路径直接读取）`);
        continue;
      }
      if (text.length > limit) {
        text = text.slice(0, limit);
        truncated = true;
      }
      budget -= text.length;
      blocks.push(`### 附件：${att.name}（路径：${att.path}${truncated ? '，已截断前段' : ''}）\n\`\`\`\n${text}\n\`\`\``);
    } catch {
      blocks.push(`- 附件「${att.name}」读取失败，路径：\`${att.path}\``);
    }
  }
  return blocks.join('\n\n');
}

export function buildDiscussionPrompt({ dir, projectName, userMessage, discussion, parentDir = null, parentName = '' }) {
  const absDir = path.resolve(dir);
  const scopeDesc = parentDir
    ? `子项目「${parentName} / ${projectName}」（子项目目录：${absDir}，主项目根目录：${path.resolve(parentDir)}）`
    : `项目「${projectName}」（目录：${absDir}）`;
  const parts = [
    `你正在 CollabStudio 的【需求与方案讨论阶段】协助用户敲定${scopeDesc}的落地方案。`,
    `⚠️ 重要边界：当前仍处于方案讨论期，**请勿直接修改业务代码文件**。请基于用户的需求、导入的附件和既有项目文档，给出清晰、可执行、结构化的方案建议（包含目标、核心路径、V1 范围与非目标、技术架构/模块划分、风险与待确认问题），等待用户拍板后再正式进入生产。`
  ];

  if (parentDir) {
    const parentBriefPath = path.join(path.resolve(parentDir), 'docs', '01-brief.md');
    if (fs.existsSync(parentBriefPath)) {
      const pBrief = fs.readFileSync(parentBriefPath, 'utf8').trim();
      if (pBrief && pBrief.length < 8_000) {
        parts.push(`## 主项目总体架构参考（${parentName} / docs/01-brief.md）\n${pBrief}`);
      }
    }
  }

  const briefPath = path.join(absDir, 'docs', '01-brief.md');
  if (fs.existsSync(briefPath)) {
    const brief = fs.readFileSync(briefPath, 'utf8').trim();
    if (brief && brief.length < 12_000) {
      parts.push(`## 当前 docs/01-brief.md\n${brief}`);
    }
  }

  const recent = (discussion.messages || [])
    .filter((m) => m.content && !m.pending && m.status !== 'failed')
    .slice(-8);

  const attachCtx = readAttachmentsContext(discussion.attachments, { compact: recent.length >= 2 });
  if (attachCtx) {
    parts.push(`## 用户导入的参考文件\n${attachCtx}`);
  }

  if (recent.length) {
    const history = recent.map((m) => {
      const who = m.role === 'user' ? '【用户】' : `【${m.cliLabel || m.cli || '模型'}${m.model ? ` / ${m.model}` : ''}】`;
      const body = m.content.length > 6000 ? `${m.content.slice(0, 6000)}\n…(已省略中间过长内容)` : m.content;
      return `${who}\n${body}`;
    }).join('\n\n---\n\n');
    parts.push(`## 此前讨论记录\n${history}`);
  }

  parts.push(`## 本轮用户输入\n${userMessage}`);
  return parts.join('\n\n');
}

export function finalizePlanToBrief({ dir, planText, mode = 'replace', advanceToStage = 2 }) {
  const absDir = path.resolve(dir);
  const briefPath = path.join(absDir, 'docs', '01-brief.md');
  fs.mkdirSync(path.dirname(briefPath), { recursive: true });

  const cleanText = String(planText || '').trim();
  if (!cleanText) throw new Error('方案内容为空，无法写入 01-brief.md');

  if (mode === 'append' && fs.existsSync(briefPath)) {
    const prev = fs.readFileSync(briefPath, 'utf8').trimEnd();
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
    fs.writeFileSync(briefPath, `${prev}\n\n---\n\n## 定稿方案补充（${stamp}）\n\n${cleanText}\n`, 'utf8');
  } else {
    fs.writeFileSync(briefPath, `${cleanText}\n`, 'utf8');
  }

  const disc = readDiscussion(absDir);
  disc.planLocked = true;
  disc.lockedAt = new Date().toISOString();
  const savedDisc = saveDiscussion(absDir, disc);

  const patch = { gates: { g1: true } };
  if (advanceToStage && Number(advanceToStage) >= 1 && Number(advanceToStage) <= 5) {
    patch.stage = Number(advanceToStage);
  }
  const state = writeProjectState(absDir, patch);
  return { discussion: savedDisc, state };
}
