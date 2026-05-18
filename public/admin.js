'use strict';

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

let token = localStorage.getItem('dk:adminToken') || null;
let bank = [];
let pendingMediaUrl = '';
let schedulePicks = new Set();
let schedules = {};
let serverToday = '';

function show(id, on = true) { $(id).hidden = !on; }
function setError(id, msg) {
  const el = $(id);
  if (!msg) { el.hidden = true; el.textContent = ''; return; }
  el.hidden = false; el.textContent = msg;
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { ...(opts.headers||{}), 'x-admin-token': token || '' },
  });
  if (res.status === 401) {
    localStorage.removeItem('dk:adminToken'); token = null;
    showLogin(); throw new Error('unauthorized');
  }
  return res;
}

function showLogin() {
  show('#loginPanel', true);
  show('#composerPanel', false);
  show('#bankPanel', false);
  show('#schedulerPanel', false);
}
function showAdmin() {
  show('#loginPanel', false);
  show('#composerPanel', true);
  show('#bankPanel', true);
  show('#schedulerPanel', true);
  loadBank().then(loadSchedules);
}

async function loadBank() {
  const r = await api('/api/admin/clues');
  bank = await r.json();
  renderBank();
  renderSchedulePicker();
}

async function loadSchedules() {
  const r = await api('/api/admin/schedules');
  const data = await r.json();
  schedules = data.schedules || {};
  serverToday = data.today || '';
  const dateInput = document.getElementById('scheduleDate');
  if (dateInput && !dateInput.min) {
    // min = tomorrow
    const t = new Date(serverToday + 'T00:00:00');
    t.setDate(t.getDate() + 1);
    const y = t.getFullYear();
    const m = String(t.getMonth() + 1).padStart(2, '0');
    const d = String(t.getDate()).padStart(2, '0');
    dateInput.min = `${y}-${m}-${d}`;
  }
  renderScheduleList();
}

function renderBank() {
  const q = ($('#bankSearch').value || '').toLowerCase();
  const t = $('#bankType').value;
  const filtered = bank.filter((c) =>
    (!t || c.type === t) &&
    (!q || c.clue.toLowerCase().includes(q) || c.answer.toLowerCase().includes(q))
  );
  $('#bankCount').textContent = `· ${filtered.length} / ${bank.length}`;
  const ul = $('#bankList');
  ul.innerHTML = '';
  for (const c of filtered.slice().reverse()) {
    const li = document.createElement('li');
    const typeLabel = { text: 'tekst', image: 'obraz', audio: 'dźwięk' }[c.type] || 'tekst';
    li.innerHTML = `
      <span class="tag">${typeLabel}</span>
      <span><strong class="ans">${escapeHtml(c.answer)}</strong> — ${escapeHtml(c.clue)}</span>
      <span class="muted">${c.media ? '✦' : ''}</span>
      <button class="del" data-id="${c.id}">usuń</button>`;
    ul.appendChild(li);
  }
  $$('#bankList .del').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Usunąć to hasło z banku?')) return;
    await api(`/api/admin/clues/${b.dataset.id}`, { method: 'DELETE' });
    loadBank();
  }));
}

function renderSchedulePicker() {
  const ul = document.getElementById('schedulePicker');
  if (!ul) return;
  const q = (document.getElementById('scheduleSearch').value || '').toLowerCase();
  const items = bank.filter((c) =>
    !q || c.clue.toLowerCase().includes(q) || c.answer.toLowerCase().includes(q)
  );
  ul.innerHTML = '';
  for (const c of items) {
    const li = document.createElement('li');
    const checked = schedulePicks.has(c.id) ? 'checked' : '';
    const typeLabel = { text: 'tekst', image: 'obraz', audio: 'dźwięk' }[c.type] || 'tekst';
    li.innerHTML = `
      <label>
        <input type="checkbox" data-id="${c.id}" ${checked} />
        <span class="tag">${typeLabel}</span>
        <strong class="ans">${escapeHtml(c.answer)}</strong>
        <span class="muted">— ${escapeHtml(c.clue)}</span>
      </label>`;
    ul.appendChild(li);
  }
  ul.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener('change', () => {
      if (cb.checked) schedulePicks.add(cb.dataset.id); else schedulePicks.delete(cb.dataset.id);
      document.getElementById('schedulePickCount').textContent = `· ${schedulePicks.size} wybranych`;
    });
  });
  document.getElementById('schedulePickCount').textContent = `· ${schedulePicks.size} wybranych`;
}

