import { t } from './locale.mjs';
import { openMacTerminal } from './macos-terminal.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.COLLAB_DATA_DIR || path.resolve(__dirname, '../data');
const CLI_CONFIG_PATH = path.join(DATA_DIR, 'cli-config.json');

const HOME = os.homedir();
const IS_WIN = process.platform === 'win32';
const MAX_RUNS = 40;
const MAX_OUTPUT_CHARS = 400_000;

export const EFFORT_LEVELS = [
  { id: '', label: '默认强度' },
  { id: 'low', label: '低 (low)' },
  { id: 'medium', label: '中 (medium)' },
  { id: 'high', label: '高 (high)' },
  { id: 'xhigh', label: '极高 (xhigh)' },
  { id: 'max', label: '最大 (max)' }
];

export const CLI_PROFILES = {
  codex: {
    id: 'codex',
    label: 'Codex CLI',
    shortLabel: 'Codex',
    defaultCommand: 'codex',
    candidates: IS_WIN
      ? [
          path.join(HOME, '.codex', '.sandbox-bin', 'codex.EXE'),
          path.join(HOME, '.codex', 'plugins', '.plugin-appserver', 'codex.exe'),
          path.join(process.env.APPDATA || '', 'npm', 'codex.cmd'),
          path.join(HOME, '.local', 'bin', 'codex.exe')
        ]
      : [
          path.join(HOME, '.local', 'bin', 'codex'),
          '/usr/local/bin/codex',
          '/opt/homebrew/bin/codex'
        ]
  },
  claude: {
    id: 'claude',
    label: 'Claude CLI',
    shortLabel: 'Claude',
    defaultCommand: 'claude',
    candidates: IS_WIN
      ? [
          path.join(HOME, '.local', 'bin', 'claude.exe'),
          path.join(process.env.APPDATA || '', 'npm', 'claude.cmd'),
          path.join(process.env.LOCALAPPDATA || '', 'Programs', 'claude', 'claude.exe')
        ]
      : [
          path.join(HOME, '.local', 'bin', 'claude'),
          '/usr/local/bin/claude',
          '/opt/homebrew/bin/claude'
        ]
  },
  antigravity: {
    id: 'antigravity',
    label: 'Antigravity CLI',
    shortLabel: 'AGY',
    defaultCommand: 'agy',
    fallbackCommands: ['gemini'],
    candidates: IS_WIN
      ? [
          path.join(process.env.LOCALAPPDATA || '', 'agy', 'bin', 'agy.exe'),
          path.join(HOME, '.local', 'bin', 'agy.exe'),
          path.join(process.env.APPDATA || '', 'npm', 'gemini.cmd')
        ]
      : [
          path.join(HOME, '.local', 'bin', 'agy'),
          '/usr/local/bin/agy',
          '/opt/homebrew/bin/agy'
        ]
  }
};

const DEFAULT_CONFIG = () => ({
  codex: { path: '', extraArgs: '' },
  claude: { path: '', extraArgs: '' },
  antigravity: { path: '', extraArgs: '' }
});

const activeChildren = new Map();
const runHistory = [];
let cachedAgyModels = null;
let cachedAgyModelsAt = 0;

export function loadCliConfig() {
  const base = DEFAULT_CONFIG();
  try {
    if (!fs.existsSync(CLI_CONFIG_PATH)) return base;
    const raw = JSON.parse(fs.readFileSync(CLI_CONFIG_PATH, 'utf8'));
    for (const id of Object.keys(base)) {
      if (raw && typeof raw[id] === 'object') {
        base[id] = {
          path: String(raw[id].path || '').trim(),
          extraArgs: String(raw[id].extraArgs || '').trim()
        };
      }
    }
    return base;
  } catch {
    return base;
  }
}

export function saveCliConfig(patch) {
  const next = loadCliConfig();
  for (const id of Object.keys(CLI_PROFILES)) {
    if (patch && typeof patch[id] === 'object') {
      next[id] = {
        path: String(patch[id].path ?? next[id].path ?? '').trim(),
        extraArgs: String(patch[id].extraArgs ?? next[id].extraArgs ?? '').trim()
      };
    }
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CLI_CONFIG_PATH, JSON.stringify(next, null, 2) + '\n', 'utf8');
  return next;
}

