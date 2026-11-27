import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  ALLOWED_DOCS, loadRegistry, registerProject, unregisterProject,
  scaffoldProject, inspectProject, inspectScope, findParentProject,
  registerSubproject, unregisterSubproject, scanSubprojectCandidates, writeProjectState
} from './lib/store.mjs';
import { STAGES, buildPrompts } from './lib/prompts.mjs';
import {
  detectAllClis, saveCliConfig, listRuns,
  startInlineRun, launchExternalTerminal, stopRun, stopAllRuns, CLI_PROFILES
} from './lib/cli.mjs';
import {
  readDiscussion, addAttachmentPaths, addUploadedAttachments, removeAttachment,
  clearDiscussion, appendDiscussionMessage, updateDiscussionMessage,
  editDiscussionMessage, deleteDiscussionMessage, prepareRetryContext,
  buildDiscussionPrompt, finalizePlanToBrief
} from './lib/discussion.mjs';
import { createSnapshot, listSnapshots, restoreSnapshot } from './lib/snapshots.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 43980);
const AUTO_EXIT = process.env.NO_AUTO_EXIT !== '1';
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml'
};

const sseClients = new Set();
let shutdownTimer = null;

function broadcastEvent(payload) {
  const msg = `data: ${JSON.stringify(payload)}\n\n`;
  for (const client of sseClients) {
    try { client.write(msg); } catch { sseClients.delete(client); }
  }
}

function scheduleAutoExit() {
  if (!AUTO_EXIT) return;
  clearTimeout(shutdownTimer);
  shutdownTimer = setTimeout(() => {
    if (sseClients.size === 0) process.exit(0);
  }, 8000);
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 12_000_000) reject(new Error('Body too large')); });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

function isAllowedDoc(file) {
  return ALLOWED_DOCS.some((d) => d.key === file);
}

function pickFolderDialog() {
  if (process.platform !== 'win32') return Promise.resolve('');
  return new Promise((resolve) => {
    const ps = [
      'Add-Type -AssemblyName System.Windows.Forms;',
      '$f = New-Object System.Windows.Forms.FolderBrowserDialog;',
      '$f.Description = "选择或新建项目文件夹";',
      '$f.ShowNewFolderButton = $true;',
      'if ($f.ShowDialog() -eq "OK") { Write-Output $f.SelectedPath }'
    ].join(' ');
    execFile('powershell.exe', ['-NoProfile', '-STA', '-Command', ps], { windowsHide: true }, (err, stdout) => {
      resolve(err ? '' : stdout.trim());
    });
  });
}

function pickFilesDialog() {
  if (process.platform !== 'win32') return Promise.resolve([]);
  return new Promise((resolve) => {
    const ps = [
      'Add-Type -AssemblyName System.Windows.Forms;',
      '$f = New-Object System.Windows.Forms.OpenFileDialog;',
      '$f.Title = "选择要导入讨论的参考文件";',
      '$f.Multiselect = $true;',
      'if ($f.ShowDialog() -eq "OK") { $f.FileNames | ForEach-Object { Write-Output $_ } }'
    ].join(' ');
    execFile('powershell.exe', ['-NoProfile', '-STA', '-Command', ps], { windowsHide: true }, (err, stdout) => {
      if (err || !stdout) return resolve([]);
      resolve(stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean));
    });
  });
}

