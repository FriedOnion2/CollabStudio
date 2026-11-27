import { t } from './locale.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile, spawn } from 'node:child_process';

const IS_WIN = process.platform === 'win32';

const PREVIEW_MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.obj': 'text/plain; charset=utf-8',
  '.mtl': 'text/plain; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8'
};

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg', '.idea', '.vscode', '.cache',
  '__pycache__', '.venv', 'venv', 'coverage', 'target', '.collab-snapshots', '.collab-refs'
]);

const mountedDirs = new Map();
const activeScriptProcs = new Map();

export function mountPreviewDir(dir) {
  const absDir = fs.realpathSync(dir);
  const id = crypto.createHash('sha1').update(IS_WIN ? absDir.toLowerCase() : absDir).digest('hex').slice(0, 12);
  mountedDirs.set(id, absDir);
  return id;
}

export function resolvePreviewFile(mountId, rawRelPath) {
  const rootDir = mountedDirs.get(mountId);
  if (!rootDir || !fs.existsSync(rootDir)) return null;
  let decoded = '';
  try {
    decoded = decodeURIComponent(rawRelPath || '');
  } catch {
    return null;
  }
  const cleanRel = decoded.replace(/^\/+/, '');
  if (cleanRel.split(/[\\/]/).some(segment => segment.startsWith('.'))) return null;
  let full;
  try {
    full = fs.realpathSync(path.resolve(rootDir, cleanRel));
    if (fs.statSync(full).isDirectory()) full = fs.realpathSync(path.join(full, 'index.html'));
    const relative = path.relative(rootDir, full);
    if (path.isAbsolute(relative) || relative === '..' || relative.startsWith('..' + path.sep)
      || relative.split(path.sep).some(segment => segment.startsWith('.'))
      || !fs.statSync(full).isFile()) return null;
  } catch {
    return null;
  }
  const ext = path.extname(full).toLowerCase();
  return {
    full,
    mime: PREVIEW_MIME[ext] || 'application/octet-stream'
  };
}

function toPosix(p) {
  return String(p || '').replace(/\\/g, '/');
}

