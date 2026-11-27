import { api, showToast, createDocsPanel } from './docs-panel.js';
import { createCliPanel, populateModelSelect, populateEffortSelect } from './cli-panel.js';
import { createDiscussionPanel } from './discussion-panel.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = {
  stages: [],
  projects: [],
  activeDir: null,
  detail: null,
  expandedRoots: new Set(),
  filterText: '',
  subCardCollapsed: false,
  subModalRootDir: null,
  subModalRootName: '',
  activeAgent: 'codex',
  activeSubKey: 'stage3',
  selectedMilestone: '',
  lastTemplateText: '',
  lastSyncedStage: null
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

const STAGE_DEFAULT_SUBKEY = {
  1: { codex: 'stage3', claude: 'merge', antigravity: 'current' },
  2: { codex: 'stage3', claude: 'stage2', antigravity: '2' },
  3: { codex: 'stage3', claude: 'stage4', antigravity: 'current' },
  4: { codex: 'stage4', claude: 'stage4', antigravity: 'current' },
  5: { codex: 'stage5Review', claude: 'stage5Review', antigravity: '5' }
};

function dirEq(a, b) {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase());
}

function getCurrentRootInfo() {
  const p = state.detail?.project;
  if (!p) return null;
  if (p.isSubproject && p.parentDir) {
    return { dir: p.parentDir, name: p.parentName || p.parentDir };
  }
  return { dir: p.dir, name: p.state?.name || p.dir };
}

const docsPanel = createDocsPanel({
  onSaved: (file) => {
    if (file === 'docs/04-tasks.md' || !file.startsWith('docs/')) refreshActive(true);
  }
});

const discussionPanel = createDiscussionPanel({
  getActiveDir: () => state.activeDir,
  onPlanFinalized: async ({ advanceToStage }) => {
    state.lastSyncedStage = null;
    await refreshActive(false);
    if (advanceToStage) {
      cliPanel.setRightTab('docs');
    }
  }
});

const cliPanel = createCliPanel({
  getActiveDir: () => state.activeDir,
  getPromptText: () => $('promptBox').value,
  getActiveStage: () => state.detail?.project?.state?.stage || 1,
  onRunFinished: (run) => {
    if (dirEq(state.activeDir, run.dir)) refreshActive(true);
  },
  onCatalogUpdated: ({ clis, catalog }) => {
    discussionPanel.setCatalog({ clis, catalog });
    if (!$('stageMatrixBackdrop').classList.contains('hidden')) renderStageMatrixModal();
  },
  onSaveStageRouting: async (route) => {
    const stageNum = String(state.detail?.project?.state?.stage || 1);
    await patchState({ stageRouting: { [stageNum]: route } });
    showToast(`已保存为阶段 ${stageNum} 默认模型与思考强度`);
  }
});

function connectEvents() {
  const es = new EventSource('/api/events');
  es.onopen = () => {
    $('connDot').classList.remove('off');
    $('connText').textContent = '本地服务已连接';
  };
  es.onmessage = (e) => {
    try {
      const evt = JSON.parse(e.data);
      cliPanel.handleSseEvent(evt);
      discussionPanel.handleSseEvent(evt);
    } catch {}
  };
  es.onerror = () => {
    $('connDot').classList.add('off');
    $('connText').textContent = '连接已断开';
  };
}

function setActiveAgentPill(agentId) {
  state.activeAgent = agentId;
  document.querySelectorAll('.agent-switch .agent-pill').forEach((b) => {
    b.classList.toggle('active', b.dataset.agent === agentId);
  });
}

function applyStageRoutingToUi(project, force = false) {
  const stageNum = project?.state?.stage || 1;
  const route = project?.state?.stageRouting?.[String(stageNum)];
  if (!route) return;
  if (force || state.lastSyncedStage !== `${project.dir}:${stageNum}`) {
    state.lastSyncedStage = `${project.dir}:${stageNum}`;
    const targetCli = route.cli || 'codex';
    setActiveAgentPill(targetCli);
    state.activeSubKey = STAGE_DEFAULT_SUBKEY[stageNum]?.[targetCli] || PROMPT_MENUS[targetCli]?.[0]?.key || '';
    cliPanel.applyStageRoute(route);
    if (stageNum === 1) discussionPanel.syncStage1Route(route);
  }
}

