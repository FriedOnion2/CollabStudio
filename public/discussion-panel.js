import { api, showToast } from './docs-panel.js';
import { populateModelSelect, populateEffortSelect } from './cli-panel.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fmtSize(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function createDiscussionPanel({ getActiveDir, onPlanFinalized }) {
  const state = {
    dir: null,
    clis: [],
    catalog: { codex: [], claude: [], antigravity: [], efforts: [] },
    cli: 'antigravity',
    model: '',
    effort: 'high',
    discussion: { planLocked: false, attachments: [], messages: [] },
    activeRunId: null,
    streamingMsgId: null,
    liveActivity: '',
    livePid: null,
    liveStartedAt: null
  };

  function fmtElapsed(startedAt) {
    if (!startedAt) return '00:00';
    const sec = Math.max(0, Math.floor((Date.now() - Date.parse(startedAt)) / 1000));
    return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
  }

  function getCliInfo(id) {
    return state.clis.find((c) => c.id === id);
  }

  function renderControls() {
    const wrap = $('discCliSwitch');
    wrap.innerHTML = '';
    for (const id of ['antigravity', 'claude', 'codex']) {
      const info = getCliInfo(id) || { id, shortLabel: id === 'antigravity' ? 'AGY' : id, label: id, available: false };
      const cls = id === 'claude' ? ' cli-claude' : id === 'antigravity' ? ' cli-agy' : ' cli-codex';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `cli-chip${cls}${state.cli === id ? ' active' : ''}${info.available ? '' : ' unavailable'}`;
      btn.innerHTML = `<span class="cli-dot ${info.available ? 'ok' : 'miss'}"></span><span>${info.shortLabel}</span>`;
      btn.title = `切换到 ${info.label} 参与当前方案讨论`;
      btn.onclick = () => {
        if (state.cli !== id) {
          state.cli = id;
          state.model = '';
        }
        renderControls();
      };
      wrap.appendChild(btn);
    }
    populateModelSelect($('discModelSelect'), state.catalog[state.cli] || [], state.model);
    populateEffortSelect($('discEffortSelect'), state.catalog.efforts || [], state.effort);
  }

  function renderAttachments() {
    const list = $('discAttachList');
    const items = state.discussion.attachments || [];
    list.innerHTML = '';
    if (!items.length) {
      list.innerHTML = '<span class="muted">尚未导入参考文件（支持点击「+ 导入文件」或直接拖拽文档/代码到此处）</span>';
      return;
    }
    for (const att of items) {
      const chip = document.createElement('span');
      chip.className = `attach-chip${att.exists === false ? ' missing' : ''}`;
      chip.title = `${att.path}${att.isText ? '（文本内容将注入讨论上下文）' : '（非文本，仅传路径）'}`;
      chip.innerHTML = `<span>${att.isText ? '📄' : '📎'} ${esc(att.name)}</span><span class="attach-size">${fmtSize(att.size)}</span><button type="button" class="attach-del" title="移除">×</button>`;
      chip.querySelector('.attach-del').onclick = () => removeAttachment(att.id);
      list.appendChild(chip);
    }
  }

  function renderMessages(scrollBottom = false) {
    const thread = $('discThread');
    const msgs = state.discussion.messages || [];

    const badge = $('discTabBadge');
    if (state.discussion.planLocked) {
      badge.textContent = '已定稿';
      badge.className = 'cli-tab-badge locked';
      badge.classList.remove('hidden');
    } else if (msgs.length) {
      badge.textContent = String(msgs.length);
      badge.className = 'cli-tab-badge';
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }

    $('btnStopDisc').classList.toggle('hidden', !state.activeRunId);
    $('btnSendDisc').disabled = Boolean(state.activeRunId);

    if (!msgs.length) {
      thread.innerHTML = `
        <div class="disc-empty">
          <div class="disc-empty-title">💡 先和模型聊透需求与方案，再正式生产</div>
          <p>在下方输入你的需求想法、约束条件或上传 PRD / 参考代码文件，选定任意模型与思考强度进行多轮讨论（中途可随时切换模型复核）。方案满意后点击「确认方案并进入生产」，自动落盘到 <code>docs/01-brief.md</code> 并推进阶段。</p>
        </div>`;
      return;
    }

    const nearBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 80;
    thread.innerHTML = '';

    for (const m of msgs) {
      const card = document.createElement('div');
      card.className = `disc-msg ${m.role === 'user' ? 'user' : 'assistant'}`;
      const timeStr = m.createdAt ? new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

      if (m.role === 'user') {
        const attNote = m.attachmentNames?.length ? ` · 附带 ${m.attachmentNames.length} 个文件` : '';
        card.innerHTML = `
          <div class="disc-msg-head"><span>你${esc(attNote)}</span><span class="muted">${timeStr}</span></div>
          <div class="disc-msg-body">${esc(m.content)}</div>`;
      } else {
        const metaTags = [m.cliLabel || m.cli || '模型', m.model, m.effort ? `思考:${m.effort}` : ''].filter(Boolean).join(' · ');
        const isLive = Boolean(m.pending);
        const liveText = isLive
          ? `${state.liveActivity || '正在连接 CLI 思考…'} · ${fmtElapsed(state.liveStartedAt || m.createdAt)}${state.livePid ? ` · PID ${state.livePid}` : ''}`
          : '';
        const pendingTag = isLive
          ? `<span class="disc-thinking"><span class="live-pulse"></span><span class="disc-live-label">${esc(liveText)}</span></span>`
          : (m.status === 'failed' ? '<span class="disc-failed-tag">失败</span>' : '');
        card.innerHTML = `
          <div class="disc-msg-head">
            <span class="disc-model-tag tag-${esc(m.cli || 'codex')}">${esc(metaTags)}</span>
            <div class="inline-actions">${pendingTag}<span class="muted">${timeStr}</span></div>
          </div>
          <div class="disc-msg-body">${esc(m.content || (isLive ? 'CLI 已启动并正在工作，模型开始吐字后会实时显示在这里…' : ''))}</div>
          ${isLive
            ? `<div class="disc-msg-actions"><button type="button" class="btn-link act-stop" style="color:var(--danger)">■ 停止本轮</button></div>`
            : `<div class="disc-msg-actions">
            <button type="button" class="btn-link act-copy">复制</button>
            <button type="button" class="btn-link act-brief">仅写入 01-brief</button>
            <button type="button" class="btn-link act-prod">采纳并进入生产 →</button>
          </div>`}`;
        if (isLive) {
          card.querySelector('.act-stop').onclick = stopDiscussionRun;
        } else {
          card.querySelector('.act-copy').onclick = async () => {
            await navigator.clipboard.writeText(m.content || '');
            showToast('已复制方案回复');
          };
          card.querySelector('.act-brief').onclick = () => openFinalizeModal(m.content, false);
          card.querySelector('.act-prod').onclick = () => openFinalizeModal(m.content, true);
        }
      }
      thread.appendChild(card);
    }

    if (scrollBottom || nearBottom) {
      thread.scrollTop = thread.scrollHeight;
    }
  }

  async function load(dir) {
    state.dir = dir;
    state.activeRunId = null;
    state.streamingMsgId = null;
    if (!dir) {
      state.discussion = { planLocked: false, attachments: [], messages: [] };
      renderAttachments();
      renderMessages(true);
      return;
    }
    try {
      const data = await api(`/api/discussion?dir=${encodeURIComponent(dir)}`);
      state.discussion = data.discussion || { planLocked: false, attachments: [], messages: [] };
      const runningMsg = (state.discussion.messages || []).find((m) => m.pending && m.runId);
      if (runningMsg) {
        state.activeRunId = runningMsg.runId;
        state.streamingMsgId = runningMsg.id;
      }
      renderAttachments();
      renderMessages(true);
    } catch (e) {
      showToast(e.message);
    }
  }

  async function pickAndAttachFiles() {
    const dir = getActiveDir();
    if (!dir) return showToast('请先选择或新建项目');
    try {
      let paths = [];
      if (window.electronAPI?.pickFiles) {
        paths = await window.electronAPI.pickFiles();
      } else {
        const res = await api('/api/pick-files', { method: 'POST' });
        paths = res.paths || [];
      }
      if (!paths.length) return;
      const data = await api('/api/discussion/attachments', {
        method: 'POST',
        body: JSON.stringify({ dir, paths })
      });
      state.discussion = data.discussion;
      renderAttachments();
      showToast(`已导入 ${paths.length} 个参考文件`);
    } catch (e) {
      showToast(`导入失败：${e.message}`);
    }
  }

  async function uploadDroppedFiles(fileList) {
    const dir = getActiveDir();
    if (!dir || !fileList?.length) return;
    const uploads = [];
    for (const file of Array.from(fileList)) {
      if (file.size > 5 * 1024 * 1024) {
        showToast(`跳过超大文件：${file.name} (>5MB)`);
        continue;
      }
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = '';
      for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
      uploads.push({ name: file.name, base64: btoa(binary) });
    }
    if (!uploads.length) return;
    try {
      const data = await api('/api/discussion/attachments', {
        method: 'POST',
        body: JSON.stringify({ dir, uploads })
      });
      state.discussion = data.discussion;
      renderAttachments();
      showToast(`已拖入 ${uploads.length} 个文件`);
    } catch (e) {
      showToast(`上传失败：${e.message}`);
    }
  }

  async function removeAttachment(id) {
    const dir = getActiveDir();
    if (!dir) return;
    const data = await api(`/api/discussion/attachments?dir=${encodeURIComponent(dir)}&id=${encodeURIComponent(id)}`, {
      method: 'DELETE'
    });
    state.discussion = data.discussion;
    renderAttachments();
  }

  async function sendMessage() {
    const dir = getActiveDir();
    if (!dir) return showToast('请先选择或新建项目');
    if (state.activeRunId) return showToast('当前模型仍在回复中，请稍候或先点击停止');
    const input = $('discInput');
    const message = input.value.trim();
    if (!message) return showToast('请先输入你的需求或讨论问题');

    try {
      input.value = '';
      const res = await api('/api/discussion/send', {
        method: 'POST',
        body: JSON.stringify({
          dir,
          message,
          cli: state.cli,
          model: state.model,
          effort: state.effort
        })
      });
      state.discussion = res.discussion;
      state.activeRunId = res.run.id;
      state.streamingMsgId = res.assistantMsg.id;
      state.liveActivity = res.run.activity || '进程已启动，等待 CLI 响应…';
      state.livePid = res.run.pid || null;
      state.liveStartedAt = res.run.startedAt || new Date().toISOString();
      renderMessages(true);
    } catch (e) {
      input.value = message;
      showToast(e.message);
      if (state.dir) load(state.dir);
    }
  }

  async function stopDiscussionRun() {
    if (!state.activeRunId) return;
    try {
      await api('/api/cli/stop', {
        method: 'POST',
        body: JSON.stringify({ runId: state.activeRunId })
      });
      showToast('已停止本轮讨论');
    } catch (e) {
      showToast(e.message);
    }
  }

  function openFinalizeModal(prefillText = '', enterProduction = true) {
    const msgs = state.discussion.messages || [];
    const lastAssistant = [...msgs].reverse().find((m) => m.role === 'assistant' && m.content && !m.pending);
    const lastUser = [...msgs].reverse().find((m) => m.role === 'user' && m.content);
    const fallback = prefillText || lastAssistant?.content || lastUser?.content || '';
    if (!fallback.trim()) {
      return showToast('还没有可定稿的方案内容，请先输入需求并与模型讨论');
    }
    $('finalizePlanText').value = fallback;
    $('finalizeStageSelect').value = enterProduction ? '2' : '0';
    $('finalizeModalBackdrop').classList.remove('hidden');
  }

  async function confirmFinalize() {
    const dir = getActiveDir();
    if (!dir) return;
    const planText = $('finalizePlanText').value.trim();
    if (!planText) return showToast('方案内容不能为空');
    const mode = $('finalizeModeSelect').value;
    const advanceToStage = Number($('finalizeStageSelect').value || 0);
    try {
      const res = await api('/api/discussion/finalize', {
        method: 'POST',
        body: JSON.stringify({ dir, planText, mode, advanceToStage })
      });
      state.discussion = res.discussion;
      $('finalizeModalBackdrop').classList.add('hidden');
      renderMessages(false);
      showToast(advanceToStage ? `方案已写入 01-brief.md，已进入阶段 ${advanceToStage} 生产！` : '方案已写入 docs/01-brief.md');
      if (onPlanFinalized) onPlanFinalized({ advanceToStage, state: res.state });
    } catch (e) {
      showToast(e.message);
    }
  }

  function handleSseEvent(evt) {
    if (!evt || !evt.type) return;
    if (evt.type === 'cli:activity' && evt.runId && evt.runId === state.activeRunId) {
      state.liveActivity = evt.activity || state.liveActivity;
      if (evt.pid) state.livePid = evt.pid;
      const lbl = document.querySelector('.disc-live-label');
      if (lbl) {
        lbl.textContent = `${state.liveActivity} · ${fmtElapsed(state.liveStartedAt)}${state.livePid ? ` · PID ${state.livePid}` : ''}`;
      }
      return;
    }
    if (evt.type === 'cli:output' && evt.runId && evt.runId === state.activeRunId) {
      const msg = (state.discussion.messages || []).find((m) => m.id === state.streamingMsgId);
      if (msg) {
        msg.content = (msg.content || '') + (evt.chunk || '');
        renderMessages(false);
      }
      return;
    }
    if (evt.type === 'cli:exit' && evt.run && evt.run.id === state.activeRunId) {
      state.activeRunId = null;
      state.streamingMsgId = null;
      state.liveActivity = '';
      state.livePid = null;
      state.liveStartedAt = null;
      if (state.dir) load(state.dir);
      return;
    }
    if (evt.type === 'discussion:updated' && state.dir && evt.dir?.toLowerCase() === state.dir.toLowerCase()) {
      state.activeRunId = null;
      state.streamingMsgId = null;
      state.liveActivity = '';
      state.livePid = null;
      state.liveStartedAt = null;
      load(state.dir);
    }
  }

  setInterval(() => {
    if (!state.activeRunId) return;
    const lbl = document.querySelector('.disc-live-label');
    if (lbl) {
      lbl.textContent = `${state.liveActivity || 'CLI 正在工作中…'} · ${fmtElapsed(state.liveStartedAt)}${state.livePid ? ` · PID ${state.livePid}` : ''}`;
    }
  }, 1000);

  // Bind controls
  $('discModelSelect').onchange = (e) => {
    if (e.target.value === '__custom__') {
      const custom = prompt('请输入自定义模型名称（留空恢复默认）：', state.model || '');
      if (custom !== null) state.model = custom.trim();
    } else {
      state.model = e.target.value;
    }
    renderControls();
  };

  $('discEffortSelect').onchange = (e) => {
    state.effort = e.target.value;
  };

  $('btnImportFiles').onclick = pickAndAttachFiles;
  $('btnImportFiles2').onclick = pickAndAttachFiles;
  $('btnSendDisc').onclick = sendMessage;
  $('btnStopDisc').onclick = stopDiscussionRun;
  $('btnFinalizePlan').onclick = () => openFinalizeModal('', true);

  $('btnClearDisc').onclick = async () => {
    const dir = getActiveDir();
    if (!dir || !confirm('确定清空当前项目的讨论记录吗？（已导入的参考文件会保留）')) return;
    const data = await api('/api/discussion/clear', {
      method: 'POST',
      body: JSON.stringify({ dir, keepAttachments: true })
    });
    state.discussion = data.discussion;
    renderMessages(true);
    showToast('讨论记录已清空');
  };

  $('discInput').addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      sendMessage();
    }
  });

  // Drag & drop files into discussion pane
  const pane = $('discussPane');
  pane.addEventListener('dragover', (e) => {
    e.preventDefault();
    pane.classList.add('drag-over');
  });
  pane.addEventListener('dragleave', (e) => {
    if (!pane.contains(e.relatedTarget)) pane.classList.remove('drag-over');
  });
  pane.addEventListener('drop', (e) => {
    e.preventDefault();
    pane.classList.remove('drag-over');
    if (e.dataTransfer?.files?.length) uploadDroppedFiles(e.dataTransfer.files);
  });

  $('btnCloseFinalizeModal').onclick = () => $('finalizeModalBackdrop').classList.add('hidden');
  $('btnCancelFinalize').onclick = () => $('finalizeModalBackdrop').classList.add('hidden');
  $('btnConfirmFinalize').onclick = confirmFinalize;

  renderControls();

  return {
    load,
    setCatalog({ clis, catalog }) {
      state.clis = clis || [];
      if (catalog) state.catalog = catalog;
      renderControls();
    },
    syncStage1Route(route) {
      if (!route) return;
      state.cli = route.cli || 'antigravity';
      state.model = route.model || '';
      state.effort = route.effort || 'high';
      renderControls();
    },
    handleSseEvent
  };
}