export function scanDeliverables(projectDir, previewOrigin = '') {
  const absDir = path.resolve(projectDir);
  if (!fs.existsSync(absDir)) throw new Error(t("项目目录不存在"));
  const mountId = mountPreviewDir(absDir);

  const htmlEntries = [];
  const recentFiles = [];

  function walk(cur, depth) {
    if (depth > 4) return;
    let list = [];
    try {
      list = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of list) {
      if (ent.name.startsWith('.')) continue;
      const full = path.join(cur, ent.name);
      if (ent.isDirectory()) {
        if (IGNORE_DIRS.has(ent.name.toLowerCase())) continue;
        walk(full, depth + 1);
        continue;
      }
      if (!ent.isFile()) continue;
      let stat;
      try { stat = fs.statSync(full); } catch { continue; }
      const rel = toPosix(path.relative(absDir, full));
      const lower = rel.toLowerCase();

      if (lower.endsWith('.html') || lower.endsWith('.htm')) {
        const group = lower.startsWith('prototypes/')
          ? 'prototype'
          : (lower.startsWith('dist/') || lower.startsWith('build/') ? 'build' : 'page');
        const priority = lower.endsWith('/index.html') || lower === 'index.html' ? 0 : 1;
        htmlEntries.push({
          relPath: rel,
          label: rel,
          group,
          priority,
          size: stat.size,
          mtime: stat.mtime.toISOString(),
          previewPath: `${previewOrigin}/preview/${mountId}/${rel.split('/').map(encodeURIComponent).join('/')}`
        });
      }

      if (!lower.startsWith('docs/') && !['agents.md', 'claude.md', 'gemini.md'].includes(lower)) {
        recentFiles.push({
          relPath: rel,
          size: stat.size,
          mtime: stat.mtime.toISOString(),
          mtimeMs: stat.mtimeMs
        });
      }
    }
  }

  walk(absDir, 0);

  htmlEntries.sort((a, b) => {
    const grpOrder = { prototype: 0, build: 1, page: 2 };
    if (grpOrder[a.group] !== grpOrder[b.group]) return grpOrder[a.group] - grpOrder[b.group];
    if (a.priority !== b.priority) return a.priority - b.priority;
    return b.mtime.localeCompare(a.mtime);
  });

  recentFiles.sort((a, b) => b.mtimeMs - a.mtimeMs);

  // Discover runnable scripts
  const scripts = [];
  const pkgPath = path.join(absDir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      const npmBin = IS_WIN ? 'npm.cmd' : 'npm';
      for (const [name, cmdStr] of Object.entries(pkg.scripts || {})) {
        scripts.push({
          id: `npm:${name}`,
          label: `npm run ${name}`,
          detail: String(cmdStr || '').slice(0, 80),
          cmd: npmBin,
          args: ['run', name],
          kind: /dev|start|serve|preview/i.test(name) ? 'server' : 'task'
        });
      }
    } catch {}
  }

  for (const relScript of ['tools/serve.mjs', 'tools/serve.js', 'serve.mjs', 'serve.js']) {
    if (fs.existsSync(path.join(absDir, relScript))) {
      scripts.unshift({
        id: `node:${relScript}`,
        label: `node ${relScript}`,
        detail: t("本地静态预览服务"),
        cmd: process.execPath,
        args: [relScript],
        kind: 'server'
      });
    }
  }

  const running = activeScriptProcs.get(absDir.toLowerCase());
  return {
    mountId,
    dir: absDir,
    htmlEntries,
    scripts,
    recentFiles: recentFiles.slice(0, 18).map(({ mtimeMs, ...rest }) => rest),
    activeScript: running
      ? { id: running.id, label: running.label, pid: running.pid, status: running.status, detectedUrl: running.detectedUrl, output: running.output }
      : null
  };
}

