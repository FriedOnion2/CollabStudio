let toastTimer = null;

export async function api(url, opts = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `请求失败 (${res.status})`);
  return data;
}

export function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2400);
}

export function createDocsPanel({ onSaved }) {
  const tabsEl = document.getElementById('docTabs');
  const editorEl = document.getElementById('docEditor');
  const statusEl = document.getElementById('docStatus');
  const saveBtn = document.getElementById('btnSaveDoc');

  let currentDir = null;
  let currentFile = 'docs/01-brief.md';
  let dirty = false;

  function setStatus(text) {
    statusEl.textContent = text;
  }

  async function loadDoc(dir, file) {
    currentDir = dir;
    currentFile = file;
    setStatus('读取中…');
    try {
      const data = await api(`/api/doc?dir=${encodeURIComponent(dir)}&file=${encodeURIComponent(file)}`);
      editorEl.value = data.content || '';
      dirty = false;
      setStatus(data.exists ? '已同步' : '文件尚未创建（保存即创建）');
    } catch (e) {
      setStatus('读取失败');
      showToast(e.message);
    }
  }

  async function saveDoc() {
    if (!currentDir || !currentFile) return;
    setStatus('保存中…');
    try {
      await api('/api/doc', {
        method: 'PUT',
        body: JSON.stringify({ dir: currentDir, file: currentFile, content: editorEl.value })
      });
      dirty = false;
      setStatus('已保存');
      showToast(`已保存 ${currentFile}`);
      if (onSaved) onSaved(currentFile);
    } catch (e) {
      setStatus('保存失败');
      showToast(e.message);
    }
  }

  editorEl.addEventListener('input', () => {
    dirty = true;
    setStatus('未保存 (Ctrl+S)');
  });

  editorEl.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      saveDoc();
    }
  });

  saveBtn.addEventListener('click', saveDoc);

  return {
    async render(project, preserveFile = true) {
      const dirChanged = currentDir !== project.dir;
      if (!preserveFile || dirChanged || !project.docs.some((d) => d.key === currentFile)) {
        currentFile = 'docs/01-brief.md';
      }
      tabsEl.innerHTML = '';
      for (const doc of project.docs) {
        const btn = document.createElement('button');
        btn.className = `tab doc-tab${doc.key === currentFile ? ' active' : ''}`;
        btn.textContent = doc.label;
        btn.title = `${doc.key} (${doc.owner})`;
        btn.onclick = () => {
          if (dirty && !confirm('当前文档有未保存修改，确定切换吗？')) return;
          tabsEl.querySelectorAll('.doc-tab').forEach((t) => t.classList.remove('active'));
          btn.classList.add('active');
          loadDoc(project.dir, doc.key);
        };
        tabsEl.appendChild(btn);
      }
      if (!dirty || dirChanged) await loadDoc(project.dir, currentFile);
    }
  };
}