function splitArgs(str = '') {
  const out = [];
  let cur = '';
  let quote = '';
  for (let i = 0; i < str.length; i += 1) {
    const ch = str[i];
    if (quote) {
      if (ch === quote) quote = '';
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (cur) { out.push(cur); cur = ''; }
    } else {
      cur += ch;
    }
  }
  if (cur) out.push(cur);
  return out;
}

function resolveInPath(cmd) {
  return new Promise((resolve) => {
    const finder = IS_WIN ? 'where.exe' : 'which';
    execFile(finder, [cmd], { windowsHide: true, timeout: 4000 }, (err, stdout) => {
      if (err || !stdout) return resolve('');
      const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const preferred = IS_WIN
        ? (lines.find((l) => /\.(exe|cmd|bat)$/i.test(l)) || lines[0] || '')
        : (lines[0] || '');
      resolve(preferred);
    });
  });
}

function probeVersion(exePath) {
  return new Promise((resolve) => {
    const isScript = IS_WIN && /\.(cmd|bat)$/i.test(exePath);
    const cmd = isScript ? 'cmd.exe' : exePath;
    const args = isScript ? ['/c', exePath, '--version'] : ['--version'];
    execFile(cmd, args, { windowsHide: true, timeout: 5000 }, (err, stdout, stderr) => {
      const text = `${stdout || ''}\n${stderr || ''}`.trim();
      const firstLine = text.split(/\r?\n/).map((l) => l.trim()).find(Boolean) || '';
      resolve(err && !firstLine ? '' : firstLine.slice(0, 80));
    });
  });
}

export async function resolveCli(cliId) {
  const profile = CLI_PROFILES[cliId];
  if (!profile) throw new Error(t("未知 CLI 类型：{0}", cliId));
  const cfg = loadCliConfig()[cliId] || { path: '', extraArgs: '' };

  let resolvedPath = '';
  let source = 'missing';

  if (cfg.path) {
    if (fs.existsSync(cfg.path)) {
      resolvedPath = cfg.path;
      source = 'custom';
    } else {
      const fromPath = await resolveInPath(cfg.path);
      if (fromPath) {
        resolvedPath = fromPath;
        source = 'custom';
      }
    }
  }

  if (!resolvedPath) {
    const cmds = [profile.defaultCommand, ...(profile.fallbackCommands || [])];
    for (const c of cmds) {
      const hit = await resolveInPath(c);
      if (hit) {
        resolvedPath = hit;
        source = 'path';
        break;
      }
    }
  }

  if (!resolvedPath) {
    for (const candidate of profile.candidates) {
      if (candidate && fs.existsSync(candidate)) {
        resolvedPath = candidate;
        source = 'auto';
        break;
      }
    }
  }

  return {
    id: profile.id,
    label: profile.label,
    shortLabel: profile.shortLabel,
    available: Boolean(resolvedPath),
    resolvedPath,
    source,
    configuredPath: cfg.path,
    extraArgs: cfg.extraArgs
  };
}

function readCodexConfiguredModel() {
  try {
    const p = path.join(HOME, '.codex', 'config.toml');
    if (!fs.existsSync(p)) return '';
    const txt = fs.readFileSync(p, 'utf8');
    const m = txt.match(/^\s*model\s*=\s*"([^"]+)"/m);
    return m ? m[1].trim() : '';
  } catch {
    return '';
  }
}

