import { locale, t } from './locale.js';
import { api, showToast } from './docs-panel.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fmtSize(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function createPreviewPanel({ getActiveDir, onSendRework, onFeedbackSaved, onApproveCurrentGate }) {
  const state = {
    dir: null,
    data: null,
    selectedUrl: '',
    selectedLabel: '',
    viewport: 'auto',
    activeScript: null,
    showRecent: false
  };

  function getAbsolutePreviewUrl() {
    if (!state.selectedUrl) return '';
    if (/^https?:\/\//i.test(state.selectedUrl)) return state.selectedUrl;
    return `${window.location.origin}${state.selectedUrl}`;
  }

  function updateTabBadge() {
    const count = state.data?.htmlEntries?.length || 0;
    const badge = $('previewTabBadge');
    if (count > 0) {
      badge.textContent = String(count);
      badge.className = 'cli-tab-badge locked';
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  }

  function renderSelectAndFrame(reloadFrame = false) {
    const sel = $('previewTargetSelect');
    const entries = state.data?.htmlEntries || [];
    sel.innerHTML = '';

    if (!entries.length && !state.selectedUrl) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = t("未发现 HTML 产物（可点「+ 自定义地址」或先运行脚本）");
      sel.appendChild(opt);
    } else {
      const grpLabels = { prototype: t("原型"), build: t("构建"), page: t("页面") };
      for (const e of entries) {
        const opt = document.createElement('option');
        opt.value = e.previewPath;
        opt.dataset.label = e.relPath;
        opt.textContent = `[${grpLabels[e.group] || t("页面")}] ${e.relPath}`;
        if (e.previewPath === state.selectedUrl) opt.selected = true;
        sel.appendChild(opt);
      }
      if (state.selectedUrl && !entries.some((entry) => entry.previewPath === state.selectedUrl)) {
        const customOpt = document.createElement('option');
        customOpt.value = state.selectedUrl;
        customOpt.dataset.label = state.selectedUrl;
        customOpt.textContent = t("[本地服务] {0}", state.selectedUrl);
        customOpt.selected = true;
        sel.appendChild(customOpt);
      }
    }

    const customAdd = document.createElement('option');
    customAdd.value = '__custom_url__';
    customAdd.textContent = t("+ 输入自定义本机地址 (http://localhost:…)");
    sel.appendChild(customAdd);

    const frameWrap = $('previewFrameWrap');
    const frame = $('previewFrame');
    const empty = $('previewEmpty');
    const absUrl = getAbsolutePreviewUrl();

    if (!absUrl) {
      frame.src = 'about:blank';
      frameWrap.classList.add('hidden');
      empty.classList.remove('hidden');
      $('btnOpenPreviewExternal').disabled = true;
      $('btnReloadPreview').disabled = true;
      return;
    }

    empty.classList.add('hidden');
    frameWrap.classList.remove('hidden');
    $('btnOpenPreviewExternal').disabled = false;
    $('btnReloadPreview').disabled = false;

    frameWrap.dataset.viewport = state.viewport;
    if (reloadFrame || frame.dataset.loadedUrl !== absUrl) {
      const sep = absUrl.includes('?') ? '&' : '?';
      frame.dataset.loadedUrl = absUrl;
      frame.src = reloadFrame ? `${absUrl}${sep}_t=${Date.now()}` : absUrl;
    }
  }

  function renderScriptsAndRecent() {
    const scripts = state.data?.scripts || [];
    const bar = $('previewScriptsBar');
    bar.innerHTML = '';

    if (scripts.length) {
      const lbl = document.createElement('span');
      lbl.className = 'cli-bar-label';
      lbl.textContent = t("快捷验证");
      bar.appendChild(lbl);
      for (const s of scripts.slice(0, 6)) {
        const btn = document.createElement('button');
        btn.type = 'button';
        const isThisRunning = state.activeScript?.id === s.id && state.activeScript?.status === 'running';
        btn.className = `btn btn-sm${isThisRunning ? ' btn-emerald' : ''}`;
        btn.textContent = isThisRunning ? `● ${s.label}` : `▶ ${s.label}`;
        btn.title = s.detail || s.label;
        btn.onclick = () => runScript(s.id);
        bar.appendChild(btn);
      }
    }

    const recent = state.data?.recentFiles || [];
    const recBtn = document.createElement('button');
    recBtn.type = 'button';
    recBtn.className = `btn btn-sm${state.showRecent ? ' btn-primary' : ''}`;
    recBtn.textContent = t("最近产物 ({0})", recent.length);
    recBtn.onclick = () => {
      state.showRecent = !state.showRecent;
      renderScriptsAndRecent();
    };
    bar.appendChild(recBtn);

    // Recent files drawer
    const recBox = $('previewRecentBox');
    recBox.classList.toggle('hidden', !state.showRecent);
    if (state.showRecent) {
      recBox.innerHTML = recent.length
        ? recent.map((f) => {
            const time = f.mtime ? new Date(f.mtime).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) : '';
            const isHtml = /\.html?$/i.test(f.relPath);
            return `<div class="recent-file-row${isHtml ? ' clickable' : ''}" data-rel="${esc(f.relPath)}">
              <span class="mono-path">${isHtml ? '🌐 ' : '📄 '}${esc(f.relPath)}</span>
              <span class="muted">${fmtSize(f.size)} · ${time}</span>
            </div>`;
          }).join('')
        : `<div class="muted">${t("暂无最近产物文件")}</div>`;
      recBox.querySelectorAll('.recent-file-row.clickable').forEach((row) => {
        row.onclick = () => {
          const hit = (state.data?.htmlEntries || []).find((e) => e.relPath === row.dataset.rel);
          if (hit) {
            state.selectedUrl = hit.previewPath;
            state.selectedLabel = hit.relPath;
            state.showRecent = false;
            renderScriptsAndRecent();
            renderSelectAndFrame(true);
          }
        };
      });
    }

    // Active script log box
    const logBox = $('previewScriptLogBox');
    if (!state.activeScript) {
      logBox.classList.add('hidden');
      return;
    }
    logBox.classList.remove('hidden');
    const isRunning = state.activeScript.status === 'running';
    const status = { running: t("运行中"), failed: t("执行失败"), done: t("已完成"), stopped: t("已终止") };
    $('previewScriptTitle').textContent = `${state.activeScript.label} (${status[state.activeScript.status] || ''})`;
    $('btnStopPreviewScript').classList.toggle('hidden', !isRunning);
    const useUrlBtn = $('btnUseDetectedUrl');
    if (state.activeScript.detectedUrl) {
      useUrlBtn.textContent = t("预览 {0}", state.activeScript.detectedUrl);
      useUrlBtn.classList.remove('hidden');
      useUrlBtn.onclick = () => {
        state.selectedUrl = state.activeScript.detectedUrl;
        state.selectedLabel = state.activeScript.detectedUrl;
        renderSelectAndFrame(true);
      };
    } else {
      useUrlBtn.classList.add('hidden');
    }
    const pre = $('previewScriptLog');
    pre.textContent = state.activeScript.output || '';
    pre.scrollTop = pre.scrollHeight;
  }

  async function load(dir, { autoReload = false } = {}) {
    if (state.dir !== dir) {
      state.selectedUrl = '';
      state.selectedLabel = '';
      state.data = null;
    }
    state.dir = dir;
    if (!dir) {
      state.data = null;
      state.selectedUrl = '';
      state.selectedLabel = '';
      state.activeScript = null;
      updateTabBadge();
      renderSelectAndFrame(false);
      renderScriptsAndRecent();
      return;
    }
    try {
      const data = await api(`/api/deliverables?dir=${encodeURIComponent(dir)}`);
      if (state.dir !== dir) return;
      state.data = data;
      state.activeScript = data.activeScript || null;
      const entries = data.htmlEntries || [];
      const stillValid = entries.some((e) => e.previewPath === state.selectedUrl)
        || (state.selectedUrl && !state.selectedLabel.endsWith('.html') && state.selectedLabel === state.selectedUrl);
      if (!stillValid) {
        state.selectedUrl = entries[0]?.previewPath || '';
        state.selectedLabel = entries[0]?.relPath || '';
      }
      updateTabBadge();
      renderSelectAndFrame(autoReload);
      renderScriptsAndRecent();
    } catch (e) {
      showToast(t("扫描交付物失败：{0}", e.message));
    }
  }

  async function runScript(scriptId) {
    const dir = getActiveDir();
    if (!dir) return;
    try {
      const res = await api('/api/deliverables/run-script', {
        method: 'POST',
        body: JSON.stringify({ dir, scriptId })
      });
      state.activeScript = res.activeScript;
      renderScriptsAndRecent();
      showToast(t("已启动 {0}", res.activeScript.label));
    } catch (e) {
      showToast(e.message);
    }
  }

  async function stopScript() {
    const dir = getActiveDir();
    if (!dir) return;
    await api('/api/deliverables/stop-script', {
      method: 'POST',
      body: JSON.stringify({ dir })
    }).catch(() => {});
    if (state.activeScript) state.activeScript.status = 'stopped';
    renderScriptsAndRecent();
    showToast(t("已停止脚本"));
  }

  async function openInSystemBrowser() {
    const absUrl = getAbsolutePreviewUrl();
    if (!absUrl) return showToast(t("当前没有可打开的预览地址"));
    try {
      if (window.electronAPI?.openExternal) {
        await window.electronAPI.openExternal(absUrl);
      } else {
        await api('/api/open-url', { method: 'POST', body: JSON.stringify({ targetUrl: absUrl }) });
      }
    } catch (e) {
      showToast(e.message);
    }
  }

  async function submitFeedbackToReviewLog() {
    const dir = getActiveDir();
    const note = $('previewFeedbackInput').value.trim();
    if (!dir) return;
    if (!note) return showToast(t("请先输入验收发现的问题或改进意见"));
    try {
      await api('/api/deliverables/feedback', {
        method: 'POST',
        body: JSON.stringify({ dir, target: state.selectedLabel || state.selectedUrl || t("交付预览"), note })
      });
      $('previewFeedbackInput').value = '';
      showToast(t("已写入 docs/05-review-log.md 验收单"));
      if (onFeedbackSaved) onFeedbackSaved();
    } catch (e) {
      showToast(e.message);
    }
  }

  async function sendFeedbackToRework() {
    const dir = getActiveDir();
    const note = $('previewFeedbackInput').value.trim();
    if (!dir) return;
    if (!note) return showToast(t("请先输入需要返工修复的具体现象或期望"));
    const target = state.selectedLabel || state.selectedUrl || t("当前交付产物");
    // Also record into 05-review-log.md for SSOT traceability
    await api('/api/deliverables/feedback', {
      method: 'POST',
      body: JSON.stringify({ dir, target, note })
    }).catch(() => {});
    $('previewFeedbackInput').value = '';
    const promptText = [
      t("【交付验收返工单】人工验收产物「{0}」时发现以下问题，请按规范直接修复并自测：", target),
      ``,
      t("- 验收问题与期望：{0}", note),
      t("- 产物位置：{0}", target),
      ``,
      t("要求：修完后排查同类位置避免遗漏，并将本次修复记录同步到 docs/05-review-log.md。")
    ].join('\n');
    if (onSendRework) onSendRework(promptText);
    if (onFeedbackSaved) onFeedbackSaved();
    showToast(t("已记入 05-review-log.md 并填入左侧返工指令，选定模型点「运行」即可修复"));
  }

  function handleSseEvent(evt) {
    if (!evt || !evt.type || !evt.type.startsWith('script:')) return;
    if (!state.dir || !evt.dir || evt.dir.toLowerCase() !== state.dir.toLowerCase()) return;
    if (!state.activeScript) {
      state.activeScript = { id: evt.id, label: evt.id, status: 'running', detectedUrl: '', output: '' };
    }
    if (evt.type === 'script:output') {
      state.activeScript.output = (state.activeScript.output || '') + (evt.chunk || '');
      if (evt.detectedUrl) state.activeScript.detectedUrl = evt.detectedUrl;
      renderScriptsAndRecent();
      return;
    }
    if (evt.type === 'script:exit') {
      state.activeScript.status = evt.status || 'done';
      if (evt.detectedUrl) state.activeScript.detectedUrl = evt.detectedUrl;
      renderScriptsAndRecent();
    }
  }

  // Bind controls
  $('previewTargetSelect').onchange = (e) => {
    if (e.target.value === '__custom_url__') {
      const u = prompt(t("输入本机预览地址（仅限 http://127.0.0.1 或 http://localhost）："), 'http://localhost:5173');
      if (u && /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/i.test(u.trim())) {
        state.selectedUrl = u.trim();
        state.selectedLabel = u.trim();
      } else if (u) {
        showToast(t("请输入合法的本机 http://localhost 或 http://127.0.0.1 地址"));
      }
      renderSelectAndFrame(true);
      return;
    }
    state.selectedUrl = e.target.value;
    state.selectedLabel = e.target.selectedOptions[0]?.dataset?.label || e.target.value;
    renderSelectAndFrame(true);
  };

  $('previewViewportSelect').onchange = (e) => {
    state.viewport = e.target.value;
    $('previewFrameWrap').dataset.viewport = state.viewport;
  };

  $('btnReloadPreview').onclick = () => renderSelectAndFrame(true);
  $('btnOpenPreviewExternal').onclick = openInSystemBrowser;
  $('btnRescanDeliverables').onclick = () => {
    if (state.dir) load(state.dir, { autoReload: true }).then(() => showToast(t("已重新扫描交付产物")));
  };
  $('btnStopPreviewScript').onclick = stopScript;
  $('btnCloseScriptLog').onclick = () => {
    state.activeScript = null;
    renderScriptsAndRecent();
  };
  $('btnLogFeedback').onclick = submitFeedbackToReviewLog;
  $('btnReworkFeedback').onclick = sendFeedbackToRework;
  $('btnApproveGate').onclick = () => {
    if (onApproveCurrentGate) onApproveCurrentGate();
  };

  return {
    load,
    handleSseEvent,
    refreshIfLoaded() {
      if (state.dir) load(state.dir, { autoReload: false });
    }
  };
}