function renderScheduleList() {
  const ul = document.getElementById('scheduleList');
  if (!ul) return;
  ul.innerHTML = '';
  const keys = Object.keys(schedules).sort();
  if (keys.length === 0) {
    ul.innerHTML = '<li class="muted">Brak zaplanowanych wydań.</li>';
    return;
  }
  const byId = new Map(bank.map((c) => [c.id, c]));
  for (const date of keys) {
    const ids = schedules[date] || [];
    const li = document.createElement('li');
    const previews = ids
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map((c) => escapeHtml(c.answer))
      .slice(0, 6)
      .join(', ');
    const more = ids.length > 6 ? `, +${ids.length - 6}` : '';
    const isPast = serverToday && date <= serverToday;
    li.innerHTML = `
      <div class="sched-date">${date}${isPast ? ' <span class="muted">(minęła)</span>' : ''}</div>
      <div class="sched-preview">${ids.length} hasła: <span class="muted">${previews}${more}</span></div>
      <div class="sched-actions">
        <button class="ghost" type="button" data-preview="${date}">podgląd</button>
        <button class="ghost" type="button" data-edit="${date}">edytuj</button>
        <button class="del" type="button" data-del="${date}">usuń</button>
      </div>`;
    ul.appendChild(li);
  }
  ul.querySelectorAll('button[data-preview]').forEach((b) => b.addEventListener('click', () => {
    openPreview(b.dataset.preview);
  }));
  ul.querySelectorAll('button[data-edit]').forEach((b) => b.addEventListener('click', () => {
    const date = b.dataset.edit;
    document.getElementById('scheduleDate').value = date;
    schedulePicks = new Set(schedules[date] || []);
    renderSchedulePicker();
    window.scrollTo({ top: document.getElementById('schedulerPanel').offsetTop - 20, behavior: 'smooth' });
  }));
  ul.querySelectorAll('button[data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm(`Usunąć plan na ${b.dataset.del}?`)) return;
    await api(`/api/admin/schedule/${b.dataset.del}`, { method: 'DELETE' });
    loadSchedules();
  }));
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

