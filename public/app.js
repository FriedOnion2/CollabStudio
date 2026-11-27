import { api, showToast, createDocsPanel } from './docs-panel.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const state = {
  stages: [],
  projects: [],
  activeDir: null,
  detail: null,
  activeAgent: 'codex',
  activeSubKey: 'stage3',
  selectedMilestone: ''
};

const PROMPT_MENUS = {
  codex: [
    { key: 'stage3', label: '阶段3 · 后端细化' },
    { key: 'stage4', label: '阶段4 · 硬核编码' },
    { key: 'stage5Review', label: '阶段5 · 两级审查(≤2轮)' },
    { key: 'guardrail', label: '错一次 → 硬检查' }
  ],
  claude: [
    { key: 'merge', label: '阶段1 · 双方案合并' },
    { key: 'stage2', label: '阶段2 · 视觉与动效' },
    { key: 'stage4', label: '阶段4 · 改全与核实' },
    { key: 'stage5Review', label: '阶段5 · 独立复审' }
  ],
  antigravity: [
    { key: 'blind', label: '独立盲写方案' },
    { key: 'copy', label: '文案与交互润色' },
    { key: 'current', label: '当前阶段指令' },
    { key: '2', label: '阶段2 · 前端规范' },
    { key: '5', label: '阶段5 · 设计验收' }
  ]
};

const docsPanel = createDocsPanel({
  onSaved: (file) => {
    if (file === 'docs/04-tasks.md') refreshActive(true);
  }
});

function connectEvents() {
  const es = new EventSource('/api/events');
  es.onopen = () => {
    $('connDot').classList.remove('off');
    $('connText').textContent = '本地服务已连接';
  };
  es.onerror = () => {
    $('connDot').classList.add('off');
    $('connText').textContent = '连接已断开';
  };
}

function renderSidebar() {
  const list = $('projectList');
  list.innerHTML = '';
  for (const p of state.projects) {
    const btn = document.createElement('button');
    btn.className = `proj-item${p.dir === state.activeDir ? ' active' : ''}`;
    btn.innerHTML = `
      <div class="proj-item-top">
        <span>${esc(p.state.name)}</span>
        <span class="stage-pill">阶段 ${p.state.stage}</span>
      </div>
      <div class="proj-item-sub">
        <span>${p.exists ? `${p.progress.done}/${p.progress.total} 任务` : '目录不存在'}</span>
        <span>${p.state.contractFrozen ? '已冻结' : '草案'}</span>
      </div>`;
    btn.onclick = () => selectProject(p.dir);
    list.appendChild(btn);
  }
}

function renderPromptSubTabs() {
  const wrap = $('promptSubTabs');
  const items = PROMPT_MENUS[state.activeAgent] || [];
  if (!items.some((i) => i.key === state.activeSubKey)) state.activeSubKey = items[0]?.key || '';
  const cls = state.activeAgent === 'claude' ? ' tab-claude' : state.activeAgent === 'antigravity' ? ' tab-agy' : '';
  wrap.innerHTML = '';
  for (const item of items) {
    const btn = document.createElement('button');
    btn.className = `tab${cls}${item.key === state.activeSubKey ? ' active' : ''}`;
    btn.textContent = item.label;
    btn.onclick = () => {
      state.activeSubKey = item.key;
      renderPromptSubTabs();
      updatePromptBox();
    };
    wrap.appendChild(btn);
  }
}

function updatePromptBox() {
  const prompts = state.detail?.prompts;
  if (!prompts) return;
  let text = '';
  if (state.activeAgent === 'codex') text = prompts.codex?.[state.activeSubKey] || '';
  else if (state.activeAgent === 'claude') text = prompts.claude?.[state.activeSubKey] || '';
  else text = state.activeSubKey === 'current' ? prompts.recommendedAntigravity : (prompts.antigravityByStage?.[state.activeSubKey] || '');

  $('promptBox').value = text;
  const hints = {
    codex: '打开 Codex 客户端并选中该项目目录后粘贴发送',
    claude: '打开 Claude 客户端 / Claude Code 并指向该项目目录后粘贴发送',
    antigravity: '复制到 Antigravity 对话框直接触发对应阶段'
  };
  $('promptHint').textContent = hints[state.activeAgent] || '';
}

