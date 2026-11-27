import { locale, t } from './locale.js';
import { api, showToast } from './docs-panel.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (id) => document.getElementById(id);

const STATUS_META = {
  running: { label: t("运行中"), cls: 'running' },
  done: { label: t("已完成"), cls: 'done' },
  failed: { label: t("执行失败"), cls: 'failed' },
  stopped: { label: t("已终止"), cls: 'stopped' },
  launched: { label: t("外部终端"), cls: 'launched' }
};

export function populateModelSelect(selectEl, models = [], currentValue = '') {
  if (!selectEl) return;
  selectEl.innerHTML = '';
  const list = models.length ? models : [{ id: '', label: t("默认模型") }];
  let matched = false;
  for (const m of list) {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.label;
    if (m.id === currentValue) {
      opt.selected = true;
      matched = true;
    }
    selectEl.appendChild(opt);
  }
  if (currentValue && !matched) {
    const custom = document.createElement('option');
    custom.value = currentValue;
    custom.textContent = t("自定义: {0}", currentValue);
    custom.selected = true;
    selectEl.appendChild(custom);
  }
  const addOpt = document.createElement('option');
  addOpt.value = '__custom__';
  addOpt.textContent = t("+ 手动输入模型名…");
  selectEl.appendChild(addOpt);
}

export function populateEffortSelect(selectEl, efforts = [], currentValue = '') {
  if (!selectEl) return;
  selectEl.innerHTML = '';
  const list = efforts.length ? efforts : [
    { id: '', label: t("默认强度") },
    { id: 'low', label: t("低 (low)") },
    { id: 'medium', label: t("中 (medium)") },
    { id: 'high', label: t("高 (high)") },
    { id: 'xhigh', label: t("极高 (xhigh)") },
    { id: 'max', label: t("最大 (max)") }
  ];
  for (const e of list) {
    const opt = document.createElement('option');
    opt.value = e.id;
    opt.textContent = e.label;
    if (e.id === currentValue) opt.selected = true;
    selectEl.appendChild(opt);
  }
}

export function fmtElapsed(startedAt, endedAt) {
  if (!startedAt) return '';
  const ms = Math.max(0, (endedAt ? Date.parse(endedAt) : Date.now()) - Date.parse(startedAt));
  const sec = Math.floor(ms / 1000);
  const m = String(Math.floor(sec / 60)).padStart(2, '0');
  const s = String(sec % 60).padStart(2, '0');
  return `${m}:${s}`;
}