function renderSidebar() {
  const list = $('projectList');
  const q = state.filterText.trim().toLowerCase();
  list.innerHTML = '';

  for (const p of state.projects) {
    const subs = p.subprojects || [];
    const rootMatches = !q || p.state.name.toLowerCase().includes(q) || p.dir.toLowerCase().includes(q);
    const matchedSubs = q
      ? subs.filter((s) => s.name.toLowerCase().includes(q) || s.relPath.toLowerCase().includes(q))
      : subs;
    if (!rootMatches && !matchedSubs.length) continue;

    const isRootActive = dirEq(p.dir, state.activeDir);
    const hasActiveChild = subs.some((s) => dirEq(s.dir, state.activeDir));
    if (hasActiveChild) state.expandedRoots.add(p.dir);
    const isExpanded = Boolean(q) || state.expandedRoots.has(p.dir);
    const prog = subs.length && p.aggregateProgress ? p.aggregateProgress : p.progress;

    const group = document.createElement('div');
    group.className = 'proj-group';

    const rootRow = document.createElement('div');
    rootRow.className = `proj-root-row${isRootActive ? ' active' : ''}${hasActiveChild ? ' has-active-child' : ''}`;

    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'tree-toggle';
    toggleBtn.textContent = subs.length ? (isExpanded ? '▾' : '▸') : '•';
    toggleBtn.title = subs.length ? (isExpanded ? '折叠子项目' : '展开子项目') : '暂无子项目';
    toggleBtn.onclick = (e) => {
      e.stopPropagation();
      if (!subs.length) return;
      if (state.expandedRoots.has(p.dir)) state.expandedRoots.delete(p.dir);
      else state.expandedRoots.add(p.dir);
      renderSidebar();
    };

    const itemBtn = document.createElement('button');
    itemBtn.type = 'button';
    itemBtn.className = 'proj-item';
    itemBtn.innerHTML = `
      <div class="proj-item-top">
        <span class="proj-item-name" title="${esc(p.dir)}">${esc(p.state.name)}</span>
        <span class="stage-pill${subs.length ? ' sub-count' : ''}">${subs.length ? `${subs.length} 子项` : `阶段 ${p.state.stage}`}</span>
      </div>
      <div class="proj-item-sub">
        <span>${p.exists ? `${prog.done}/${prog.total} 任务` : '目录不存在'}</span>
        <span>${p.state.contractFrozen ? '已冻结' : `阶段 ${p.state.stage}`}</span>
      </div>`;
    itemBtn.onclick = () => selectProject(p.dir);

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'tree-add-btn';
    addBtn.textContent = '+';
    addBtn.title = `为「${p.state.name}」添加或扫描子项目`;
    addBtn.onclick = (e) => {
      e.stopPropagation();
      openSubModal(p.dir, p.state.name);
    };

    rootRow.append(toggleBtn, itemBtn, addBtn);
    group.appendChild(rootRow);

    if (subs.length && isExpanded) {
      const subTree = document.createElement('div');
      subTree.className = 'sub-tree';
      for (const s of matchedSubs) {
        const subBtn = document.createElement('button');
        subBtn.type = 'button';
        subBtn.className = `sub-node${dirEq(s.dir, state.activeDir) ? ' active' : ''}`;
        subBtn.title = s.dir;
        subBtn.innerHTML = `
          <div class="sub-node-top">
            <span class="sub-node-name">${s.contractFrozen ? '<span class="frozen-dot" title="契约已冻结"></span>' : ''}${esc(s.name)}</span>
            <span class="stage-pill">S${s.stage}</span>
          </div>
          <div class="sub-node-sub">
            <span class="sub-rel">${esc(s.relPath)}</span>
            <span>${s.exists ? `${s.progress.done}/${s.progress.total}` : '缺失'}</span>
          </div>`;
        subBtn.onclick = () => selectProject(s.dir);
        subTree.appendChild(subBtn);
      }
      group.appendChild(subTree);
    }

    list.appendChild(group);
  }
}