export function runDeliverableScript({ dir, scriptId }, broadcast) {
  const absDir = path.resolve(dir);
  const key = absDir.toLowerCase();
  const scan = scanDeliverables(absDir);
  const spec = scan.scripts.find((s) => s.id === scriptId);
  if (!spec) throw new Error(t("未找到脚本：{0}", scriptId));

  stopDeliverableScript(absDir, broadcast);

  const isCmd = IS_WIN && /\.(cmd|bat)$/i.test(spec.cmd);
  const spawnCmd = isCmd ? 'cmd.exe' : spec.cmd;
  const spawnArgs = isCmd ? ['/c', spec.cmd, ...spec.args] : spec.args;

  const entry = {
    id: spec.id,
    label: spec.label,
    dir: absDir,
    pid: null,
    status: 'running',
    detectedUrl: '',
    output: t("▸ 启动 {0} @ {1}\n", spec.label, absDir),
    child: null
  };

  const env = { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' };
  if (scriptId.startsWith('node:') && process.versions.electron) env.ELECTRON_RUN_AS_NODE = '1';
  const child = spawn(spawnCmd, spawnArgs, {
    cwd: absDir,
    env,
    windowsHide: true,
    detached: !IS_WIN,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  entry.pid = child.pid || null;
  entry.child = child;
  activeScriptProcs.set(key, entry);

  const pushChunk = (raw) => {
    if (activeScriptProcs.get(key) !== entry) return;
    const chunk = String(raw || '');
    if (!chunk) return;
    entry.output += chunk;
    if (entry.output.length > 80_000) entry.output = entry.output.slice(-80_000);
    if (!entry.detectedUrl) {
      const m = chunk.match(/https?:\/\/(?:127\.0\.0\.1|localhost|0\.0\.0\.0):\d+(?:\/[^\s"'<>]*)?/i);
      if (m) entry.detectedUrl = m[0].replace('0.0.0.0', '127.0.0.1');
    }
    broadcast({
      type: 'script:output',
      dir: absDir,
      id: entry.id,
      chunk,
      detectedUrl: entry.detectedUrl
    });
  };

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', pushChunk);
  child.stderr.on('data', pushChunk);

  child.on('error', (err) => {
    if (activeScriptProcs.get(key) !== entry) return;
    entry.status = 'failed';
    pushChunk(t("\n[启动失败] {0}\n", err.message));
    entry.exitCode = -1;
  });

  child.on('close', (code) => {
    if (activeScriptProcs.get(key) !== entry) return;
    if (entry.status === 'running') entry.status = code === 0 ? 'done' : 'failed';
    broadcast({ type: 'script:exit', dir: absDir, id: entry.id, status: entry.status, exitCode: entry.exitCode ?? code ?? -1, detectedUrl: entry.detectedUrl });
  });

  return {
    id: entry.id,
    label: entry.label,
    pid: entry.pid,
    status: entry.status,
    detectedUrl: entry.detectedUrl,
    output: entry.output
  };
}

export function stopDeliverableScript(dir, broadcast) {
  const key = path.resolve(dir).toLowerCase();
  const entry = activeScriptProcs.get(key);
  if (!entry) return { ok: true };
  entry.status = 'stopped';
  if (entry.child?.pid) {
    if (IS_WIN) {
      execFile('taskkill.exe', ['/PID', String(entry.child.pid), '/T', '/F'], { windowsHide: true }, () => {});
    } else {
      try { process.kill(-entry.child.pid, 'SIGTERM'); } catch {}
    }
  }
  activeScriptProcs.delete(key);
  if (broadcast) {
    broadcast({ type: 'script:exit', dir: entry.dir, id: entry.id, status: 'stopped', exitCode: 0, detectedUrl: entry.detectedUrl });
  }
  return { ok: true };
}

export function stopAllDeliverableScripts() {
  for (const [, entry] of activeScriptProcs.entries()) {
    if (entry.child?.pid) {
      if (IS_WIN) {
        execFile('taskkill.exe', ['/PID', String(entry.child.pid), '/T', '/F'], { windowsHide: true }, () => {});
      } else {
        try { process.kill(-entry.child.pid, 'SIGTERM'); } catch {}
      }
    }
  }
  activeScriptProcs.clear();
}

export function appendAcceptanceFeedback({ dir, target = '', note = '' }) {
  const absDir = path.resolve(dir);
  const text = String(note || '').trim();
  if (!text) throw new Error(t("请填写验收问题或反馈内容"));
  const reviewPath = path.join(absDir, 'docs', '05-review-log.md');
  fs.mkdirSync(path.dirname(reviewPath), { recursive: true });

  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const itemLine = t("- [{0}] 产物 `{1}`：{2}", stamp, target || t("交付预览"), text);

  if (!fs.existsSync(reviewPath)) {
    fs.writeFileSync(reviewPath, `# ${t("分级审查与防复发记录")}\n\n${t("## Antigravity 设计与文案验收单")}\n${itemLine}\n`, 'utf8');
    return { reviewPath, itemLine };
  }

  let content = fs.readFileSync(reviewPath, 'utf8');
  const heading = [
    '## Antigravity 设计与文案验收单',
    '## Antigravity design and copy acceptance'
  ].find(title => content.includes(title)) || t("## Antigravity 设计与文案验收单");
  const idx = content.indexOf(heading);
  if (idx >= 0) {
    const afterHeading = idx + heading.length;
    const nextSection = content.indexOf('\n## ', afterHeading);
    if (nextSection >= 0) {
      content = `${content.slice(0, nextSection).trimEnd()}\n${itemLine}\n${content.slice(nextSection)}`;
    } else {
      content = `${content.trimEnd()}\n${itemLine}\n`;
    }
  } else {
    content = `${content.trimEnd()}\n\n${heading}\n${itemLine}\n`;
  }
  fs.writeFileSync(reviewPath, content, 'utf8');
  return { reviewPath, itemLine };
}