async function probeAgyModels(agyInfo) {
  const now = Date.now();
  if (cachedAgyModels && now - cachedAgyModelsAt < 10 * 60 * 1000) return cachedAgyModels;
  if (!agyInfo?.available || !/agy(\.exe)?$/i.test(agyInfo.resolvedPath)) return [];
  return new Promise((resolve) => {
    execFile(agyInfo.resolvedPath, ['models'], { windowsHide: true, timeout: 6000 }, (err, stdout) => {
      if (err || !stdout) return resolve(cachedAgyModels || []);
      const models = [];
      for (const line of stdout.split(/\r?\n/)) {
        const m = line.match(/^([a-zA-Z0-9._:-]+)\t+(.+)$/);
        if (m) models.push({ id: m[1].trim(), label: m[2].trim() });
      }
      if (models.length) {
        cachedAgyModels = models;
        cachedAgyModelsAt = Date.now();
      }
      resolve(models);
    });
  });
}

export async function getModelCatalog({ probeRemote = false } = {}) {
  const codexDefault = readCodexConfiguredModel();
  const codexModels = [
    { id: '', label: codexDefault ? t("默认 ({0})", codexDefault) : t("默认 (跟随 Codex 配置)") }
  ];
  const seenCodex = new Set(['']);
  for (const m of [codexDefault, 'gpt-6.2-astra', 'gpt-5.4', 'gpt-5.3-codex', 'o3']) {
    if (m && !seenCodex.has(m)) {
      seenCodex.add(m);
      codexModels.push({ id: m, label: m });
    }
  }

  const claudeModels = [
    { id: '', label: t("默认 (跟随 Claude 配置)") },
    { id: 'opus', label: t("Opus (最新旗舰)") },
    { id: 'sonnet', label: t("Sonnet (主力均衡)") },
    { id: 'haiku', label: t("Haiku (轻量高速)") }
  ];

  let agyList = cachedAgyModels || [];
  if (probeRemote || !agyList.length) {
    try {
      const agyInfo = await resolveCli('antigravity');
      const probed = await probeAgyModels(agyInfo);
      if (probed.length) agyList = probed;
    } catch {}
  }

  const agyFallback = [
    { id: 'gemini-4-neon-high', label: 'Gemini 4 Neon (High)' },
    { id: 'gemini-4-neon-xhigh', label: 'Gemini 4 Neon (XHigh)' },
    { id: 'gemini-4-carbon-high', label: 'Gemini 4 Carbon (High)' },
    { id: 'gemini-pro-orchestrator-neon', label: 'Orchestrator (Neon)' },
    { id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)' },
    { id: 'claude-opus-5-5-high', label: 'Claude Opus 5.5 (High)' },
    { id: 'claude-sonnet-5-5-high', label: 'Claude Sonnet 5.5 (High)' }
  ];

  const agyModels = [
    { id: '', label: t("默认 (跟随 AGY 配置)") },
    ...(agyList.length ? agyList : agyFallback)
  ];

  return {
    codex: codexModels,
    claude: claudeModels,
    antigravity: agyModels,
    efforts: EFFORT_LEVELS.map(({ id, label }) => ({ id, label: t(label) }))
  };
}

export async function detectAllClis({ withVersion = true, withModels = false } = {}) {
  const ids = Object.keys(CLI_PROFILES);
  const items = await Promise.all(ids.map(async (id) => {
    const info = await resolveCli(id);
    if (withVersion && info.available) {
      info.version = await probeVersion(info.resolvedPath);
    } else {
      info.version = '';
    }
    return info;
  }));
  if (withModels) {
    const catalog = await getModelCatalog({ probeRemote: true });
    return { clis: items, catalog };
  }
  return items;
}

function buildPermissionArgs(cliId, permissionMode) {
  if (permissionMode === 'auto') {
    if (cliId === 'codex') return ['--full-auto'];
    if (cliId === 'claude') return ['--permission-mode', 'acceptEdits'];
    if (cliId === 'antigravity') return ['--mode', 'accept-edits'];
  }
  if (permissionMode === 'bypass') {
    if (cliId === 'codex') return ['--dangerously-bypass-approvals-and-sandbox'];
    if (cliId === 'claude') return ['--dangerously-skip-permissions'];
    if (cliId === 'antigravity') return ['--dangerously-skip-permissions'];
  }
  return [];
}