async function openPreview(date) {
  const modal = document.getElementById('previewModal');
  const titleEl = document.getElementById('previewTitle');
  const grid = document.getElementById('previewGrid');
  const across = document.getElementById('previewAcross');
  const down = document.getElementById('previewDown');
  const unplacedEl = document.getElementById('previewUnplaced');
  titleEl.textContent = date;
  grid.innerHTML = '<div class="muted" style="padding:24px">Ładowanie…</div>';
  across.innerHTML = '';
  down.innerHTML = '';
  unplacedEl.hidden = true;
  unplacedEl.textContent = '';
  modal.hidden = false;

  let puzzle;
  try {
    const r = await api(`/api/admin/puzzle/${date}`);
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      grid.innerHTML = `<div class="muted" style="padding:24px">${escapeHtml(data.error || 'Nie udało się wczytać podglądu.')}</div>`;
      return;
    }
    puzzle = await r.json();
  } catch {
    grid.innerHTML = '<div class="muted" style="padding:24px">Brak połączenia z serwerem.</div>';
    return;
  }

  const { rows, cols } = puzzle.size;
  grid.style.gridTemplateColumns = `repeat(${cols}, var(--cell-size, 32px))`;
  grid.style.setProperty('--cell-size', `${cols > 14 ? 26 : 32}px`);
  grid.innerHTML = '';
  // Build expected letter per cell from placements — preferuj wersję z polskimi znakami.
  const letters = {};
  for (const p of puzzle.placements) {
    const display = (p.answerDisplay && p.answerDisplay.length === p.answer.length)
      ? p.answerDisplay
      : p.answer;
    for (let i = 0; i < p.length; i++) {
      const r = p.row + (p.dir === 'down' ? i : 0);
      const c = p.col + (p.dir === 'across' ? i : 0);
      const key = `${r},${c}`;
      // Pierwszeństwo: litera ze znakiem diakrytycznym, jeśli już ustawiona — nie nadpisuj literą bazową.
      const ch = display[i];
      if (!letters[key] || (letters[key] === p.answer[i] && ch !== p.answer[i])) {
        letters[key] = ch;
      }
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cellData = puzzle.cells[r][c];
      const div = document.createElement('div');
      div.className = 'cell preview-cell' + (cellData ? '' : ' block');
      if (cellData) {
        if (cellData.number) {
          const n = document.createElement('span');
          n.className = 'num';
          n.textContent = cellData.number;
          div.appendChild(n);
        }
        const span = document.createElement('span');
        span.className = 'letter';
        span.textContent = letters[`${r},${c}`] || '';
        div.appendChild(span);
      }
      grid.appendChild(div);
    }
  }

  const renderList = (ul, items) => {
    items.sort((a, b) => a.number - b.number);
    for (const p of items) {
      const li = document.createElement('li');
      const mediaTag = p.type === 'image' ? ' <span class="tag">obraz</span>' :
                       p.type === 'audio' ? ' <span class="tag">dźwięk</span>' : '';
      const ans = p.answerDisplay || p.answer;
      li.innerHTML = `<span class="num">${p.number}.</span> <span>${escapeHtml(p.clue)} <span class="muted">(${p.length})</span>${mediaTag} — <strong class="ans">${escapeHtml(ans)}</strong></span>`;
      ul.appendChild(li);
    }
  };
  renderList(across, puzzle.placements.filter((p) => p.dir === 'across'));
  renderList(down, puzzle.placements.filter((p) => p.dir === 'down'));

  if (puzzle.unplaced && puzzle.unplaced.length) {
    unplacedEl.hidden = false;
    const names = puzzle.unplaced.map((u) => escapeHtml(u.answer || u.clue || '?')).join(', ');
    unplacedEl.innerHTML = `Nie udało się umieścić: ${names}`;
  }
}

function closePreview() {
  const modal = document.getElementById('previewModal');
  if (modal) modal.hidden = true;
}

function updateMediaUi() {
  const type = (document.querySelector('input[name="type"]:checked') || {}).value || 'text';
  const mediaField = $('#mediaField');
  if (type === 'text') { mediaField.hidden = true; pendingMediaUrl = ''; previewMedia(null); return; }
  mediaField.hidden = false;
  $('#mediaLabel').textContent = type === 'image' ? 'Plik graficzny' : 'Plik dźwiękowy';
  $('#mediaFile').accept = type === 'image' ? 'image/*' : 'audio/*';
  $('#mediaHint').textContent = type === 'image'
    ? 'Wgraj obraz (jpg/png/svg/webp) lub wklej publiczny URL.'
    : 'Wgraj plik dźwiękowy (mp3/ogg/wav) lub wklej publiczny URL.';
  previewMedia(pendingMediaUrl || $('#mediaUrl').value || null);
}

function previewMedia(url) {
  const wrap = $('#mediaPreview');
  if (!url) { wrap.hidden = true; wrap.innerHTML = ''; return; }
  wrap.hidden = false;
  const type = (document.querySelector('input[name="type"]:checked') || {}).value || 'text';
  if (type === 'audio') {
    wrap.innerHTML = `<audio controls src="${url}"></audio>`;
  } else {
    wrap.innerHTML = `<img src="${url}" alt="podgląd" />`;
  }
}