function renderSubprojectsOverview(p) {
  const card = $('subprojectsCard');
  const subs = p.subprojects || [];
  if (p.isSubproject || !subs.length) {
    card.classList.add('hidden');
    return;
  }
  card.classList.remove('hidden');
  card.classList.toggle('collapsed', state.subCardCollapsed);
  $('btnToggleSubCard').textContent = state.subCardCollapsed ? '展开' : '收起';

  const agg = p.aggregateProgress || p.progress;
  const frozenCount = subs.filter((s) => s.contractFrozen).length;
  $('subprojectsTitle').textContent = `子项目总览 (${subs.length})`;
  $('subprojectsSummary').textContent = `汇总任务 ${agg.done}/${agg.total} · 已冻结契约 ${frozenCount}/${subs.length}`;

  const grid = $('subprojectGrid');
  grid.innerHTML = '';
  for (const s of subs) {
    const pct = s.progress.total ? Math.round((s.progress.done / s.progress.total) * 100) : 0;
    const route = s.stageRouting?.[String(s.stage)] || {};
    const cliShort = route.cli === 'antigravity' ? 'AGY' : route.cli === 'claude' ? 'Claude' : 'Codex';
    const routeTag = route.effort ? `${cliShort}·${route.effort}` : cliShort;
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'sub-card';
    el.innerHTML = `
      <div class="sub-card-top">
        <span class="proj-item-name">${esc(s.name)}</span>
        <span class="stage-pill">阶段 ${s.stage}</span>
      </div>
      <div class="sub-card-path">${esc(s.relPath)}</div>
      <div class="sub-card-bar"><div style="width:${pct}%"></div></div>
      <div class="sub-card-meta">
        <span>${s.progress.done}/${s.progress.total} (${pct}%)</span>
        <span>${s.contractFrozen ? '已冻结 · ' : ''}${esc(routeTag)}</span>
      </div>`;
    el.onclick = () => selectProject(s.dir);
    grid.appendChild(el);
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
      updatePromptBox(false);
    };
    wrap.appendChild(btn);
  }
}

