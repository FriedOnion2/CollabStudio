import { t } from './locale.mjs';
import { openMacTerminal } from './macos-terminal.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createSnapshot } from './snapshots.mjs';

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
          path.join(HOME, '.codex', 'plugins', '.plugin-appserver', 'codex.exe'),
          path.join(process.env.APPDATA || '', 'npm', 'codex.cmd'),
          path.join(HOME, '.local', 'bin', 'codex.exe'),
          path.join(HOME, '.codex', '.sandbox-bin', 'codex.EXE')
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

function nowTimeTag() {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false });
}

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
    if (cliId === 'codex') return ['-s', 'workspace-write', '-c', 'approval_policy="never"'];
    if (cliId === 'claude') return ['--permission-mode', 'auto'];
    if (cliId === 'antigravity') return ['--mode', 'auto'];
  }
  if (permissionMode === 'bypass') {
    if (cliId === 'codex') return ['--dangerously-bypass-approvals-and-sandbox'];
    if (cliId === 'claude') return ['--dangerously-skip-permissions'];
    if (cliId === 'antigravity') return ['--dangerously-skip-permissions'];
  }
  return [];
}

function buildAddDirArgs(cliId, primaryDir, extraDirs = []) {
  if (!Array.isArray(extraDirs) || !extraDirs.length) return [];
  const normPrimary = path.resolve(primaryDir).toLowerCase();
  const seen = new Set([normPrimary]);
  const out = [];
  for (const raw of extraDirs) {
    if (!raw) continue;
    const abs = path.resolve(String(raw));
    const key = abs.toLowerCase();
    if (seen.has(key) || !fs.existsSync(abs)) continue;
    seen.add(key);
    if (cliId === 'codex' || cliId === 'claude' || cliId === 'antigravity') {
      out.push('--add-dir', abs);
    }
  }
  return out;
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

function buildInlineInvocation(cliInfo, { dir, prompt, permissionMode = 'auto', model = '', effort = '', addDirs = [] }) {
  const extra = splitArgs(cliInfo.extraArgs);
  const perm = buildPermissionArgs(cliInfo.id, permissionMode);
  const dirArgs = buildAddDirArgs(cliInfo.id, dir, addDirs);
  const modelEffort = buildModelAndEffortArgs(cliInfo.id, { model, effort });

  if (cliInfo.id === 'codex') {
    return {
      protocol: 'codex-json',
      args: ['exec', '--json', '--skip-git-repo-check', '-C', dir, ...dirArgs, ...modelEffort, ...perm, ...extra, '-'],
      stdinText: prompt
    };
  }
  if (cliInfo.id === 'claude') {
    return {
      protocol: 'claude-json',
      args: ['-p', '--verbose', '--output-format', 'stream-json', '--include-partial-messages', ...dirArgs, ...modelEffort, ...perm, ...extra],
      stdinText: prompt
    };
  }
  if (/agy(\.exe)?$/i.test(cliInfo.resolvedPath)) {
    return {
      protocol: 'agy-json',
      args: [...modelEffort, ...perm, ...extra, '--input-format', 'stream-json', '--output-format', 'stream-json'],
      stdinText: JSON.stringify({ event: 'user', message: { content: prompt } }) + '\n'
    };
  }
  // Gemini enters headless mode when stdin is piped.
  const geminiModel = model ? ['--model', model] : [];
  const approval = permissionMode === 'auto' ? ['--approval-mode', 'auto_edit']
    : permissionMode === 'bypass' ? ['--approval-mode', 'yolo'] : [];
  return {
    protocol: 'raw',
    args: [...geminiModel, ...approval, ...extra],
    stdinText: prompt
  };
}

function buildInteractiveArgs(cliInfo, { dir = '', permissionMode = 'auto', model = '', effort = '', addDirs = [] }) {
  const extra = splitArgs(cliInfo.extraArgs);
  const perm = buildPermissionArgs(cliInfo.id, permissionMode);
  const dirArgs = dir ? buildAddDirArgs(cliInfo.id, dir, addDirs) : [];
  const modelEffort = buildModelAndEffortArgs(cliInfo.id, { model, effort });
  if (cliInfo.id === 'antigravity' && /agy(\.exe)?$/i.test(cliInfo.resolvedPath)) {
    return { preArgs: [...dirArgs, ...modelEffort, ...perm, ...extra, '-i'] };
  }
  return { preArgs: [...dirArgs, ...modelEffort, ...perm, ...extra] };
}

function summarizeRun(run) {
  return {
    id: run.id,
    pid: run.pid || null,
    cli: run.cli,
    cliLabel: run.cliLabel,
    model: run.model || '',
    effort: run.effort || '',
    kind: run.kind || 'production',
    mode: run.mode,
    permissionMode: run.permissionMode,
    dir: run.dir,
    prompt: run.prompt || '',
    promptPreview: run.promptPreview,
    commandDisplay: run.commandDisplay,
    snapshotId: run.snapshotId || null,
    needsPermission: Boolean(run.needsPermission),
    status: run.status,
    activity: run.activity || '',
    activityLog: run.activityLog || [],
    usage: run.usage || null,
    exitCode: run.exitCode,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    output: run.output,
    consoleLog: run.consoleLog
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

function appendConsole(run, text, broadcast) {
  if (!text) return;
  const s = String(text);
  run.consoleLog += s;
  if (run.consoleLog.length > MAX_OUTPUT_CHARS) {
    run.consoleLog = run.consoleLog.slice(run.consoleLog.length - MAX_OUTPUT_CHARS);
  }
  broadcast({ type: 'cli:console', runId: run.id, chunk: s });
}

function setActivity(run, text, broadcast, { logToConsole = true } = {}) {
  const clean = String(text || '').trim();
  if (!clean) return;
  if (run.status === 'stopped') return;
  const prev = run.activity;
  run.activity = clean;
  if (clean !== prev) {
    const line = `[${nowTimeTag()}] ${clean}`;
    run.activityLog.push(line);
    if (run.activityLog.length > 60) run.activityLog.shift();
    if (logToConsole) appendConsole(run, `\n▸ ${line}\n`, broadcast);
  }
  broadcast({
    type: 'cli:activity',
    runId: run.id,
    kind: run.kind,
    pid: run.pid,
    activity: run.activity,
    needsPermission: Boolean(run.needsPermission),
    usage: run.usage
  });
}

function appendTextDelta(run, chunk, broadcast) {
  if (!chunk) return;
  const text = String(chunk);
  run.output += text;
  if (run.output.length > MAX_OUTPUT_CHARS) {
    run.output = run.output.slice(run.output.length - MAX_OUTPUT_CHARS);
  }
  run.consoleLog += text;
  if (run.consoleLog.length > MAX_OUTPUT_CHARS) {
    run.consoleLog = run.consoleLog.slice(run.consoleLog.length - MAX_OUTPUT_CHARS);
  }
  broadcast({ type: 'cli:output', runId: run.id, kind: run.kind, chunk: text });
}

function createStreamParser(protocol, run, broadcast, onTerminalEvent = null) {
  let lineBuf = '';
  let streamedAnyText = false;

  function fail(text) {
    run.reportedFailure = text;
    appendConsole(run, `\n${text}\n`, broadcast);
    setActivity(run, text, broadcast, { logToConsole: false });
    if (onTerminalEvent) onTerminalEvent(true);
  }

  function complete(suffix) {
    run.reportedCompletion = true;
    setActivity(run, t("已完成") + suffix, broadcast);
    if (onTerminalEvent) onTerminalEvent(false);
  }

  function handleJsonEvent(obj) {
    if (protocol === 'agy-json') {
      if (obj.event === 'init') {
        setActivity(run, t("已连接 Antigravity CLI，正在分析上下文…"), broadcast);
        return;
      }
      if (obj.event === 'step_update' && obj.step_update) {
        const su = obj.step_update;
        const stype = String(su.step_type || '');
        if (su.usage) run.usage = su.usage;
        if (su.text_delta) {
          if (!streamedAnyText) {
            setActivity(run, t("正在实时输出回复…"), broadcast);
            streamedAnyText = true;
          }
          appendTextDelta(run, su.text_delta, broadcast);
        } else if (su.thinking_delta || stype.includes('think') || stype.includes('plan')) {
          setActivity(run, t("深度思考中…"), broadcast, { logToConsole: run.activity !== t("深度思考中…") });
        } else if (stype && stype !== 'user_input' && stype !== 'agent_response') {
          const toolName = su.tool_name || su.name || stype;
          if (/permission|approval/i.test(`${stype} ${toolName}`)) {
            run.needsPermission = true;
            setActivity(run, t("⚠️ 卡在权限审批 ({0})，建议点「免确认重试」或切外部终端", toolName), broadcast);
          } else {
            setActivity(run, t("正在执行步骤：{0}", toolName), broadcast);
          }
        }
        return;
      }
      if (obj.event === 'result' && obj.result) {
        const res = obj.result;
        if (res.usage) run.usage = res.usage;
        if (res.status === 'ERROR') {
          fail(t("执行失败：{0}", res.error || 'Antigravity CLI'));
        } else {
          if (!streamedAnyText && res.response) {
            appendTextDelta(run, res.response, broadcast);
          }
          const tok = res.usage?.total_tokens ? ` · Tokens ${res.usage.total_tokens}` : '';
          const sec = res.duration_seconds ? t(" · 用时 {0}s", res.duration_seconds.toFixed(1)) : '';
          complete(sec + tok);
        }
        return;
      }
      return;
    }

    if (protocol === 'claude-json') {
      if (obj.type === 'system' && obj.subtype === 'init') {
        const m = obj.model ? ` (${obj.model})` : '';
        setActivity(run, t("已连接 Claude CLI{0}，开始思考…", m), broadcast);
        return;
      }
      if (obj.type === 'stream_event' && obj.event) {
        const ev = obj.event;
        if (ev.type === 'content_block_start' && ev.content_block) {
          if (ev.content_block.type === 'thinking') {
            setActivity(run, t("深度思考中…"), broadcast);
          } else if (ev.content_block.type === 'tool_use') {
            setActivity(run, t("正在调用工具：{0}", ev.content_block.name || 'tool'), broadcast);
          } else if (ev.content_block.type === 'text' && !streamedAnyText) {
            setActivity(run, t("正在实时输出回复…"), broadcast);
          }
        } else if (ev.type === 'content_block_delta' && ev.delta) {
          if (ev.delta.type === 'text_delta' && ev.delta.text) {
            if (!streamedAnyText) {
              setActivity(run, t("正在实时输出回复…"), broadcast);
              streamedAnyText = true;
            }
            appendTextDelta(run, ev.delta.text, broadcast);
          } else if (ev.delta.type === 'thinking_delta') {
            if (run.activity !== t("深度思考中…")) {
              setActivity(run, t("深度思考中…"), broadcast);
            }
          }
        }
        return;
      }
      if (obj.type === 'assistant' && !streamedAnyText && Array.isArray(obj.message?.content)) {
        const txt = obj.message.content.filter((b) => b.type === 'text' && b.text).map((b) => b.text).join('');
        if (txt) {
          streamedAnyText = true;
          appendTextDelta(run, txt, broadcast);
        }
        return;
      }
      if (obj.type === 'result') {
        if (obj.usage) {
          const total = (obj.usage.input_tokens || 0) + (obj.usage.output_tokens || 0);
          run.usage = { ...obj.usage, total_tokens: total };
        }
        if (obj.is_error) {
          fail(t("执行失败：{0}", obj.result || 'Claude CLI'));
        } else if (!streamedAnyText && obj.result) {
          appendTextDelta(run, obj.result, broadcast);
        }
        const dur = obj.duration_ms ? t(" · 用时 {0}s", (obj.duration_ms / 1000).toFixed(1)) : '';
        const tok = run.usage?.total_tokens ? ` · Tokens ${run.usage.total_tokens}` : '';
        if (!obj.is_error) complete(dur + tok);
        return;
      }
      return;
    }

    if (protocol === 'codex-json') {
      if (obj.type === 'thread.started') {
        setActivity(run, t("已连接 Codex CLI，准备执行…"), broadcast);
        return;
      }
      if (obj.type === 'turn.started') {
        setActivity(run, t("Codex 正在思考与分析代码…"), broadcast);
        return;
      }
      if (obj.type === 'item.started' && obj.item) {
        const it = obj.item;
        if (it.type === 'reasoning') setActivity(run, t("深度思考中…"), broadcast);
        else if (it.type === 'command_execution') setActivity(run, t("正在执行命令：{0}", (it.command || '').slice(0, 60)), broadcast);
        else if (it.type === 'mcp_tool_call') setActivity(run, t("正在调用工具：{0}", it.tool || 'mcp'), broadcast);
        else if (it.type === 'file_change') setActivity(run, t("正在修改文件…"), broadcast);
        return;
      }
      if (obj.type === 'item.completed' && obj.item) {
        const it = obj.item;
        if (it.type === 'agent_message' && it.text) {
          streamedAnyText = true;
          const prefix = run.output ? '\n\n' : '';
          appendTextDelta(run, prefix + it.text, broadcast);
          setActivity(run, t("收到回复输出"), broadcast, { logToConsole: false });
        } else if (it.type === 'command_execution') {
          appendConsole(run, t("\n[命令完成] {0} (exit={1})\n", it.command || '', it.exit_code ?? 0), broadcast);
        } else if (it.type === 'error' && it.message) {
          appendConsole(run, t("\n[Codex 提示] {0}\n", it.message), broadcast);
        }
        return;
      }
      if (obj.type === 'turn.completed') {
        if (obj.usage) {
          const total = (obj.usage.input_tokens || 0) + (obj.usage.output_tokens || 0);
          run.usage = { ...obj.usage, total_tokens: total };
        }
        const tok = run.usage?.total_tokens ? ` · Tokens ${run.usage.total_tokens}` : '';
        complete(tok);
        return;
      }
      if (obj.type === 'turn.failed') {
        fail(t("执行失败：{0}", obj.error?.message || 'Codex CLI'));
      } else if (obj.type === 'error' && obj.message) {
        appendConsole(run, `\n${t("执行失败：{0}", obj.message)}\n`, broadcast);
      }
    }
  }

  return {
    pushStdout(chunk) {
      if (protocol === 'raw') {
        appendTextDelta(run, chunk, broadcast);
        return;
      }
      lineBuf += chunk;
      let idx = lineBuf.indexOf('\n');
      while (idx >= 0) {
        const line = lineBuf.slice(0, idx).trim();
        lineBuf = lineBuf.slice(idx + 1);
        if (line) {
          try {
            handleJsonEvent(JSON.parse(line));
          } catch {
            appendTextDelta(run, line + '\n', broadcast);
          }
        }
        idx = lineBuf.indexOf('\n');
      }
    },
    flush() {
      const rem = lineBuf.trim();
      lineBuf = '';
      if (!rem) return;
      if (protocol === 'raw') {
        appendTextDelta(run, rem, broadcast);
        return;
      }
      try {
        handleJsonEvent(JSON.parse(rem));
      } catch {
        appendTextDelta(run, rem + '\n', broadcast);
      }
    }
  };
}

export async function startInlineRun(
  { cli, dir, prompt, permissionMode = 'auto', model = '', effort = '', addDirs = [], kind = 'production', promptPreviewOverride = '', onComplete = null },
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

  const { protocol, args, stdinText } = buildInlineInvocation(cliInfo, { dir: absDir, prompt: text, permissionMode, model, effort, addDirs });
  const isScript = IS_WIN && /\.(cmd|bat)$/i.test(cliInfo.resolvedPath);
  const spawnCmd = isScript ? 'cmd.exe' : cliInfo.resolvedPath;
  const spawnArgs = isScript ? ['/c', cliInfo.resolvedPath, ...args] : args;

  const runId = crypto.randomUUID().slice(0, 8);
  let snapshotId = null;
  if (kind !== 'discussion') {
    try {
      const snap = createSnapshot(absDir, {
        label: t("运行 {0} 前自动快照", cliInfo.shortLabel),
        cli: cliInfo.id,
        runId
      });
      snapshotId = snap.id;
    } catch {}
  }

  const displayArgs = args.map((a) => (a === text ? '"<prompt>"' : (/\s/.test(a) ? `"${a}"` : a))).join(' ');
  const run = {
    id: runId,
    pid: null,
    cli: cliInfo.id,
    cliLabel: cliInfo.label,
    model: String(model || '').trim(),
    effort: String(effort || '').trim(),
    kind,
    mode: 'inline',
    permissionMode,
    dir: absDir,
    prompt: text,
    promptPreview: (promptPreviewOverride || text.split(/\r?\n/)[0]).slice(0, 90),
    commandDisplay: `${path.basename(cliInfo.resolvedPath)} ${displayArgs}`.trim(),
    snapshotId,
    status: 'running',
    activity: t("正在启动 {0}…", cliInfo.label),
    activityLog: [t("[{0}] 正在启动 {1}（指令长度 {2} 字符）", nowTimeTag(), cliInfo.label, text.length)],
    usage: null,
    exitCode: null,
    startedAt: new Date().toISOString(),
    endedAt: null,
    output: '',
    consoleLog: (snapshotId ? t("已创建运行前快照 {0}\n", snapshotId) : '') + t("▸ [{0}] 启动 {1} @ {2}（指令 {3} 字）\n", nowTimeTag(), cliInfo.label, absDir, text.length)
  };
  pushRun(run);

  let child;
  try {
    const env = { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', TERM: 'dumb' };
    child = spawn(spawnCmd, spawnArgs, {
      cwd: absDir,
      env,
      windowsHide: true,
      detached: !IS_WIN,
      stdio: ['pipe', 'pipe', 'pipe']
    });
  } catch (err) {
    run.status = 'failed';
    run.exitCode = -1;
    run.endedAt = new Date().toISOString();
    run.activity = t("启动失败：{0}", err.message);
    run.output = t("启动失败：{0}", err.message);
    run.consoleLog += t("\n[CollabStudio 错误] 启动失败: {0}\n", err.message);
    broadcast({ type: 'cli:start', run: summarizeRun(run) });
    broadcast({ type: 'cli:exit', run: summarizeRun(run) });
    throw err;
  }

  run.pid = child.pid || null;
  run.activity = t("进程已启动 (PID {0})，等待 CLI 响应…", run.pid || '?');
  activeChildren.set(run.id, child);
  broadcast({ type: 'cli:start', run: summarizeRun(run) });

  let settled = false;
  let exitFallbackTimer = null;
  let resultFinalizeTimer = null;
  let stderr = '';
  const resultGraceMs = Math.max(500, Number(process.env.COLLAB_RESULT_GRACE_MS || 5000));

  const onTerminalEvent = (isFailure) => {
    if (settled || resultFinalizeTimer) return;
    resultFinalizeTimer = setTimeout(() => {
      if (settled) return;
      terminateChild(child);
      finalize(isFailure ? 1 : 0, null);
    }, resultGraceMs);
  };

  const parser = createStreamParser(protocol, run, broadcast, onTerminalEvent);

  const finalize = (code, signal, errMsg = '') => {
    if (settled) return;
    settled = true;
    clearTimeout(exitFallbackTimer);
    clearTimeout(resultFinalizeTimer);
    activeChildren.delete(run.id);
    parser.flush();
    child.stdout.destroy();
    child.stderr.destroy();

    if (errMsg) {
      appendConsole(run, t("\n[CollabStudio 错误] {0}\n", errMsg), broadcast);
      if (!run.output) run.output = t("执行失败：{0}", errMsg);
      run.status = 'failed';
      run.activity = t("启动失败：{0}", errMsg);
      run.exitCode = -1;
    } else {
      if (run.status === 'running') {
        run.status = code === 0 && !run.reportedFailure ? 'done' : 'failed';
      }
      run.exitCode = code ?? (signal ? -1 : 0);
      if (run.status === 'failed') {
        run.activity = run.reportedFailure || t("执行失败 (exit={0})", run.exitCode);
        if (!run.output) run.output = run.reportedFailure || stderr.trim();
      } else if (run.status === 'done' && !run.reportedCompletion) {
        run.activity = t("已完成");
      } else if (run.status === 'stopped') {
        run.activity = t("已手动终止");
      }
    }
    run.endedAt = new Date().toISOString();
    if (onComplete) {
      try { onComplete(summarizeRun(run)); } catch {}
    }
    broadcast({ type: 'cli:exit', run: summarizeRun(run) });
  };

  child.stdin.on('error', () => {});
  if (stdinText != null) {
    child.stdin.write(stdinText, 'utf8');
  }
  child.stdin.end();

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => parser.pushStdout(chunk));
  child.stderr.on('data', (chunk) => {
    if (protocol === 'raw') {
      appendTextDelta(run, chunk, broadcast);
    } else {
      stderr = (stderr + chunk).slice(-MAX_OUTPUT_CHARS);
      appendConsole(run, chunk, broadcast);
    }
  });

  child.on('error', (err) => finalize(-1, null, err.message));
  child.on('exit', (code, signal) => {
    // Guard against detached grandchild processes holding stdio pipes open forever
    exitFallbackTimer = setTimeout(() => finalize(code, signal), 2000);
  });
  child.on('close', (code, signal) => finalize(code, signal));

  return summarizeRun(run);
}

export async function launchExternalTerminal(
  { cli, dir, prompt, permissionMode = 'auto', model = '', effort = '', addDirs = [] },
  broadcast
) {
  if (!dir || !fs.existsSync(dir)) throw new Error(t("项目目录不存在"));
  const absDir = path.resolve(dir);
  const text = String(prompt || '').trim();

  const cliInfo = await resolveCli(cli);
  if (!cliInfo.available) {
    throw new Error(t("未检测到 {0}，请在「CLI 配置」中指定可执行文件路径", cliInfo.label));
  }

  const { preArgs } = buildInteractiveArgs(cliInfo, { dir: absDir, permissionMode, model, effort, addDirs });
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

  const msg = t("已在外部终端启动 {0}\n工作目录：{1}\n可执行文件：{2}\n模型：{3} | 思考强度：{4}\n", cliInfo.label, absDir, cliInfo.resolvedPath, model || t("默认"), effort || t("默认"));
  const run = {
    id: runId,
    pid: null,
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
    activity: t("已在外部终端打开交互窗口"),
    activityLog: [t("[{0}] 已在外部终端启动 {1}", nowTimeTag(), cliInfo.label)],
    usage: null,
    exitCode: 0,
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    output: msg,
    consoleLog: msg
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
  if (run.status !== 'running') return summarizeRun(run);

  run.status = 'stopped';
  run.activity = t("已手动终止");
  appendConsole(run, t("\n[CollabStudio] 已手动终止该 CLI 任务。\n"), broadcast);

  if (!child) {
    run.endedAt = run.endedAt || new Date().toISOString();
    run.exitCode = run.exitCode ?? -1;
    broadcast({ type: 'cli:exit', run: summarizeRun(run) });
    return summarizeRun(run);
  }

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