function buildModelAndEffortArgs(cliId, { model = '', effort = '' } = {}) {
  const out = [];
  const m = String(model || '').trim();
  const e = String(effort || '').trim();
  if (cliId === 'codex') {
    if (m) out.push('-m', m);
    if (e) out.push('-c', `model_reasoning_effort="${e}"`);
  } else if (cliId === 'claude') {
    if (m) out.push('--model', m);
    if (e) out.push('--effort', e);
  } else if (cliId === 'antigravity') {
    if (m) out.push('--model', m);
    if (e) out.push('--effort', e);
  }
  return out;
}

function buildInlineInvocation(cliInfo, { dir, prompt, permissionMode = 'default', model = '', effort = '' }) {
  const extra = splitArgs(cliInfo.extraArgs);
  const perm = buildPermissionArgs(cliInfo.id, permissionMode);
  const modelEffort = buildModelAndEffortArgs(cliInfo.id, { model, effort });

  if (cliInfo.id === 'codex') {
    return {
      args: ['exec', '--skip-git-repo-check', '--color', 'never', '-C', dir, ...modelEffort, ...perm, ...extra, '-'],
      stdinText: prompt
    };
  }
  if (cliInfo.id === 'claude') {
    return {
      args: ['-p', ...modelEffort, ...perm, ...extra],
      stdinText: prompt
    };
  }
  return {
    args: [...modelEffort, ...perm, ...extra, '-p', prompt],
    stdinText: null
  };
}

function buildInteractiveArgs(cliInfo, { permissionMode = 'default', model = '', effort = '' }) {
  const extra = splitArgs(cliInfo.extraArgs);
  const perm = buildPermissionArgs(cliInfo.id, permissionMode);
  const modelEffort = buildModelAndEffortArgs(cliInfo.id, { model, effort });
  if (cliInfo.id === 'antigravity' && /agy(\.exe)?$/i.test(cliInfo.resolvedPath)) {
    return { preArgs: [...modelEffort, ...perm, ...extra, '-i'] };
  }
  return { preArgs: [...modelEffort, ...perm, ...extra] };
}

function summarizeRun(run) {
  return {
    id: run.id,
    cli: run.cli,
    cliLabel: run.cliLabel,
    model: run.model || '',
    effort: run.effort || '',
    kind: run.kind || 'production',
    mode: run.mode,
    permissionMode: run.permissionMode,
    dir: run.dir,
    promptPreview: run.promptPreview,
    commandDisplay: run.commandDisplay,
    status: run.status,
    exitCode: run.exitCode,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    output: run.output
  };
}

export function listRuns(dir) {
  const filtered = dir
    ? runHistory.filter((r) => r.dir.toLowerCase() === path.resolve(dir).toLowerCase())
    : runHistory;
  return filtered.map(summarizeRun);
}

export function getRun(runId) {
  const run = runHistory.find((r) => r.id === runId);
  return run ? summarizeRun(run) : null;
}

function pushRun(run) {
  runHistory.unshift(run);
  if (runHistory.length > MAX_RUNS) {
    const removed = runHistory.pop();
    if (removed && activeChildren.has(removed.id)) {
      runHistory.push(removed);
    }
  }
}

function appendOutput(run, chunk, broadcast) {
  if (!chunk) return;
  const text = String(chunk);
  run.output += text;
  if (run.output.length > MAX_OUTPUT_CHARS) {
    run.output = run.output.slice(run.output.length - MAX_OUTPUT_CHARS);
  }
  broadcast({ type: 'cli:output', runId: run.id, kind: run.kind, chunk: text });
}