export function createCliPanel({
  getActiveDir,
  getPromptText,
  getActiveStage,
  onRunFinished,
  onCatalogUpdated,
  onSaveStageRouting,
  onRightTabChanged,
  onFillFixPrompt,
  onSnapshotRestored
}) {
  const savedPerm = (() => {
    try { return localStorage.getItem('collab_cli_perm') || 'auto'; } catch { return 'auto'; }
  })();
  const state = {
    clis: [],
    catalog: { codex: [], claude: [], antigravity: [], efforts: [] },
    selectedCli: 'codex',
    selectedModel: '',
    selectedEffort: '',
    manualOverride: false,
    mode: 'inline',
    permissionMode: ['default', 'auto', 'bypass'].includes(savedPerm) ? savedPerm : 'auto',
    runs: [],
    activeRunId: null,
    rightTab: 'discuss'
  };
  if ($('cliPermSelect')) $('cliPermSelect').value = state.permissionMode;

  function getCliInfo(id) {
    return state.clis.find((c) => c.id === id);
  }

  function getActiveRun() {
    return state.runs.find((r) => r.id === state.activeRunId) || state.runs[0] || null;
  }

  function setRightTab(tab) {
    state.rightTab = tab;
    const isDiscuss = tab === 'discuss';
    const isDocs = tab === 'docs';
    const isCli = tab === 'cli';
    const isPreview = tab === 'preview';
    $('tabRightDiscuss').classList.toggle('active', isDiscuss);
    $('tabRightDocs').classList.toggle('active', isDocs);
    $('tabRightCli').classList.toggle('active', isCli);
    $('tabRightPreview').classList.toggle('active', isPreview);
    $('discussPane').classList.toggle('hidden', !isDiscuss);
    $('docsPane').classList.toggle('hidden', !isDocs);
    $('cliPane').classList.toggle('hidden', !isCli);
    $('previewPane').classList.toggle('hidden', !isPreview);
    $('discussHeaderActions').classList.toggle('hidden', !isDiscuss);
    $('docsHeaderActions').classList.toggle('hidden', !isDocs);
    $('cliHeaderActions').classList.toggle('hidden', !isCli);
    $('previewHeaderActions').classList.toggle('hidden', !isPreview);
    if (isCli) scrollConsoleToBottom(true);
    if (onRightTabChanged) onRightTabChanged(tab);
  }

  function updateRunningIndicator() {
    const runningCount = state.runs.filter((r) => r.status === 'running').length;
    const badge = $('cliTabBadge');
    if (runningCount > 0) {
      badge.textContent = t("{0} 运行中", runningCount);
      badge.className = 'cli-tab-badge running';
      badge.classList.remove('hidden');
    } else if (state.runs.length > 0) {
      badge.textContent = String(state.runs.length);
      badge.className = 'cli-tab-badge';
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  }

  function renderModelEffortControls() {
    populateModelSelect($('cliModelSelect'), state.catalog[state.selectedCli] || [], state.selectedModel);
    populateEffortSelect($('cliEffortSelect'), state.catalog.efforts || [], state.selectedEffort);
  }

  function renderCliSwitcher() {
    const wrap = $('cliTargetSwitch');
    wrap.innerHTML = '';
    for (const id of ['codex', 'claude', 'antigravity']) {
      const info = getCliInfo(id) || { id, shortLabel: id, label: id, available: false };
      const btn = document.createElement('button');
      const cls = id === 'claude' ? ' cli-claude' : id === 'antigravity' ? ' cli-agy' : ' cli-codex';
      btn.type = 'button';
      btn.className = `cli-chip${cls}${state.selectedCli === id ? ' active' : ''}${info.available ? '' : ' unavailable'}`;
      btn.title = info.available
        ? `${info.label}: ${info.resolvedPath}${info.version ? ` (${info.version})` : ''}`
        : t("{0} 未检测到，点击右侧「配置」可手动指定路径", info.label);
      btn.innerHTML = `<span class="cli-dot ${info.available ? 'ok' : 'miss'}"></span><span>${info.shortLabel}</span>`;
      btn.onclick = () => {
        if (state.selectedCli !== id) {
          state.selectedCli = id;
          state.selectedModel = '';
        }
        state.manualOverride = true;
        renderCliSwitcher();
      };
      wrap.appendChild(btn);
    }

    renderModelEffortControls();

    const activeInfo = getCliInfo(state.selectedCli);
    const runBtn = $('btnRunCli');
    const isTerminal = state.mode === 'terminal';
    runBtn.textContent = isTerminal ? t("↗ 终端启动 {0}", activeInfo?.shortLabel || '') : t("▶ 运行 {0}", activeInfo?.shortLabel || '');

    const stageNum = getActiveStage ? getActiveStage() : 1;
    $('btnSaveStageRoute').textContent = t("存为阶段{0}默认", stageNum);

    const note = $('cliOverrideHint');
    const effTag = state.selectedEffort ? t(" · 思考:{0}", state.selectedEffort) : '';
    const modTag = state.selectedModel ? ` · ${state.selectedModel}` : '';
    if (activeInfo && !activeInfo.available) {
      note.textContent = t("未检测到 {0}，请点「配置」指定路径", activeInfo.label);
      note.classList.add('warn');
    } else if (state.manualOverride) {
      note.textContent = t("已手动切换：{0}{1}{2}", activeInfo?.label || state.selectedCli, modTag, effTag);
      note.classList.remove('warn');
    } else {
      note.textContent = t("阶段 {0} 配置：{1}{2}{3}", stageNum, activeInfo?.label || state.selectedCli, modTag, effTag);
      note.classList.remove('warn');
    }
  }

  function scrollConsoleToBottom(force = false) {
    const el = $('cliConsole');
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 64;
    if (force || nearBottom) el.scrollTop = el.scrollHeight;
  }

  function renderRunPanel() {
    updateRunningIndicator();
    const sel = $('cliRunSelect');
    sel.innerHTML = '';

    if (!state.runs.length) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = t("暂无执行记录");
      sel.appendChild(opt);
      $('cliRunStatus').textContent = t("空闲");
      $('cliRunStatus').className = 'cli-status-pill';
      $('cliRunMeta').textContent = t("选择左侧任意 CLI（Codex / Claude / AGY）与模型/思考强度后点击「运行」即可实时查看输出");
      $('cliConsole').textContent = '';
      $('btnStopCli').classList.add('hidden');
      $('btnBypassRetryCli').classList.add('hidden');
      $('btnRetryCli').classList.add('hidden');
      $('btnFixCli').classList.add('hidden');
      $('btnRollbackRun').classList.add('hidden');
      return;
    }

    if (!state.runs.some((r) => r.id === state.activeRunId)) {
      state.activeRunId = state.runs[0].id;
    }

    for (const r of state.runs) {
      const opt = document.createElement('option');
      opt.value = r.id;
      const meta = STATUS_META[r.status] || { label: r.status };
      const time = r.startedAt ? new Date(r.startedAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
      const spec = [r.model, r.effort].filter(Boolean).join('/');
      opt.textContent = `[${meta.label}] ${r.cliLabel}${spec ? `(${spec})` : ''} · ${time} · ${r.promptPreview}`;
      if (r.id === state.activeRunId) opt.selected = true;
      sel.appendChild(opt);
    }

    const active = getActiveRun();
    const meta = STATUS_META[active.status] || { label: active.status, cls: '' };
    const elapsed = fmtElapsed(active.startedAt, active.endedAt);
    const exitSuffix = active.status === 'done' || active.status === 'failed' ? ` (code ${active.exitCode})` : '';
    const pidTag = active.status === 'running' && active.pid ? ` · PID ${active.pid}` : '';
    const timeTag = elapsed ? ` · ${elapsed}` : '';
    $('cliRunStatus').textContent = `${meta.label}${exitSuffix}${timeTag}${pidTag}`;
    $('cliRunStatus').className = `cli-status-pill ${meta.cls}`;
    const actText = active.activity ? t("状态：{0}   |   ", active.activity) : '';
    $('cliRunMeta').textContent = actText + t("{0}   |   目录: {1}", active.commandDisplay, active.dir);
    $('cliConsole').textContent = active.consoleLog || active.output || (active.status === 'running' ? t("正在启动 CLI，等待输出…") : t("(无文本输出)"));
    const isRunning = active.status === 'running';
    const hasPrompt = Boolean(active.prompt);
    $('btnStopCli').classList.toggle('hidden', !isRunning);
    $('btnRetryCli').classList.toggle('hidden', isRunning || !hasPrompt);
    $('btnFixCli').classList.toggle('hidden', isRunning || !hasPrompt);
    $('btnBypassRetryCli').classList.toggle(
      'hidden',
      !hasPrompt || (!active.needsPermission && active.status !== 'failed' && active.status !== 'stopped')
    );
    $('btnRollbackRun').classList.toggle('hidden', !active.snapshotId);
    scrollConsoleToBottom(false);
  }

  function renderSettingsModal() {
    const list = $('cliConfigList');
    list.innerHTML = '';
    for (const id of ['codex', 'claude', 'antigravity']) {
      const info = getCliInfo(id) || { id, label: id, available: false, resolvedPath: '', configuredPath: '', extraArgs: '', version: '' };
      const card = document.createElement('div');
      card.className = 'cli-cfg-card';
      card.innerHTML = `
        <div class="cli-cfg-head">
          <span class="cli-cfg-title"><span class="cli-dot ${info.available ? 'ok' : 'miss'}"></span>${info.label}</span>
          <span class="muted">${info.available ? (esc(info.version) || t("已就绪")) : t("未检测到")}</span>
        </div>
        <div class="cli-cfg-detected mono-path">${info.resolvedPath ? esc(t("当前解析：{0}", info.resolvedPath)) : t("自动探测未找到，请在下方填写可执行文件完整路径")}</div>
        <label class="field">
          <span>${t("自定义路径（留空自动探测）")}</span>
          <input type="text" data-cli="${id}" data-field="path" value="${esc(info.configuredPath)}" placeholder="${t("可执行文件路径")}" />
        </label>
        <label class="field">
          <span>${t("默认附加参数（可选）")}</span>
          <input type="text" data-cli="${id}" data-field="extraArgs" value="${esc(info.extraArgs)}" placeholder="${t("例如 --verbose")}" />
        </label>`;
      list.appendChild(card);
    }
  }

  async function refreshStatus(withVersion = true) {
    try {
      const data = await api(`/api/cli/status?version=${withVersion ? '1' : '0'}`);
      state.clis = data.clis || [];
      if (data.catalog) state.catalog = data.catalog;
      renderCliSwitcher();
      if (onCatalogUpdated) onCatalogUpdated({ clis: state.clis, catalog: state.catalog });
      if (!$('cliModalBackdrop').classList.contains('hidden')) {
        renderSettingsModal();
      }
    } catch (e) {
      showToast(t("检测 CLI 失败：{0}", e.message));
    }
  }

  async function loadRuns(dir) {
    if (!dir) {
      state.runs = [];
      state.activeRunId = null;
      renderRunPanel();
      return;
    }
    try {
      const data = await api(`/api/cli/runs?dir=${encodeURIComponent(dir)}`);
      state.runs = data.runs || [];
      if (!state.runs.some((r) => r.id === state.activeRunId)) {
        state.activeRunId = state.runs[0]?.id || null;
      }
      renderRunPanel();
    } catch (e) {
      showToast(e.message);
    }
  }

  async function runSelectedCli(overrides = {}) {
    const dir = getActiveDir();
    if (!dir) return showToast(t("请先选择或新建一个项目"));
    const prompt = String(overrides.prompt ?? getPromptText()).trim();
    const mode = overrides.mode || state.mode;
    const permissionMode = overrides.permissionMode || state.permissionMode;
    const cli = overrides.cli || state.selectedCli;
    const model = overrides.model !== undefined ? overrides.model : state.selectedModel;
    const effort = overrides.effort !== undefined ? overrides.effort : state.selectedEffort;
    if (mode === 'inline' && !prompt) {
      return showToast(t("内置直跑模式需要输入或选择执行口令"));
    }
    try {
      const res = await api('/api/cli/run', {
        method: 'POST',
        body: JSON.stringify({ cli, model, effort, dir, prompt, mode, permissionMode })
      });
      const run = res.run;
      // Live events may arrive before the response and already hold newer output.
      if (!state.runs.some((r) => r.id === run.id)) state.runs.unshift(run);
      state.activeRunId = run.id;
      setRightTab('cli');
      renderRunPanel();
      showToast(mode === 'terminal' ? t("已在外部终端启动 {0}", run.cliLabel) : t("已启动 {0}", run.cliLabel));
    } catch (e) {
      showToast(e.message);
    }
  }

  async function retryActiveRun({ forceBypass = false } = {}) {
    const active = getActiveRun();
    if (!active || !active.prompt) return showToast(t("当前记录没有可重跑的原始指令"));
    if (active.status === 'running') {
      await stopActiveRun();
    }
    if (forceBypass) {
      state.permissionMode = 'bypass';
      $('cliPermSelect').value = 'bypass';
      try { localStorage.setItem('collab_cli_perm', 'bypass'); } catch {}
    }
    await runSelectedCli({
      prompt: active.prompt,
      mode: 'inline',
      permissionMode: forceBypass ? 'bypass' : state.permissionMode
    });
  }

  function fillFixPromptFromActiveRun() {
    const active = getActiveRun();
    if (!active) return;
    const rawLog = (active.consoleLog || active.output || '').trim();
    const tail = rawLog.length > 2600 ? t("…(已省略前段)\n{0}", rawLog.slice(-2600)) : rawLog;
    const fixText = [
      t("【手动纠错任务】上次使用 {0} 执行未达预期（状态：{1}，exit={2}）。", active.cliLabel, active.status, active.exitCode ?? '?'),
      t("请直接基于以下报错/输出日志定位根因，修正问题并重新验证通过："),
      ``,
      t("### 原指令摘要"),
      active.promptPreview || t("(无)"),
      ``,
      t("### 上次执行日志（尾部）"),
      '```',
      tail || t("(无文本输出)"),
      '```',
      ``,
      t("### 人类补充要求（可在此直接修改补充）"),
      t("- 请修复上述错误后重新运行验证，确认无误再汇报。")
    ].join('\n');
    if (onFillFixPrompt) onFillFixPrompt(fixText);
    showToast(t("已将报错纠错指令填入左侧口令框，可修改后直接点击「运行」或切换其他 CLI"));
  }

  async function rollbackActiveRunSnapshot() {
    const active = getActiveRun();
    const dir = getActiveDir();
    if (!dir || !active?.snapshotId) return;
    if (!confirm(t("确定将 docs/01~05、规则文件与阶段状态回退到本次 CLI 运行前的快照吗？（系统会在回退前自动再留一份当前备份）"))) return;
    try {
      const res = await api('/api/snapshots/restore', {
        method: 'POST',
        body: JSON.stringify({ dir, snapshotId: active.snapshotId })
      });
      showToast(t("已回退 {0} 个文件（已自动备份当前状态）", res.restoredFiles?.length || 0));
      if (onSnapshotRestored) onSnapshotRestored();
    } catch (e) {
      showToast(t("回退失败：{0}", e.message));
    }
  }

  async function stopActiveRun() {
    const active = getActiveRun();
    if (!active || active.status !== 'running') return;
    try {
      await api('/api/cli/stop', {
        method: 'POST',
        body: JSON.stringify({ runId: active.id })
      });
      showToast(t("已发送终止信号"));
    } catch (e) {
      showToast(e.message);
    }
  }

  function handleSseEvent(evt) {
    if (!evt || !evt.type || !evt.type.startsWith('cli:')) return;
    const activeDir = getActiveDir();

    if (evt.type === 'cli:start' && evt.run) {
      if (activeDir && evt.run.dir.toLowerCase() !== activeDir.toLowerCase()) return;
      const idx = state.runs.findIndex((r) => r.id === evt.run.id);
      if (idx >= 0) state.runs[idx] = evt.run;
      else state.runs.unshift(evt.run);
      if (!state.activeRunId || evt.run.kind !== 'discussion') state.activeRunId = evt.run.id;
      renderRunPanel();
      return;
    }

    if (evt.type === 'cli:activity') {
      const run = state.runs.find((r) => r.id === evt.runId);
      if (!run) return;
      run.activity = evt.activity || run.activity;
      if (evt.pid) run.pid = evt.pid;
      if (evt.needsPermission) run.needsPermission = true;
      if (evt.usage) run.usage = evt.usage;
      if (run.id === state.activeRunId) renderRunPanel();
      return;
    }

    if (evt.type === 'cli:console') {
      const run = state.runs.find((r) => r.id === evt.runId);
      if (!run) return;
      run.consoleLog = (run.consoleLog || '') + (evt.chunk || '');
      if (run.id === state.activeRunId) {
        const el = $('cliConsole');
        const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 64;
        el.textContent = run.consoleLog;
        if (nearBottom) el.scrollTop = el.scrollHeight;
      }
      return;
    }

    if (evt.type === 'cli:output') {
      const run = state.runs.find((r) => r.id === evt.runId);
      if (!run) return;
      run.output = (run.output || '') + (evt.chunk || '');
      run.consoleLog = (run.consoleLog || '') + (evt.chunk || '');
      if (run.id === state.activeRunId) {
        const el = $('cliConsole');
        const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 64;
        el.textContent = run.consoleLog;
        if (nearBottom) el.scrollTop = el.scrollHeight;
      }
      return;
    }

    if (evt.type === 'cli:exit' && evt.run) {
      const idx = state.runs.findIndex((r) => r.id === evt.run.id);
      if (idx >= 0) state.runs[idx] = evt.run;
      renderRunPanel();
      if (evt.run.mode === 'inline' && evt.run.kind !== 'discussion' && onRunFinished) {
        onRunFinished(evt.run);
      }
    }
  }

  $('tabRightDiscuss').onclick = () => setRightTab('discuss');
  $('tabRightDocs').onclick = () => setRightTab('docs');
  $('tabRightCli').onclick = () => setRightTab('cli');
  $('tabRightPreview').onclick = () => setRightTab('preview');

  $('cliModeSelect').onchange = (e) => {
    state.mode = e.target.value;
    renderCliSwitcher();
  };

  $('cliPermSelect').onchange = (e) => {
    state.permissionMode = e.target.value;
    try { localStorage.setItem('collab_cli_perm', state.permissionMode); } catch {}
  };

  $('cliModelSelect').onchange = (e) => {
    if (e.target.value === '__custom__') {
      const custom = prompt(t("请输入自定义模型名称（留空恢复默认）："), state.selectedModel || '');
      if (custom !== null) state.selectedModel = custom.trim();
    } else {
      state.selectedModel = e.target.value;
    }
    state.manualOverride = true;
    renderCliSwitcher();
  };

  $('cliEffortSelect').onchange = (e) => {
    state.selectedEffort = e.target.value;
    state.manualOverride = true;
    renderCliSwitcher();
  };

  $('btnSaveStageRoute').onclick = () => {
    if (onSaveStageRouting) {
      onSaveStageRouting({
        cli: state.selectedCli,
        model: state.selectedModel,
        effort: state.selectedEffort
      });
      state.manualOverride = false;
      renderCliSwitcher();
    }
  };

  $('btnRunCli').onclick = () => runSelectedCli();
  $('btnStopCli').onclick = stopActiveRun;
  $('btnRetryCli').onclick = () => retryActiveRun({ forceBypass: false });
  $('btnBypassRetryCli').onclick = () => retryActiveRun({ forceBypass: true });
  $('btnFixCli').onclick = fillFixPromptFromActiveRun;
  $('btnRollbackRun').onclick = rollbackActiveRunSnapshot;

  $('cliRunSelect').onchange = (e) => {
    state.activeRunId = e.target.value;
    renderRunPanel();
    scrollConsoleToBottom(true);
  };

  $('btnCopyCliOutput').onclick = async () => {
    const active = getActiveRun();
    const output = active?.consoleLog || active?.output;
    if (!output) return showToast(t("当前没有可复制的输出"));
    await navigator.clipboard.writeText(output);
    showToast(t("CLI 输出已复制"));
  };

  $('btnCliSettings').onclick = async () => {
    $('cliModalBackdrop').classList.remove('hidden');
    renderSettingsModal();
    await refreshStatus(true);
  };
  $('btnCloseCliModal').onclick = () => $('cliModalBackdrop').classList.add('hidden');
  $('btnCancelCliModal').onclick = () => $('cliModalBackdrop').classList.add('hidden');
  $('btnRedetectCli').onclick = async () => {
    showToast(t("正在重新探测本机 CLI 与模型…"));
    await refreshStatus(true);
    showToast(t("探测完成"));
  };
  $('btnSaveCliModal').onclick = async () => {
    const payload = { codex: {}, claude: {}, antigravity: {} };
    document.querySelectorAll('#cliConfigList input[data-cli]').forEach((inp) => {
      payload[inp.dataset.cli][inp.dataset.field] = inp.value.trim();
    });
    try {
      const data = await api('/api/cli/config', {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      state.clis = data.clis || [];
      if (data.catalog) state.catalog = data.catalog;
      renderCliSwitcher();
      if (onCatalogUpdated) onCatalogUpdated({ clis: state.clis, catalog: state.catalog });
      $('cliModalBackdrop').classList.add('hidden');
      showToast(t("CLI 配置已保存"));
    } catch (e) {
      showToast(e.message);
    }
  };

  setInterval(() => {
    const active = getActiveRun();
    if (active && active.status === 'running') {
      const elapsed = fmtElapsed(active.startedAt, null);
      const pidTag = active.pid ? ` · PID ${active.pid}` : '';
      $('cliRunStatus').textContent = `${STATUS_META.running.label} · ${elapsed}${pidTag}`;
    }
  }, 1000);

  refreshStatus(true);

  return {
    applyStageRoute(route) {
      if (!route) return;
      state.manualOverride = false;
      state.selectedCli = route.cli || 'codex';
      state.selectedModel = route.model || '';
      state.selectedEffort = route.effort || '';
      renderCliSwitcher();
    },
    followAgent(agentId) {
      state.manualOverride = false;
      if (state.selectedCli !== agentId) {
        state.selectedCli = agentId;
        state.selectedModel = '';
      }
      renderCliSwitcher();
    },
    getCatalog: () => state.catalog,
    getClis: () => state.clis,
    setRightTab,
    loadRuns,
    handleSseEvent
  };
}