function updatePromptBox(preserveEdited = false) {
  const prompts = state.detail?.prompts;
  if (!prompts) return;
  let text = '';
  if (state.activeAgent === 'codex') text = prompts.codex?.[state.activeSubKey] || '';
  else if (state.activeAgent === 'claude') text = prompts.claude?.[state.activeSubKey] || '';
  else text = state.activeSubKey === 'current' ? prompts.recommendedAntigravity : (prompts.antigravityByStage?.[state.activeSubKey] || '');

  const box = $('promptBox');
  const isEdited = box.value && box.value !== state.lastTemplateText;
  state.lastTemplateText = text;
  if (!preserveEdited || !isEdited) {
    box.value = text;
    $('btnResetPrompt').classList.add('hidden');
  }
  const hints = {
    codex: '可直接下方调用 CLI 执行，或复制粘贴到 Codex 客户端',
    claude: '可直接下方调用 CLI 执行，或复制粘贴到 Claude 客户端',
    antigravity: '可直接下方调用 Antigravity CLI，或复制到对话框'
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

  // Breadcrumb & sibling switcher
  const parentBtn = $('btnParentCrumb');
  const crumbSep = $('crumbSep');
  const scopeBadge = $('scopeBadge');
  const sibSel = $('siblingSelect');
  if (p.isSubproject && p.parentDir) {
    parentBtn.textContent = p.parentName || '主项目';
    parentBtn.classList.remove('hidden');
    parentBtn.onclick = () => selectProject(p.parentDir);
    crumbSep.classList.remove('hidden');
    scopeBadge.textContent = `子项目 · ${p.relPath}`;
    scopeBadge.className = 'scope-badge sub';
    $('btnRemoveProj').textContent = '移除子项目';
    const siblings = p.siblings || [];
    if (siblings.length > 1) {
      sibSel.innerHTML = '';
      for (const s of siblings) {
        const opt = document.createElement('option');
        opt.value = s.dir;
        opt.textContent = `${s.name} (S${s.stage})`;
        if (dirEq(s.dir, p.dir)) opt.selected = true;
        sibSel.appendChild(opt);
      }
      sibSel.classList.remove('hidden');
    } else {
      sibSel.classList.add('hidden');
    }
  } else {
    parentBtn.classList.add('hidden');
    crumbSep.classList.add('hidden');
    sibSel.classList.add('hidden');
    const subCount = (p.subprojects || []).length;
    scopeBadge.textContent = subCount ? `主项目 · ${subCount} 子项` : '主项目';
    scopeBadge.className = 'scope-badge';
    $('btnRemoveProj').textContent = '移除';
  }

  const frozen = Boolean(p.state.contractFrozen);
  $('freezeBadge').textContent = frozen ? '契约已冻结 (FROZEN)' : '契约草案 (DRAFT)';
  $('freezeBadge').className = `badge${frozen ? ' frozen' : ''}`;
  $('btnToggleFreeze').textContent = frozen ? '解除契约冻结' : '冻结接口契约';

  renderSubprojectsOverview(p);

  const pipe = $('stagePipeline');
  pipe.innerHTML = '';
  const routing = p.state.stageRouting || {};
  for (const s of state.stages) {
    const done = Boolean(p.state.gates[s.key]);
    const active = p.state.stage === s.id;
    const r = routing[String(s.id)] || { cli: 'codex', model: '', effort: '' };
    const ownerCls = r.cli === 'codex' ? 'codex' : r.cli === 'claude' ? 'claude' : 'agy';
    const card = document.createElement('div');
    card.className = `stage-card${active ? ' active' : ''}${done ? ' done' : ''}`;
    card.innerHTML = `
      <div class="stage-top"><span>阶段 ${s.id}</span><span class="stage-owner ${ownerCls}">${s.owner}</span></div>
      <div class="stage-name">${s.title}</div>
      <div class="stage-route-row">
        <select class="stage-mini-sel sel-stage-cli" title="切换阶段 ${s.id} 使用的 CLI">
          <option value="antigravity"${r.cli === 'antigravity' ? ' selected' : ''}>AGY</option>
          <option value="claude"${r.cli === 'claude' ? ' selected' : ''}>Claude</option>
          <option value="codex"${r.cli === 'codex' ? ' selected' : ''}>Codex</option>
        </select>
        <select class="stage-mini-sel sel-stage-effort" title="切换阶段 ${s.id} 思考强度">
          <option value=""${!r.effort ? ' selected' : ''}>默认</option>
          <option value="low"${r.effort === 'low' ? ' selected' : ''}>低</option>
          <option value="medium"${r.effort === 'medium' ? ' selected' : ''}>中</option>
          <option value="high"${r.effort === 'high' ? ' selected' : ''}>高</option>
          <option value="xhigh"${r.effort === 'xhigh' ? ' selected' : ''}>极高</option>
          <option value="max"${r.effort === 'max' ? ' selected' : ''}>最大</option>
        </select>
      </div>
      ${r.model ? `<div class="stage-model-tag" title="${esc(r.model)}">${esc(r.model)}</div>` : ''}
      <label class="gate-row"><input type="checkbox" ${done ? 'checked' : ''} /><span>${s.gateLabel}</span></label>`;

    card.onclick = (e) => {
      if (['INPUT', 'LABEL', 'SELECT', 'OPTION'].includes(e.target.tagName)) return;
      state.lastSyncedStage = null;
      patchState({ stage: s.id });
    };
    card.querySelector('input').onchange = (e) => {
      patchState({ gates: { [s.key]: e.target.checked } });
    };
    card.querySelector('.sel-stage-cli').onchange = async (e) => {
      const nextRoute = { ...r, cli: e.target.value, model: '' };
      if (active) state.lastSyncedStage = null;
      await patchState({ stageRouting: { [String(s.id)]: nextRoute } });
      showToast(`阶段 ${s.id} 已切换为 ${e.target.selectedOptions[0].textContent}`);
    };
    card.querySelector('.sel-stage-effort').onchange = async (e) => {
      const nextRoute = { ...r, effort: e.target.value };
      if (active) state.lastSyncedStage = null;
      await patchState({ stageRouting: { [String(s.id)]: nextRoute } });
      showToast(`阶段 ${s.id} 思考强度已设为「${e.target.selectedOptions[0].textContent}」`);
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

  applyStageRoutingToUi(p, false);
  renderPromptSubTabs();
  updatePromptBox(preserveDoc);
  docsPanel.render(p, preserveDoc);
}

function renderStageMatrixModal() {
  const list = $('stageMatrixList');
  const p = state.detail?.project;
  if (!p) return;
  const routing = p.state.stageRouting || {};
  const catalog = cliPanel.getCatalog();
  list.innerHTML = '';

  for (const s of state.stages) {
    const r = { ...(routing[String(s.id)] || { cli: 'codex', model: '', effort: '' }) };
    const row = document.createElement('div');
    row.className = 'stage-matrix-row';
    row.dataset.stage = String(s.id);
    row.innerHTML = `
      <div>
        <div class="stage-matrix-label">阶段 ${s.id} · ${s.title}</div>
        <div class="stage-matrix-sub">推荐：${s.owner}</div>
      </div>
      <select class="select-sm m-cli">
        <option value="antigravity"${r.cli === 'antigravity' ? ' selected' : ''}>Antigravity CLI</option>
        <option value="claude"${r.cli === 'claude' ? ' selected' : ''}>Claude CLI</option>
        <option value="codex"${r.cli === 'codex' ? ' selected' : ''}>Codex CLI</option>
      </select>
      <select class="select-sm m-model"></select>
      <select class="select-sm m-effort"></select>`;

    const cliSel = row.querySelector('.m-cli');
    const modSel = row.querySelector('.m-model');
    const effSel = row.querySelector('.m-effort');
    populateModelSelect(modSel, catalog[r.cli] || [], r.model || '');
    populateEffortSelect(effSel, catalog.efforts || [], r.effort || '');

    cliSel.onchange = () => populateModelSelect(modSel, catalog[cliSel.value] || [], '');
    modSel.onchange = () => {
      if (modSel.value === '__custom__') {
        const custom = prompt(`为阶段 ${s.id} 输入自定义模型名称：`, '');
        populateModelSelect(modSel, catalog[cliSel.value] || [], (custom || '').trim());
      }
    };
    list.appendChild(row);
  }
}

// Subproject modal logic
function setSubModalTab(tab) {
  const isScan = tab === 'scan';
  $('tabSubManual').classList.toggle('active', !isScan);
  $('tabSubScan').classList.toggle('active', isScan);
  $('subManualPane').classList.toggle('hidden', isScan);
  $('subScanPane').classList.toggle('hidden', !isScan);
  if (isScan) runSubprojectScan();
}

function openSubModal(rootDir, rootName, defaultTab = 'manual') {
  state.subModalRootDir = rootDir;
  state.subModalRootName = rootName;
  $('subModalTitle').textContent = `管理子项目 · ${rootName}`;
  $('subModalRootPath').textContent = `主项目根目录：${rootDir}`;
  $('inputSubPath').value = '';
  $('inputSubName').value = '';
  $('inputSubScaffold').checked = true;
  $('inputSubRules').checked = false;
  $('inputScanScaffold').checked = true;
  $('subModalBackdrop').classList.remove('hidden');
  setSubModalTab(defaultTab);
  if (defaultTab === 'manual') $('inputSubPath').focus();
}

function closeSubModal() {
  $('subModalBackdrop').classList.add('hidden');
}

async function runSubprojectScan() {
  const rootDir = state.subModalRootDir;
  if (!rootDir) return;
  $('subScanHint').textContent = '正在扫描主项目下的子目录…';
  const list = $('subScanList');
  list.innerHTML = '';
  try {
    const { candidates } = await api(`/api/subprojects/scan?dir=${encodeURIComponent(rootDir)}`);
    if (!candidates.length) {
      $('subScanHint').textContent = '未发现可导入的子目录，可切回「新建 / 指定子项目」手动创建';
      return;
    }
    const pendingCount = candidates.filter((c) => !c.alreadyAdded).length;
    $('subScanHint').textContent = `发现 ${candidates.length} 个子目录（${pendingCount} 个未导入）`;
    for (const c of candidates) {
      const row = document.createElement('label');
      row.className = `sub-scan-item${c.alreadyAdded ? ' added' : ''}`;
      const tagsHtml = (c.tags || []).map((t) => `<span class="scan-tag${t === 'Collab' ? ' collab' : ''}">${esc(t)}</span>`).join('');
      row.innerHTML = `
        <div class="sub-scan-left">
          <input type="checkbox" class="scan-chk" data-rel="${esc(c.relPath)}" data-name="${esc(c.name)}" ${c.alreadyAdded ? 'disabled' : (c.tags?.length ? 'checked' : '')} />
          <span class="sub-scan-path" title="${esc(c.absDir)}">${esc(c.relPath)}</span>
        </div>
        <div class="sub-scan-tags">${c.alreadyAdded ? '<span class="muted">已导入</span>' : tagsHtml}</div>`;
      list.appendChild(row);
    }
  } catch (e) {
    $('subScanHint').textContent = `扫描失败：${e.message}`;
  }
}

function findDirInProjects(dir) {
  if (!dir) return false;
  for (const p of state.projects) {
    if (dirEq(p.dir, dir)) return true;
    if ((p.subprojects || []).some((s) => dirEq(s.dir, dir))) return true;
  }
  return false;
}

async function loadProjects(keepDir = true) {
  const data = await api('/api/projects');
  state.stages = data.stages;
  state.projects = data.projects;
  for (const p of state.projects) {
    if ((p.subprojects || []).length && state.expandedRoots.size === 0) {
      state.expandedRoots.add(p.dir);
    }
  }
  if (!keepDir || !findDirInProjects(state.activeDir)) {
    state.activeDir = state.projects[0]?.dir || null;
  }
  renderSidebar();
  if (state.activeDir) await selectProject(state.activeDir, keepDir);
  else { state.detail = null; renderProjectDetail(); }
}

async function selectProject(dir, preserveDoc = false) {
  state.activeDir = dir;
  state.lastSyncedStage = null;
  renderSidebar();
  await Promise.all([refreshActive(preserveDoc), cliPanel.loadRuns(dir), discussionPanel.load(dir)]);
}

async function refreshActive(preserveDoc = true) {
  if (!state.activeDir) return;
  const q = new URLSearchParams({ dir: state.activeDir, milestone: state.selectedMilestone || '' });
  const [detailData, listData] = await Promise.all([
    api(`/api/project?${q}`),
    api('/api/projects')
  ]);
  state.stages = listData.stages;
  state.projects = listData.projects;
  state.detail = detailData;
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

$('projectFilter').addEventListener('input', (e) => {
  state.filterText = e.target.value;
  renderSidebar();
});

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
    state.expandedRoots.add(res.project.dir);
    await loadProjects(true);
    cliPanel.setRightTab('discuss');
    showToast(`已就绪：${res.project.state.name}`);
  } catch (e) { showToast(e.message); }
};

$('btnAddSubproject').onclick = () => {
  const root = getCurrentRootInfo();
  if (root) openSubModal(root.dir, root.name, 'manual');
};
$('btnSubCardAdd').onclick = () => {
  const root = getCurrentRootInfo();
  if (root) openSubModal(root.dir, root.name, 'scan');
};
$('btnToggleSubCard').onclick = () => {
  state.subCardCollapsed = !state.subCardCollapsed;
  if (state.detail?.project) renderSubprojectsOverview(state.detail.project);
};
$('siblingSelect').onchange = (e) => {
  if (e.target.value) selectProject(e.target.value);
};

$('tabSubManual').onclick = () => setSubModalTab('manual');
$('tabSubScan').onclick = () => setSubModalTab('scan');
$('btnCloseSubModal').onclick = closeSubModal;
$('btnCancelSubModal').onclick = closeSubModal;
$('btnCancelSubModal2').onclick = closeSubModal;
$('btnSubRescan').onclick = runSubprojectScan;
$('btnSubSelectAll').onclick = () => {
  document.querySelectorAll('#subScanList .scan-chk:not(:disabled)').forEach((chk) => { chk.checked = true; });
};

$('btnPickSubFolder').onclick = async () => {
  const picked = window.electronAPI?.pickFolder
    ? await window.electronAPI.pickFolder()
    : (await api('/api/pick-folder', { method: 'POST' })).dir;
  if (!picked) return;
  const root = state.subModalRootDir || '';
  if (root && picked.toLowerCase().startsWith(root.toLowerCase())) {
    const rel = picked.slice(root.length).replace(/^[\\/]+/, '').replace(/\\/g, '/');
    $('inputSubPath').value = rel || picked;
  } else {
    $('inputSubPath').value = picked;
  }
};

$('btnConfirmSubManual').onclick = async () => {
  const relPath = $('inputSubPath').value.trim();
  if (!relPath) return showToast('请填写或选择子项目路径');
  try {
    const res = await api('/api/subprojects/add', {
      method: 'POST',
      body: JSON.stringify({
        rootDir: state.subModalRootDir,
        items: [{ relPath, name: $('inputSubName').value.trim() }],
        initScaffold: $('inputSubScaffold').checked,
        includeRules: $('inputSubRules').checked
      })
    });
    closeSubModal();
    state.expandedRoots.add(state.subModalRootDir);
    const addedDir = res.added?.[0]?.absDir || state.subModalRootDir;
    state.activeDir = addedDir;
    await loadProjects(true);
    cliPanel.setRightTab('discuss');
    showToast(`已添加子项目：${res.added?.[0]?.entry?.name || relPath}`);
  } catch (e) { showToast(e.message); }
};

$('btnConfirmSubScan').onclick = async () => {
  const selected = [];
  document.querySelectorAll('#subScanList .scan-chk:checked').forEach((chk) => {
    selected.push({ relPath: chk.dataset.rel, name: chk.dataset.name });
  });
  if (!selected.length) return showToast('请先勾选至少一个要导入的子目录');
  try {
    await api('/api/subprojects/add', {
      method: 'POST',
      body: JSON.stringify({
        rootDir: state.subModalRootDir,
        items: selected,
        initScaffold: $('inputScanScaffold').checked,
        includeRules: false
      })
    });
    closeSubModal();
    state.expandedRoots.add(state.subModalRootDir);
    await loadProjects(true);
    showToast(`已批量导入 ${selected.length} 个子项目`);
  } catch (e) { showToast(e.message); }
};

$('btnRefresh').onclick = () => refreshActive(true).then(() => showToast('已从磁盘刷新'));
$('btnOpenFolder').onclick = () => api('/api/open-folder', { method: 'POST', body: JSON.stringify({ target: state.activeDir }) });
$('btnToggleFreeze').onclick = () => {
  const frozen = !state.detail?.project?.state?.contractFrozen;
  patchState({ contractFrozen: frozen, gates: { g3: frozen } }).then(() => showToast(frozen ? '接口契约已冻结' : '已切换回草案'));
};
$('btnRemoveProj').onclick = async () => {
  const p = state.detail?.project;
  if (!p) return;
  if (p.isSubproject && p.parentDir) {
    if (!confirm(`仅从主项目「${p.parentName}」的子项目列表移除「${p.state.name}」，不会删除磁盘文件，确定吗？`)) return;
    await api(`/api/subprojects?rootDir=${encodeURIComponent(p.parentDir)}&relPath=${encodeURIComponent(p.relPath)}`, { method: 'DELETE' });
    state.activeDir = p.parentDir;
    await loadProjects(true);
    showToast(`已移除子项目：${p.state.name}`);
    return;
  }
  if (!confirm('仅从 CollabStudio 列表移除该主项目，不会删除磁盘文件，确定吗？')) return;
  await api(`/api/projects?dir=${encodeURIComponent(state.activeDir)}`, { method: 'DELETE' });
  state.activeDir = null;
  await loadProjects(false);
};
$('btnQuit').onclick = async () => {
  await api('/api/shutdown', { method: 'POST' }).catch(() => {});
  window.close();
};

$('btnStageMatrix').onclick = () => {
  if (!state.detail?.project) return;
  renderStageMatrixModal();
  $('stageMatrixBackdrop').classList.remove('hidden');
};
$('btnCloseStageMatrix').onclick = () => $('stageMatrixBackdrop').classList.add('hidden');
$('btnCancelStageMatrix').onclick = () => $('stageMatrixBackdrop').classList.add('hidden');
$('btnSaveStageMatrix').onclick = async () => {
  const stageRouting = {};
  document.querySelectorAll('#stageMatrixList .stage-matrix-row').forEach((row) => {
    const modVal = row.querySelector('.m-model').value;
    stageRouting[row.dataset.stage] = {
      cli: row.querySelector('.m-cli').value,
      model: modVal === '__custom__' ? '' : modVal,
      effort: row.querySelector('.m-effort').value
    };
  });
  state.lastSyncedStage = null;
  await patchState({ stageRouting });
  $('stageMatrixBackdrop').classList.add('hidden');
  showToast('已更新 5 阶段模型与思考强度配置');
};

document.querySelectorAll('.agent-switch .agent-pill').forEach((btn) => {
  btn.onclick = () => {
    setActiveAgentPill(btn.dataset.agent);
    renderPromptSubTabs();
    updatePromptBox(false);
    cliPanel.followAgent(state.activeAgent);
  };
});

$('promptBox').addEventListener('input', () => {
  const edited = $('promptBox').value !== state.lastTemplateText;
  $('btnResetPrompt').classList.toggle('hidden', !edited);
});

$('btnResetPrompt').onclick = () => {
  $('promptBox').value = state.lastTemplateText;
  $('btnResetPrompt').classList.add('hidden');
  showToast('已恢复模板口令');
};

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