export async function startInlineRun(
  { cli, dir, prompt, permissionMode = 'default', model = '', effort = '', kind = 'production', promptPreviewOverride = '', onComplete = null },
  broadcast
) {
  if (!dir || !fs.existsSync(dir)) throw new Error(t("项目目录不存在"));
  const absDir = path.resolve(dir);
  const text = String(prompt || '').trim();
  if (!text) throw new Error(t("执行指令不能为空"));

  const cliInfo = await resolveCli(cli);
  if (!cliInfo.available) {
    throw new Error(t("未检测到 {0}，请在「CLI 配置」中指定可执行文件路径", cliInfo.label));
  }

  const { args, stdinText } = buildInlineInvocation(cliInfo, { dir: absDir, prompt: text, permissionMode, model, effort });
  const isScript = IS_WIN && /\.(cmd|bat)$/i.test(cliInfo.resolvedPath);
  const spawnCmd = isScript ? 'cmd.exe' : cliInfo.resolvedPath;
  const spawnArgs = isScript ? ['/c', cliInfo.resolvedPath, ...args] : args;

  const displayArgs = args.map((a) => (a === text ? '"<prompt>"' : (/\s/.test(a) ? `"${a}"` : a))).join(' ');
  const run = {
    id: crypto.randomUUID().slice(0, 8),
    cli: cliInfo.id,
    cliLabel: cliInfo.label,
    model: String(model || '').trim(),
    effort: String(effort || '').trim(),
    kind,
    mode: 'inline',
    permissionMode,
    dir: absDir,
    promptPreview: (promptPreviewOverride || text.split(/\r?\n/)[0]).slice(0, 90),
    commandDisplay: `${path.basename(cliInfo.resolvedPath)} ${displayArgs}`.trim(),
    status: 'running',
    exitCode: null,
    startedAt: new Date().toISOString(),
    endedAt: null,
    output: ''
  };
  pushRun(run);
  broadcast({ type: 'cli:start', run: summarizeRun(run) });

  const env = { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', TERM: 'dumb' };
  const child = spawn(spawnCmd, spawnArgs, {
    cwd: absDir,
    env,
    windowsHide: true,
    detached: !IS_WIN,
    stdio: ['pipe', 'pipe', 'pipe']
  });
  activeChildren.set(run.id, child);

  child.stdin.on('error', () => {});
  if (stdinText != null) {
    child.stdin.write(stdinText, 'utf8');
  }
  child.stdin.end();

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => appendOutput(run, chunk, broadcast));
  child.stderr.on('data', (chunk) => appendOutput(run, chunk, broadcast));

  const finish = () => {
    if (onComplete) {
      try { onComplete(summarizeRun(run)); } catch {}
    }
    broadcast({ type: 'cli:exit', run: summarizeRun(run) });
  };

  child.on('error', (err) => {
    activeChildren.delete(run.id);
    appendOutput(run, t("\n[CollabStudio 错误] 启动失败: {0}\n", err.message), broadcast);
    run.status = 'failed';
    run.exitCode = -1;
    run.endedAt = new Date().toISOString();
    finish();
  });

  child.on('close', (code, signal) => {
    activeChildren.delete(run.id);
    if (run.status === 'running') {
      run.status = code === 0 ? 'done' : 'failed';
    }
    run.exitCode = code ?? (signal ? -1 : 0);
    run.endedAt = new Date().toISOString();
    finish();
  });

  return summarizeRun(run);
}

