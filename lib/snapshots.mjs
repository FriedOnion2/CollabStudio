import { t } from './locale.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ALLOWED_DOCS } from './store.mjs';

const SNAPSHOT_DIR = '.collab-snapshots';
const MAX_SNAPSHOTS = 15;
const TRACKED_FILES = ['.collab-state.json', ...ALLOWED_DOCS.map((d) => d.key)];

function snapDir(projectDir) {
  return path.join(path.resolve(projectDir), SNAPSHOT_DIR);
}

export function createSnapshot(projectDir, { label = t("手动快照"), cli = '', runId = '' } = {}) {
  const absDir = path.resolve(projectDir);
  if (!fs.existsSync(absDir)) throw new Error(t("项目目录不存在"));

  const files = {};
  let fileCount = 0;
  for (const rel of TRACKED_FILES) {
    const full = path.join(absDir, rel);
    if (fs.existsSync(full)) {
      files[rel] = fs.readFileSync(full, 'utf8');
      fileCount += 1;
    } else {
      files[rel] = null;
    }
  }

  const id = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 6)}`;
  const snap = {
    id,
    label: String(label || t("运行前快照")).slice(0, 120),
    cli: String(cli || ''),
    runId: String(runId || ''),
    createdAt: new Date().toISOString(),
    fileCount,
    files
  };

  const dir = snapDir(absDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(snap, null, 2) + '\n', 'utf8');

  // Prune old snapshots beyond MAX_SNAPSHOTS
  try {
    const all = listSnapshots(absDir);
    if (all.length > MAX_SNAPSHOTS) {
      for (const old of all.slice(MAX_SNAPSHOTS)) {
        fs.rmSync(path.join(dir, `${old.id}.json`), { force: true });
      }
    }
  } catch {}

  return {
    id: snap.id,
    label: snap.label,
    cli: snap.cli,
    runId: snap.runId,
    createdAt: snap.createdAt,
    fileCount: snap.fileCount
  };
}

export function listSnapshots(projectDir) {
  const dir = snapDir(projectDir);
  if (!fs.existsSync(dir)) return [];
  const items = [];
  for (const name of fs.readdirSync(dir)) {
    if (!/^[a-z0-9]+-[a-f0-9]{6}\.json$/.test(name)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
      items.push({
        id: name.slice(0, -5),
        label: raw.label || t("快照"),
        cli: raw.cli || '',
        runId: raw.runId || '',
        createdAt: raw.createdAt || '',
        fileCount: raw.fileCount ?? Object.values(raw.files || {}).filter((v) => v !== null).length
      });
    } catch {}
  }
  items.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return items;
}

export function restoreSnapshot(projectDir, snapshotId) {
  const absDir = path.resolve(projectDir);
  if (!/^[a-z0-9]+-[a-f0-9]{6}$/.test(snapshotId)) throw new Error(t("无效快照 ID"));
  const fullSnapPath = path.join(snapDir(absDir), `${snapshotId}.json`);
  if (!fs.existsSync(fullSnapPath)) throw new Error(t("快照不存在"));

  const snap = JSON.parse(fs.readFileSync(fullSnapPath, 'utf8'));
  const backup = createSnapshot(absDir, { label: t("回退前自动备份（目标：{0}）", snap.label) });

  const restoredFiles = [];
  for (const [rel, content] of Object.entries(snap.files || {})) {
    if (!TRACKED_FILES.includes(rel)) continue;
    const target = path.join(absDir, rel);
    if (content === null) {
      if (fs.existsSync(target)) {
        fs.rmSync(target, { force: true });
        restoredFiles.push(`-${rel}`);
      }
    } else {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content, 'utf8');
      restoredFiles.push(rel);
    }
  }

  return {
    snapshotId: snap.id,
    label: snap.label,
    backupId: backup.id,
    restoredFiles
  };
}