function renderProjectDetail(preserveDoc = true) {
  const d = state.detail;
  if (!d) {
    $('emptyState').classList.remove('hidden');
    $('projectView').classList.add('hidden');
    return;
  }
  $('emptyState').classList.add('hidden');
  $('projectView').classList.remove('hidden');

  const p = d.project;
  $('projName').textContent = p.state.name;
  $('projPath').textContent = p.dir;
  $('taskProgressText').textContent = `任务进度 ${p.progress.done}/${p.progress.total}`;

  const frozen = Boolean(p.state.contractFrozen);
  $('freezeBadge').textContent = frozen ? '契约已冻结 (FROZEN)' : '契约草案 (DRAFT)';
  $('freezeBadge').className = `badge${frozen ? ' frozen' : ''}`;
  $('btnToggleFreeze').textContent = frozen ? '解除契约冻结' : '冻结接口契约';

  const pipe = $('stagePipeline');
  pipe.innerHTML = '';
  for (const s of state.stages) {
    const done = Boolean(p.state.gates[s.key]);
    const active = p.state.stage === s.id;
    const ownerCls = s.owner.includes('Codex') && !s.owner.includes('Anti') ? 'codex' : 'agy';
    const card = document.createElement('div');
    card.className = `stage-card${active ? ' active' : ''}${done ? ' done' : ''}`;
    card.innerHTML = `
      <div class="stage-top"><span>阶段 ${s.id}</span><span class="stage-owner ${ownerCls}">${s.owner}</span></div>
      <div class="stage-name">${s.title}</div>
      <label class="gate-row"><input type="checkbox" ${done ? 'checked' : ''} /><span>${s.gateLabel}</span></label>`;
    card.onclick = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'LABEL') return;
      patchState({ stage: s.id });
    };
    card.querySelector('input').onchange = (e) => {
      patchState({ gates: { [s.key]: e.target.checked } });
    };
    pipe.appendChild(card);
  }

  const sel = $('milestoneSelect');
  sel.innerHTML = '';
  const list = p.milestones.length ? p.milestones : [{ title: 'Milestone 1', tasks: [], doneCount: 0, totalCount: 0 }];
  for (const m of list) {
    const opt = document.createElement('option');
    opt.value = m.title;
    opt.textContent = `${m.title} (${m.doneCount}/${m.totalCount})`;
    if (m.title === d.activeMilestone) opt.selected = true;
    sel.appendChild(opt);
  }
  state.selectedMilestone = sel.value;

  const msList = $('milestoneList');
  msList.innerHTML = '';
  for (const m of p.milestones) {
    const pct = m.totalCount ? Math.round((m.doneCount / m.totalCount) * 100) : 0;
    const card = document.createElement('div');
    card.className = 'ms-card';
    card.innerHTML = `
      <div class="ms-head"><span>${esc(m.title)}</span><span class="muted">${m.doneCount}/${m.totalCount} (${pct}%)</span></div>
      <div class="ms-bar"><div style="width:${pct}%"></div></div>
      ${m.tasks.map((t) => `<div class="ms-task${t.done ? ' done' : ''}"><span>${t.done ? '☑' : '☐'}</span><span>${esc(t.text)}</span></div>`).join('')}`;
    msList.appendChild(card);
  }

  renderPromptSubTabs();
  updatePromptBox();
  docsPanel.render(p, preserveDoc);
}

async function loadProjects(keepDir = true) {
  const data = await api('/api/projects');
  state.stages = data.stages;
  state.projects = data.projects;
  if (!keepDir || !state.projects.some((p) => p.dir === state.activeDir)) {
    state.activeDir = state.projects[0]?.dir || null;
  }
  renderSidebar();
  if (state.activeDir) await selectProject(state.activeDir, keepDir);
  else { state.detail = null; renderProjectDetail(); }
}