export async function launchExternalTerminal(
  { cli, dir, prompt, permissionMode = 'default', model = '', effort = '' },
  broadcast
) {
  if (!dir || !fs.existsSync(dir)) throw new Error(t("项目目录不存在"));
  const absDir = path.resolve(dir);
  const text = String(prompt || '').trim();

  const cliInfo = await resolveCli(cli);
  if (!cliInfo.available) {
    throw new Error(t("未检测到 {0}，请在「CLI 配置」中指定可执行文件路径", cliInfo.label));
  }

  const { preArgs } = buildInteractiveArgs(cliInfo, { permissionMode, model, effort });
  const runId = crypto.randomUUID().slice(0, 8);

  if (IS_WIN) {
    const tmpDir = path.join(os.tmpdir(), 'collabstudio-cli');
    fs.mkdirSync(tmpDir, { recursive: true });
    const promptFile = path.join(tmpDir, `prompt-${runId}.txt`);
    const scriptFile = path.join(tmpDir, `launch-${runId}.ps1`);
    fs.writeFileSync(promptFile, text, 'utf8');

    const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`;
    const argExpr = preArgs.map(psQuote).join(', ');
    const psLines = [
      `$OutputEncoding = [Console]::OutputEncoding = [System.Text.Encoding]::UTF8`,
      `Set-Location -LiteralPath ${psQuote(absDir)}`,
      `$prompt = [System.IO.File]::ReadAllText(${psQuote(promptFile)}, [System.Text.Encoding]::UTF8).Trim()`,
      `Remove-Item -LiteralPath ${psQuote(promptFile)} -ErrorAction SilentlyContinue`,
      `$exe = ${psQuote(cliInfo.resolvedPath)}`,
      `$cliArgs = @(${argExpr})`,
      `if ($prompt) { $cliArgs += $prompt }`,
      `Write-Host ${psQuote(t("[CollabStudio] 启动 {0} @ {1}", cliInfo.label, absDir))} -ForegroundColor Cyan`,
      `& $exe @cliArgs`
    ];
    fs.writeFileSync(scriptFile, '\uFEFF' + psLines.join('\r\n') + '\r\n', 'utf8');

    const wtPath = await resolveInPath('wt.exe');
    const title = `CollabStudio - ${cliInfo.shortLabel}`;
    const child = wtPath
      ? spawn(wtPath, ['new-tab', '--title', title, '-d', absDir, 'powershell.exe', '-NoLogo', '-NoExit', '-ExecutionPolicy', 'Bypass', '-File', scriptFile], {
          detached: true,
          stdio: 'ignore'
        })
      : spawn('cmd.exe', ['/c', 'start', title, 'powershell.exe', '-NoLogo', '-NoExit', '-ExecutionPolicy', 'Bypass', '-File', scriptFile], {
          cwd: absDir,
          detached: true,
          stdio: 'ignore'
        });
    child.on('error', () => {});
    child.unref();
  } else if (process.platform === 'darwin') {
    await openMacTerminal({
      cwd: absDir,
      executable: cliInfo.resolvedPath,
      args: text ? [...preArgs, text] : preArgs
    });
  } else {
    throw new Error(t("当前平台不支持外部终端，请使用「内置直跑」"));
  }

  const run = {
    id: runId,
    cli: cliInfo.id,
    cliLabel: cliInfo.label,
    model: String(model || '').trim(),
    effort: String(effort || '').trim(),
    kind: 'production',
    mode: 'terminal',
    permissionMode,
    dir: absDir,
    promptPreview: text ? text.split(/\r?\n/)[0].slice(0, 90) : t("(空白交互会话)"),
    commandDisplay: t("[外部终端] {0} {1}", path.basename(cliInfo.resolvedPath), preArgs.join(' ')).trim(),
    status: 'launched',
    exitCode: 0,
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    output: t("已在外部终端启动 {0}\n工作目录：{1}\n可执行文件：{2}\n模型：{3} | 思考强度：{4}\n", cliInfo.label, absDir, cliInfo.resolvedPath, model || t("默认"), effort || t("默认"))
  };
  pushRun(run);
  broadcast({ type: 'cli:start', run: summarizeRun(run) });
  broadcast({ type: 'cli:exit', run: summarizeRun(run) });
  return summarizeRun(run);
}

export function stopRun(runId, broadcast) {
  const child = activeChildren.get(runId);
  const run = runHistory.find((r) => r.id === runId);
  if (!run) throw new Error(t("任务不存在"));
  if (!child) return summarizeRun(run);

  run.status = 'stopped';
  appendOutput(run, t("\n[CollabStudio] 已手动终止该 CLI 任务。\n"), broadcast);

  terminateChild(child);
  return summarizeRun(run);
}

function terminateChild(child) {
  if (!child.pid) return;
  if (IS_WIN) {
    execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
  } else {
    try { process.kill(-child.pid, 'SIGTERM'); } catch {}
  }
}

export function stopAllRuns() {
  for (const child of activeChildren.values()) terminateChild(child);
  activeChildren.clear();
}
