(() => {
  'use strict';
  const data = JSON.parse(document.getElementById('book-data').textContent);
  const $ = id => document.getElementById(id);
  const pages = data.pages;
  const anchorRoutes = data.anchors || {};
  const stateKey = 'agent-eval-reading-book-v1';
  const valid = new Set(pages.map(p => p.id));
  let state = { notes: {}, done: {}, last: 'start', theme: 'light', font: 18 };
  let storageAvailable = true;
  try {
    const stored = JSON.parse(localStorage.getItem(stateKey) || 'null');
    if (stored && typeof stored === 'object') {
      if (stored.notes && typeof stored.notes === 'object') state.notes = stored.notes;
      if (stored.done && typeof stored.done === 'object') state.done = stored.done;
      if (valid.has(stored.last)) state.last = stored.last;
      if (stored.theme === 'dark') state.theme = 'dark';
      if (typeof stored.font === 'number' && stored.font >= 15 && stored.font <= 24) state.font = stored.font;
    }
  } catch { storageAvailable = false; }
  let current = '';
  let toastTimer;
  const toast = message => { $('toast').textContent = message; $('toast').classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('show'), 3500); };
  const persist = () => {
    if (!storageAvailable) return false;
    try { localStorage.setItem(stateKey, JSON.stringify(state)); return true; }
    catch { storageAvailable = false; return false; }
  };
  function progress() {
    const count = pages.filter(p => /^E\d\d$/.test(p.id) && state.done[p.id] === true).length;
    $('progress').value = count; $('progress-text').textContent = `${count} / 18`;
    document.querySelectorAll('[data-route]').forEach(a => {
      const checked = state.done[a.dataset.route] === true;
      a.querySelector('.nav-check').textContent = checked ? '✓' : '';
      a.setAttribute('aria-label', a.textContent.trim() + (checked ? '，已自评完成' : ''));
    });
  }
  function settings() {
    document.documentElement.dataset.theme = state.theme;
    document.documentElement.style.setProperty('--font-size', state.font + 'px');
    $('smaller').disabled = state.font <= 15; $('larger').disabled = state.font >= 24;
  }
  function render() {
    let id;
    try { id = decodeURIComponent(location.hash.slice(1)); } catch { id = ''; }
    if (id === 'main') { $('main').focus(); return; }
    const targetAnchor = Object.hasOwn(anchorRoutes, id) ? id : null;
    if(targetAnchor) id=anchorRoutes[targetAnchor];
    if (!valid.has(id)) { id = valid.has(state.last) ? state.last : 'start'; history.replaceState(null, '', '#' + id); }
    const previous = current; current = id;
    document.querySelectorAll('[data-page]').forEach(p => p.classList.toggle('active', p.id === id));
    document.querySelectorAll('[data-route]').forEach(a => {
      const active = a.dataset.route === id; a.classList.toggle('active', active);
      if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    const index = pages.findIndex(p => p.id === id), page = pages[index];
    $('breadcrumb').textContent = page.group + ' / ' + page.title;
    document.title = page.title + ' · Agent 轨迹评测阅读手册';
    $('learning-panel').hidden = id === 'contents' || id === 'sources';
    $('done-label').hidden = !/^E\d\d$/.test(id);
    $('task-done').checked = state.done[id] === true;
    $('notes').value = typeof state.notes[id] === 'string' ? state.notes[id] : '';
    $('save-status').textContent = storageAvailable ? '笔记仅保存在当前浏览器，可导出备份。' : '浏览器持久存储不可用：本次笔记仍可编辑，请导出备份。';
    $('pager').hidden = false;
    const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const prev = pages[index - 1], next = pages[index + 1];
    $('prev').hidden = !prev; $('next').hidden = !next;
    if (prev) { $('prev').href = '#' + prev.id; $('prev').innerHTML = '<small>← 上一节</small>' + esc(prev.title); }
    if (next) { $('next').href = '#' + next.id; $('next').innerHTML = '<small>下一节 →</small>' + esc(next.title); }
    state.last = id; persist();
    document.body.classList.remove('sidebar-open'); $('menu').setAttribute('aria-expanded', 'false');
    if (previous !== id) { window.scrollTo({ top: 0, behavior: 'instant' }); if (previous) $('main').focus({ preventScroll: true }); }
    if(targetAnchor) $(targetAnchor)?.scrollIntoView({behavior:'instant',block:'start'});
  }
  // The full table of contents is built from the same route registry as the sidebar.
  const toc = $('full-contents'); let group = '', list;
  pages.forEach(p => {
    if (p.id === 'contents') return;
    if (p.group !== group) {
      const section = document.createElement('section'); section.className = 'toc-group';
      const h = document.createElement('h2'); h.textContent = p.group; section.append(h);
      list = document.createElement('ul'); section.append(list); toc.append(section); group = p.group;
    }
    const li = document.createElement('li'), a = document.createElement('a'); a.href = '#' + p.id; a.textContent = p.title; li.append(a); list.append(li);
  });
  const searchIndex = pages.map(p => ({ ...p, text: $(p.id).textContent.replace(/\s+/g, ' ') }));
  $('search').addEventListener('input', () => {
    const q = $('search').value.trim().toLocaleLowerCase(); const results = $('search-results'); results.replaceChildren();
    $('book-nav').hidden = Boolean(q); results.hidden = !q;
    if (!q) return;
    const hits = searchIndex.filter(p => p.text.toLocaleLowerCase().includes(q) || p.title.toLocaleLowerCase().includes(q));
    const count = document.createElement('p'); count.className = 'search-count'; count.textContent = hits.length ? `找到 ${hits.length} 节 · 点击跳转` : '没有找到，试试更短的词。'; results.append(count);
    hits.forEach(p => {
      const a = document.createElement('a'); a.className = 'search-result'; a.href = '#' + p.id;
      const title = document.createElement('strong'); title.textContent = p.title; a.append(title);
      const snippet = document.createElement('small'); const pos = p.text.toLocaleLowerCase().indexOf(q);
      snippet.textContent = (pos > 20 ? '…' : '') + p.text.slice(Math.max(0, pos - 20), Math.max(0, pos - 20) + 95) + '…'; a.append(snippet); results.append(a);
    });
  });
  $('notes').addEventListener('input', () => {
    state.notes[current] = $('notes').value;
    $('save-status').textContent = persist() ? '已自动保存到当前浏览器。' : '持久存储不可用，请导出学习记录。';
  });
  $('task-done').addEventListener('change', () => { if (/^E\d\d$/.test(current)) { state.done[current] = $('task-done').checked; persist(); progress(); } });
  $('smaller').addEventListener('click', () => { state.font = Math.max(15, state.font - 1); settings(); persist(); });
  $('larger').addEventListener('click', () => { state.font = Math.min(24, state.font + 1); settings(); persist(); });
  $('theme').addEventListener('click', () => { state.theme = state.theme === 'light' ? 'dark' : 'light'; settings(); persist(); });
  $('print').addEventListener('click', () => window.print());
  $('menu').addEventListener('click', () => { const open = document.body.classList.toggle('sidebar-open'); $('menu').setAttribute('aria-expanded', String(open)); });
  $('export').addEventListener('click', () => {
    const contents = { format: 'agent-eval-reading-record', version: 1, edition: data.edition, exportedAt: new Date().toISOString(), state };
    const url = URL.createObjectURL(new Blob([JSON.stringify(contents, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'Agent归因学习记录.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); toast('已导出当前笔记与自评进度。');
  });
  $('import').addEventListener('change', async () => {
    const file = $('import').files[0]; if (!file) return;
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('文件过大');
      const incoming = JSON.parse(await file.text());
      if (incoming.format !== 'agent-eval-reading-record' || incoming.version !== 1 || !incoming.state) throw new Error('记录格式不匹配');
      // Merge valid records. Do not overwrite existing non-empty notes with imported notes.
      let count = 0;
      pages.forEach(p => {
        const note = incoming.state.notes?.[p.id];
        if (typeof note === 'string' && note.trim()) {
          const old = state.notes[p.id] || '';
          state.notes[p.id] = old && old !== note && !old.includes(note) ? old + '\n\n—— 导入记录 ——\n' + note : old || note; count++;
        }
        if (/^E\d\d$/.test(p.id) && incoming.state.done?.[p.id] === true) state.done[p.id] = true;
      });
      if (valid.has(incoming.state.last)) {
        state.last = incoming.state.last;
        history.replaceState(null, '', '#' + state.last);
      }
      if (['light', 'dark'].includes(incoming.state.theme)) state.theme = incoming.state.theme;
      if (typeof incoming.state.font === 'number' && incoming.state.font >= 15 && incoming.state.font <= 24) state.font = incoming.state.font;
      persist(); settings(); render(); progress(); toast(`已合并学习记录，包含 ${count} 节笔记，并恢复阅读位置。`);
    } catch (error) { toast('导入失败：' + error.message); }
    finally { $('import').value = ''; }
  });
  let sourceReturnFocus;
  function showSource(link) {
    const name = link.dataset.source; const source = data.sources[name];
    if (!source) { toast('来源不存在，请检查阅读版生成记录。'); return; }
    sourceReturnFocus = link;
    $('source-title').textContent = name;
    $('source-hash').textContent = 'SHA-256: ' + source.hash + ' · 仅展示文本，未执行';
    const container = $('source-code'); container.replaceChildren();
    const symbol = link.dataset.symbol || ''; const lines = source.text.split('\n');
    const symbolAt = symbol ? lines.findIndex(t => t.includes(symbol)) : -1;
    const fragment = document.createDocumentFragment();
    lines.forEach((text, index) => {
      const row = document.createElement('span'); row.className = 'source-line' + (index === symbolAt ? ' highlight' : '');
      const number = document.createElement('span'); number.className = 'line-number'; number.textContent = String(index + 1); row.append(number, document.createTextNode(text || ' ')); fragment.append(row);
    });
    container.append(fragment); $('source-dialog').showModal();
    if (symbolAt >= 0) container.scrollTop = Math.max(0, (symbolAt - 3) * parseFloat(getComputedStyle(container).lineHeight)); else container.scrollTop = 0;
    if (symbol && symbolAt < 0) toast('文件已打开，未匹配符号：' + symbol);
  }
  document.addEventListener('click', event => {
    const link = event.target.closest('[data-source]');
    if (link) { event.preventDefault(); showSource(link); }
  });
  $('close-source').addEventListener('click', () => $('source-dialog').close());
  $('source-dialog').addEventListener('close', () => sourceReturnFocus?.focus());
  document.addEventListener('keydown', event => {
    const editing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '');
    if (event.key === '/' && !editing && !$('source-dialog').open) { event.preventDefault(); $('search').focus(); }
    if (event.key === 'Escape' && document.body.classList.contains('sidebar-open')) { document.body.classList.remove('sidebar-open'); $('menu').setAttribute('aria-expanded', 'false'); }
  });
  window.addEventListener('hashchange', render);
  settings(); progress(); render();
  document.documentElement.classList.add('enhanced');
})();