async function selectProject(dir, preserveDoc = false) {
  state.activeDir = dir;
  renderSidebar();
  await refreshActive(preserveDoc);
}

async function refreshActive(preserveDoc = true) {
  if (!state.activeDir) return;
  const q = new URLSearchParams({ dir: state.activeDir, milestone: state.selectedMilestone || '' });
  state.detail = await api(`/api/project?${q}`);
  const idx = state.projects.findIndex((p) => p.dir === state.activeDir);
  if (idx >= 0) state.projects[idx] = state.detail.project;
  renderSidebar();
  renderProjectDetail(preserveDoc);
}

async function patchState(patch) {
  if (!state.activeDir) return;
  await api('/api/project/state', { method: 'PATCH', body: JSON.stringify({ dir: state.activeDir, patch }) });
  await refreshActive(true);
}

function openModal() {
  $('inputDir').value = '';
  $('inputName').value = '';
  $('inputScaffold').checked = true;
  $('modalBackdrop').classList.remove('hidden');
  $('inputDir').focus();
}
function closeModal() { $('modalBackdrop').classList.add('hidden'); }

$('btnNewProject').onclick = openModal;
$('btnEmptyNew').onclick = openModal;
$('btnCloseModal').onclick = closeModal;
$('btnCancelModal').onclick = closeModal;

$('btnPickFolder').onclick = async () => {
  if (window.electronAPI?.pickFolder) {
    const dir = await window.electronAPI.pickFolder();
    if (dir) $('inputDir').value = dir;
    return;
  }
  const { dir } = await api('/api/pick-folder', { method: 'POST' });
  if (dir) $('inputDir').value = dir;
};

$('btnConfirmModal').onclick = async () => {
  const dir = $('inputDir').value.trim();
  if (!dir) return showToast('请先填写或选择项目目录');
  try {
    const res = await api('/api/projects/init', {
      method: 'POST',
      body: JSON.stringify({ dir, name: $('inputName').value.trim(), initScaffold: $('inputScaffold').checked })
    });
    closeModal();
    state.activeDir = res.project.dir;
    await loadProjects(true);
    showToast(`已就绪：${res.project.state.name}`);
  } catch (e) { showToast(e.message); }
};

$('btnRefresh').onclick = () => refreshActive(true).then(() => showToast('已从磁盘刷新'));
$('btnOpenFolder').onclick = () => api('/api/open-folder', { method: 'POST', body: JSON.stringify({ target: state.activeDir }) });
$('btnToggleFreeze').onclick = () => {
  const frozen = !state.detail?.project?.state?.contractFrozen;
  patchState({ contractFrozen: frozen, gates: { g3: frozen } }).then(() => showToast(frozen ? '接口契约已冻结' : '已切换回草案'));
};
$('btnRemoveProj').onclick = async () => {
  if (!state.activeDir || !confirm('仅从 CollabStudio 列表移除，不会删除项目文件，确定吗？')) return;
  await api(`/api/projects?dir=${encodeURIComponent(state.activeDir)}`, { method: 'DELETE' });
  state.activeDir = null;
  await loadProjects(false);
};
$('btnQuit').onclick = async () => {
  await api('/api/shutdown', { method: 'POST' }).catch(() => {});
  window.close();
};

document.querySelectorAll('.agent-switch .agent-pill').forEach((btn) => {
  btn.onclick = () => {
    document.querySelectorAll('.agent-switch .agent-pill').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    state.activeAgent = btn.dataset.agent;
    renderPromptSubTabs();
    updatePromptBox();
  };
});

$('milestoneSelect').onchange = async (e) => {
  state.selectedMilestone = e.target.value;
  await refreshActive(true);
};

$('btnCopyPrompt').onclick = async () => {
  await navigator.clipboard.writeText($('promptBox').value);
  showToast('口令已复制到剪贴板');
};

connectEvents();
loadProjects(false).catch((e) => showToast(e.message));