async function uploadFile(file) {
  const fd = new FormData(); fd.append('file', file);
  const res = await api('/api/admin/upload', { method: 'POST', body: fd });
  if (!res.ok) throw new Error('upload failed');
  const data = await res.json();
  return data.url;
}

// ---------- Events ----------
document.addEventListener('DOMContentLoaded', () => {
  if (token) showAdmin(); else showLogin();

  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    setError('#loginError', '');
    const password = $('#password').value;
    const r = await fetch('/api/admin/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (!r.ok) { setError('#loginError', 'Nieprawidłowe hasło.'); return; }
    const data = await r.json();
    token = data.token;
    localStorage.setItem('dk:adminToken', token);
    showAdmin();
  });

  $$('input[name="type"]').forEach((r) => r.addEventListener('change', updateMediaUi));

  $('#mediaFile').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      pendingMediaUrl = await uploadFile(f);
      $('#mediaUrl').value = '';
      previewMedia(pendingMediaUrl);
    } catch { setError('#formError', 'Nie udało się wgrać pliku.'); }
  });
  $('#mediaUrl').addEventListener('input', (e) => {
    pendingMediaUrl = e.target.value.trim();
    previewMedia(pendingMediaUrl);
  });

  $('#clearForm').addEventListener('click', () => {
    $('#clueForm').reset();
    pendingMediaUrl = '';
    updateMediaUi();
    setError('#formError',''); setError('#formOk','');
  });

  $('#clueForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    setError('#formError', ''); setError('#formOk', '');
    const answer = $('#answer').value.trim();
    const clue = $('#clue').value.trim();
    const type = (document.querySelector('input[name="type"]:checked') || {}).value || 'text';
    const media = pendingMediaUrl || $('#mediaUrl').value.trim() || null;
    if (!answer || !clue) { setError('#formError','Podaj hasło i pytanie.'); return; }
    if (type !== 'text' && !media) { setError('#formError','Dodaj plik lub URL dla hasła multimedialnego.'); return; }
    if (!/[a-ząćęłńóśźż0-9]/i.test(answer)) { setError('#formError','Hasło musi zawierać litery lub cyfry.'); return; }
    const r = await api('/api/admin/clues', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answer, clue, type, media }),
    });
    if (!r.ok) { setError('#formError','Nie udało się zapisać.'); return; }
    setError('#formOk','Dodano do banku.');
    $('#clueForm').reset(); pendingMediaUrl = ''; updateMediaUi();
    loadBank();
  });

  $('#bankSearch').addEventListener('input', renderBank);
  $('#bankType').addEventListener('change', renderBank);

  // Scheduler
  $('#scheduleSearch').addEventListener('input', renderSchedulePicker);
  $('#clearScheduleForm').addEventListener('click', () => {
    schedulePicks = new Set();
    document.getElementById('scheduleDate').value = '';
    setError('#scheduleError',''); setError('#scheduleOk','');
    renderSchedulePicker();
  });
  document.querySelectorAll('#previewModal [data-close]').forEach((el) =>
    el.addEventListener('click', closePreview)
  );
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePreview();
  });

  $('#saveSchedule').addEventListener('click', async () => {
    setError('#scheduleError',''); setError('#scheduleOk','');
    const date = document.getElementById('scheduleDate').value;
    if (!date) { setError('#scheduleError','Wybierz datę.'); return; }
    if (schedulePicks.size === 0) { setError('#scheduleError','Zaznacz przynajmniej jedno hasło.'); return; }
    const r = await api(`/api/admin/schedule/${date}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clueIds: Array.from(schedulePicks) }),
    });
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      setError('#scheduleError', data.error || 'Nie udało się zapisać planu.');
      return;
    }
    setError('#scheduleOk', `Plan na ${date} zapisany.`);
    loadSchedules();
  });
});