function collectExtraDirs(project, discussion = null) {
  const dirs = [];
  if (project?.parentDir) dirs.push(project.parentDir);
  if (discussion && Array.isArray(discussion.attachments)) {
    for (const att of discussion.attachments) {
      if (att?.path && fs.existsSync(att.path)) {
        dirs.push(path.dirname(path.resolve(att.path)));
      }
    }
  }
  return dirs;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
    const p = url.pathname;

    if (p === '/api/health') return sendJson(res, 200, { ok: true, pid: process.pid });

    if (p === '/api/events') {
      clearTimeout(shutdownTimer);
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write('data: {"type":"connected"}\n\n');
      sseClients.add(res);
      req.on('close', () => { sseClients.delete(res); if (sseClients.size === 0) scheduleAutoExit(); });
      return;
    }

    if (p === '/api/shutdown' && req.method === 'POST') {
      stopAllRuns();
      sendJson(res, 200, { ok: true });
      setTimeout(() => process.exit(0), 150);
      return;
    }

    if (p === '/api/cli/status' && req.method === 'GET') {
      const data = await detectAllClis({
        withVersion: url.searchParams.get('version') !== '0',
        withModels: true
      });
      return sendJson(res, 200, data);
    }

    if (p === '/api/cli/config' && req.method === 'PUT') {
      const body = await readBody(req);
      saveCliConfig(body || {});
      const data = await detectAllClis({ withVersion: true, withModels: true });
      return sendJson(res, 200, data);
    }

    if (p === '/api/cli/runs' && req.method === 'GET') {
      const dir = url.searchParams.get('dir') || '';
      return sendJson(res, 200, { runs: listRuns(dir) });
    }

    if (p === '/api/cli/run' && req.method === 'POST') {
      const { cli, dir, prompt, mode = 'inline', permissionMode = 'auto', model = '', effort = '' } = await readBody(req);
      const project = dir && fs.existsSync(dir) ? inspectScope(dir) : null;
      const disc = dir && fs.existsSync(dir) ? readDiscussion(dir) : null;
      const addDirs = collectExtraDirs(project, disc);
      const run = mode === 'terminal'
        ? await launchExternalTerminal({ cli, dir, prompt, permissionMode, model, effort, addDirs }, broadcastEvent)
        : await startInlineRun({ cli, dir, prompt, permissionMode, model, effort, addDirs }, broadcastEvent);
      return sendJson(res, 200, { run });
    }

    if (p === '/api/cli/stop' && req.method === 'POST') {
      const { runId } = await readBody(req);
      if (!runId) return sendJson(res, 400, { error: '缺少 runId 参数' });
      const run = stopRun(runId, broadcastEvent);
      return sendJson(res, 200, { run });
    }

    if (p === '/api/pick-files' && req.method === 'POST') {
      const paths = await pickFilesDialog();
      return sendJson(res, 200, { paths });
    }

    if (p === '/api/discussion' && req.method === 'GET') {
      const dir = url.searchParams.get('dir');
      if (!dir) return sendJson(res, 400, { error: '缺少 dir 参数' });
      return sendJson(res, 200, { discussion: readDiscussion(dir) });
    }

    if (p === '/api/discussion/attachments' && req.method === 'POST') {
      const { dir, paths = [], uploads = [] } = await readBody(req);
      if (!dir || !fs.existsSync(dir)) return sendJson(res, 404, { error: '项目目录不存在' });
      let discussion = readDiscussion(dir);
      if (Array.isArray(paths) && paths.length) discussion = addAttachmentPaths(dir, paths);
      if (Array.isArray(uploads) && uploads.length) discussion = addUploadedAttachments(dir, uploads);
      return sendJson(res, 200, { discussion });
    }

    if (p === '/api/discussion/attachments' && req.method === 'DELETE') {
      const dir = url.searchParams.get('dir');
      const id = url.searchParams.get('id');
      if (!dir || !id) return sendJson(res, 400, { error: '缺少参数' });
      const discussion = removeAttachment(dir, id);
      return sendJson(res, 200, { discussion });
    }

    if (p === '/api/discussion/clear' && req.method === 'POST') {
      const { dir, keepAttachments = true } = await readBody(req);
      if (!dir) return sendJson(res, 400, { error: '缺少 dir 参数' });
      const discussion = clearDiscussion(dir, { keepAttachments });
      return sendJson(res, 200, { discussion });
    }

    if (p === '/api/discussion/send' && req.method === 'POST') {
      const { dir, message, cli = 'antigravity', model = '', effort = '', permissionMode = 'auto' } = await readBody(req);
      if (!dir || !fs.existsSync(dir)) return sendJson(res, 404, { error: '项目目录不存在' });
      const text = String(message || '').trim();
      if (!text) return sendJson(res, 400, { error: '请先输入需求或讨论内容' });

      const project = inspectScope(dir);
      const beforeDisc = readDiscussion(dir);
      const addDirs = collectExtraDirs(project, beforeDisc);
      const fullPrompt = buildDiscussionPrompt({
        dir,
        projectName: project.state.name,
        userMessage: text,
        discussion: beforeDisc,
        parentDir: project.parentDir,
        parentName: project.parentName
      });

      const userMsg = appendDiscussionMessage(dir, {
        role: 'user',
        content: text,
        attachmentNames: beforeDisc.attachments.map((a) => a.name)
      });

      const cliLabel = CLI_PROFILES[cli]?.label || cli;
      const assistantMsg = appendDiscussionMessage(dir, {
        role: 'assistant',
        cli,
        cliLabel,
        model: String(model || '').trim(),
        effort: String(effort || '').trim(),
        pending: true,
        status: 'running',
        content: ''
      });

      try {
        const run = await startInlineRun({
          cli,
          dir,
          prompt: fullPrompt,
          permissionMode,
          model,
          effort,
          addDirs,
          kind: 'discussion',
          promptPreviewOverride: `[讨论] ${text}`,
          onComplete: (finishedRun) => {
            updateDiscussionMessage(dir, assistantMsg.id, {
              pending: false,
              status: finishedRun.status,
              exitCode: finishedRun.exitCode,
              runId: finishedRun.id,
              content: finishedRun.output?.trim() || `(执行结束，无文本输出，exit=${finishedRun.exitCode})`
            });
            broadcastEvent({ type: 'discussion:updated', dir: path.resolve(dir), msgId: assistantMsg.id, runId: finishedRun.id });
          }
        }, broadcastEvent);

        updateDiscussionMessage(dir, assistantMsg.id, { runId: run.id });
        return sendJson(res, 200, { discussion: readDiscussion(dir), userMsg, assistantMsg: { ...assistantMsg, runId: run.id }, run });
      } catch (err) {
        updateDiscussionMessage(dir, assistantMsg.id, {
          pending: false,
          status: 'failed',
          content: `启动失败：${err.message}`
        });
        throw err;
      }
    }

    if (p === '/api/discussion/finalize' && req.method === 'POST') {
      const { dir, planText, mode = 'replace', advanceToStage = 2 } = await readBody(req);
      if (!dir || !fs.existsSync(dir)) return sendJson(res, 404, { error: '项目目录不存在' });
      const result = finalizePlanToBrief({ dir, planText, mode, advanceToStage });
      return sendJson(res, 200, result);
    }

    if (p === '/api/discussion/message' && req.method === 'PATCH') {
      const { dir, msgId, content } = await readBody(req);
      if (!dir || !msgId) return sendJson(res, 400, { error: '缺少参数' });
      const discussion = editDiscussionMessage(dir, msgId, content);
      return sendJson(res, 200, { discussion });
    }

    if (p === '/api/discussion/message' && req.method === 'DELETE') {
      const dir = url.searchParams.get('dir');
      const id = url.searchParams.get('id');
      if (!dir || !id) return sendJson(res, 400, { error: '缺少参数' });
      const discussion = deleteDiscussionMessage(dir, id);
      return sendJson(res, 200, { discussion });
    }

    if (p === '/api/discussion/retry' && req.method === 'POST') {
      const { dir, msgId, cli = 'antigravity', model = '', effort = '', permissionMode = 'auto' } = await readBody(req);
      if (!dir || !fs.existsSync(dir)) return sendJson(res, 404, { error: '项目目录不存在' });
      if (!msgId) return sendJson(res, 400, { error: '缺少 msgId 参数' });

      const project = inspectScope(dir);
      const { discussionBefore, userMessage, replaceAssistantId } = prepareRetryContext(dir, msgId);
      const addDirs = collectExtraDirs(project, discussionBefore);
      const fullPrompt = buildDiscussionPrompt({
        dir,
        projectName: project.state.name,
        userMessage,
        discussion: discussionBefore,
        parentDir: project.parentDir,
        parentName: project.parentName
      });

      const cliLabel = CLI_PROFILES[cli]?.label || cli;
      let assistantMsg;
      if (replaceAssistantId) {
        assistantMsg = updateDiscussionMessage(dir, replaceAssistantId, {
          cli,
          cliLabel,
          model: String(model || '').trim(),
          effort: String(effort || '').trim(),
          pending: true,
          status: 'running',
          content: '',
          retriedAt: new Date().toISOString()
        });
      } else {
        assistantMsg = appendDiscussionMessage(dir, {
          role: 'assistant',
          cli,
          cliLabel,
          model: String(model || '').trim(),
          effort: String(effort || '').trim(),
          pending: true,
          status: 'running',
          content: ''
        });
      }

      try {
        const run = await startInlineRun({
          cli,
          dir,
          prompt: fullPrompt,
          permissionMode,
          model,
          effort,
          addDirs,
          kind: 'discussion',
          promptPreviewOverride: `[重试讨论] ${userMessage}`,
          onComplete: (finishedRun) => {
            updateDiscussionMessage(dir, assistantMsg.id, {
              pending: false,
              status: finishedRun.status,
              exitCode: finishedRun.exitCode,
              runId: finishedRun.id,
              content: finishedRun.output?.trim() || `(执行结束，无文本输出，exit=${finishedRun.exitCode})`
            });
            broadcastEvent({ type: 'discussion:updated', dir: path.resolve(dir), msgId: assistantMsg.id, runId: finishedRun.id });
          }
        }, broadcastEvent);

        updateDiscussionMessage(dir, assistantMsg.id, { runId: run.id });
        return sendJson(res, 200, { discussion: readDiscussion(dir), assistantMsg: { ...assistantMsg, runId: run.id }, run });
      } catch (err) {
        updateDiscussionMessage(dir, assistantMsg.id, {
          pending: false,
          status: 'failed',
          content: `重试失败：${err.message}`
        });
        throw err;
      }
    }

    if (p === '/api/snapshots' && req.method === 'GET') {
      const dir = url.searchParams.get('dir');
      if (!dir) return sendJson(res, 400, { error: '缺少 dir 参数' });
      return sendJson(res, 200, { snapshots: listSnapshots(dir) });
    }

    if (p === '/api/snapshots/create' && req.method === 'POST') {
      const { dir, label } = await readBody(req);
      if (!dir || !fs.existsSync(dir)) return sendJson(res, 404, { error: '项目目录不存在' });
      const snapshot = createSnapshot(dir, { label: label || '手动保存快照' });
      return sendJson(res, 200, { snapshot, snapshots: listSnapshots(dir) });
    }

    if (p === '/api/snapshots/restore' && req.method === 'POST') {
      const { dir, snapshotId } = await readBody(req);
      if (!dir || !fs.existsSync(dir)) return sendJson(res, 404, { error: '项目目录不存在' });
      if (!snapshotId) return sendJson(res, 400, { error: '缺少 snapshotId 参数' });
      const result = restoreSnapshot(dir, snapshotId);
      return sendJson(res, 200, { ...result, snapshots: listSnapshots(dir) });
    }

    if (p === '/api/pick-folder' && req.method === 'POST') {
      const selected = await pickFolderDialog();
      return sendJson(res, 200, { dir: selected });
    }

    if (p === '/api/open-folder' && req.method === 'POST') {
      const { target } = await readBody(req);
      if (!target || !fs.existsSync(target)) return sendJson(res, 404, { error: '路径不存在' });
      const cmd = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
      const child = spawn(cmd, [path.resolve(target)], { detached: true, stdio: 'ignore' });
      child.on('error', () => {});
      child.unref();
      return sendJson(res, 200, { ok: true });
    }

    if (p === '/api/projects' && req.method === 'GET') {
      const list = loadRegistry().map((item) => inspectProject(item.dir, item.name));
      return sendJson(res, 200, { stages: STAGES, projects: list });
    }

    if (p === '/api/projects/init' && req.method === 'POST') {
      const { dir, name, initScaffold = true } = await readBody(req);
      if (!dir || !dir.trim()) return sendJson(res, 400, { error: '请填写项目目录' });
      const absDir = path.resolve(dir.trim());
      if (initScaffold) await scaffoldProject(absDir, name);
      const entry = registerProject(absDir, name);
      const project = inspectProject(entry.dir, entry.name);
      return sendJson(res, 200, { project, prompts: buildPrompts(project) });
    }

    if (p === '/api/projects' && req.method === 'DELETE') {
      const dir = url.searchParams.get('dir');
      if (!dir) return sendJson(res, 400, { error: '缺少 dir 参数' });
      unregisterProject(dir);
      return sendJson(res, 200, { ok: true });
    }

    if (p === '/api/subprojects/scan' && req.method === 'GET') {
      const dir = url.searchParams.get('dir');
      if (!dir) return sendJson(res, 400, { error: '缺少 dir 参数' });
      const candidates = scanSubprojectCandidates(dir);
      return sendJson(res, 200, { candidates });
    }

    if (p === '/api/subprojects/add' && req.method === 'POST') {
      const { rootDir, items = [], initScaffold = true, includeRules = false } = await readBody(req);
      if (!rootDir) return sendJson(res, 400, { error: '缺少 rootDir 参数' });
      if (!Array.isArray(items) || !items.length) return sendJson(res, 400, { error: '请至少指定一个子项目' });
      const added = [];
      for (const item of items) {
        added.push(registerSubproject(rootDir, {
          relPath: item.relPath || item.dir,
          name: item.name,
          initScaffold,
          includeRules
        }));
      }
      const project = inspectProject(rootDir);
      return sendJson(res, 200, { project, added });
    }

    if (p === '/api/subprojects' && req.method === 'DELETE') {
      const rootDir = url.searchParams.get('rootDir');
      const relPath = url.searchParams.get('relPath');
      if (!rootDir || !relPath) return sendJson(res, 400, { error: '缺少参数' });
      unregisterSubproject(rootDir, relPath);
      return sendJson(res, 200, { project: inspectProject(rootDir) });
    }

    if (p === '/api/project' && req.method === 'GET') {
      const dir = url.searchParams.get('dir');
      const ms = url.searchParams.get('milestone') || '';
      if (!dir) return sendJson(res, 400, { error: '缺少 dir 参数' });
      const project = inspectScope(dir);
      const activeMs = ms || project.milestones.find((m) => m.doneCount < m.totalCount)?.title || project.milestones[0]?.title || 'Milestone 1';
      return sendJson(res, 200, { stages: STAGES, project, activeMilestone: activeMs, prompts: buildPrompts(project, activeMs) });
    }

    if (p === '/api/project/state' && req.method === 'PATCH') {
      const { dir, patch } = await readBody(req);
      if (!dir || !fs.existsSync(dir)) return sendJson(res, 404, { error: '项目目录不存在' });
      const state = writeProjectState(dir, patch || {});
      return sendJson(res, 200, { state });
    }

    if (p === '/api/doc' && req.method === 'GET') {
      const dir = url.searchParams.get('dir');
      const file = url.searchParams.get('file');
      if (!dir || !isAllowedDoc(file)) return sendJson(res, 400, { error: '无效文档路径' });
      const absDir = path.resolve(dir);
      const full = path.join(absDir, file);
      if (fs.existsSync(full)) {
        return sendJson(res, 200, { file, exists: true, inherited: false, content: fs.readFileSync(full, 'utf8') });
      }
      const docMeta = ALLOWED_DOCS.find((d) => d.key === file);
      if (docMeta?.isRule) {
        const parent = findParentProject(absDir);
        if (parent) {
          const parentFull = path.join(parent.parentDir, file);
          if (fs.existsSync(parentFull)) {
            return sendJson(res, 200, {
              file,
              exists: false,
              inherited: true,
              inheritedFrom: parent.parentName,
              content: fs.readFileSync(parentFull, 'utf8')
            });
          }
        }
      }
      return sendJson(res, 200, { file, exists: false, inherited: false, content: '' });
    }

    if (p === '/api/doc' && req.method === 'PUT') {
      const { dir, file, content } = await readBody(req);
      if (!dir || !isAllowedDoc(file)) return sendJson(res, 400, { error: '无效文档路径' });
      const full = path.join(path.resolve(dir), file);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, String(content ?? ''), 'utf8');
      return sendJson(res, 200, { ok: true });
    }

    const rel = p === '/' ? 'index.html' : p.replace(/^\/+/, '');
    const filePath = path.resolve(PUBLIC_DIR, rel);
    if (!filePath.startsWith(PUBLIC_DIR) || !fs.existsSync(filePath)) {
      res.writeHead(404); return res.end('Not Found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    sendJson(res, 500, { error: err.message || 'Internal Error' });
  }
});

server.on('close', stopAllRuns);

export function startServer(port = PORT, host = HOST) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const addr = server.address();
      const displayHost = host === '0.0.0.0' ? '127.0.0.1' : host;
      resolve({ server, port: addr.port, host, url: `http://${displayHost}:${addr.port}` });
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer(PORT, HOST).then(({ url, host, port }) => console.log(`CollabStudio listening on ${url} (bind ${host}:${port})`));
}
