'use strict';

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));

const PL_MONTHS = ['stycznia','lutego','marca','kwietnia','maja','czerwca','lipca','sierpnia','września','października','listopada','grudnia'];
const PL_MONTHS_TITLE = ['Styczeń','Luty','Marzec','Kwiecień','Maj','Czerwiec','Lipiec','Sierpień','Wrzesień','Październik','Listopad','Grudzień'];

const state = {
  date: null,
  puzzle: null,
  answers: {},        // "r,c" -> letter
  activeEntry: null,  // placement object
  cellMap: {},        // "r,c" -> entries [{placement, index}]
};

const LAUNCH = new Date(2026, 4, 18); // 18 maja 2026 — pierwsze wydanie
const LAUNCH_KEY = '2026-05-18';
const EPOCH = LAUNCH;

function fmtDate(date) {
  const d = new Date(date + 'T00:00:00');
  return `${d.getDate()} ${PL_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
function issueNumber(date) {
  const d = new Date(date + 'T00:00:00');
  const diff = Math.floor((d - EPOCH) / 86400000) + 1;
  return diff > 0 ? diff : 1;
}
function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function storeKey(date) { return `dk:answers:${date}`; }
function resultKey(date) { return `dk:result:${date}`; }

function loadAnswers(date) {
  try { return JSON.parse(localStorage.getItem(storeKey(date)) || '{}'); }
  catch { return {}; }
}
function saveAnswers(date, answers) {
  localStorage.setItem(storeKey(date), JSON.stringify(answers));
}

// ---------- Load puzzle ----------
async function loadPuzzle(date) {
  state.date = date;
  state.answers = loadAnswers(date);
  $('#date').textContent = fmtDate(date);
  $('#issue').textContent = `№ ${issueNumber(date)}`;
  $('#result').hidden = true;

  try {
    const res = await fetch(`/api/puzzle?date=${date}`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      showMessage(data.error === 'no clues yet' ? 'Bank haseł jest pusty. Wejdź do redakcji i dodaj pierwsze hasła.' : 'Nie udało się wczytać krzyżówki.');
      return;
    }
    state.puzzle = await res.json();
    render();
  } catch (e) {
    showMessage('Brak połączenia z serwerem.');
  }
}

function showMessage(msg) {
  $('#grid').innerHTML = `<div style="padding:32px;font-family:var(--serif);font-style:italic;color:var(--ink-soft);text-align:center">${msg}</div>`;
  $('#cluesAcross').innerHTML = '';
  $('#cluesDown').innerHTML = '';
}

// ---------- Render ----------
function render() {
  const { puzzle } = state;
  const { rows, cols } = puzzle.size;
  const grid = $('#grid');
  grid.style.gridTemplateColumns = `repeat(${cols}, var(--cell-size, 44px))`;
  grid.innerHTML = '';

  state.cellMap = {};
  for (const p of puzzle.placements) {
    for (let i = 0; i < p.length; i++) {
      const r = p.row + (p.dir === 'down' ? i : 0);
      const c = p.col + (p.dir === 'across' ? i : 0);
      const key = `${r},${c}`;
      (state.cellMap[key] ||= []).push({ placement: p, index: i });
    }
  }

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cellData = puzzle.cells[r][c];
      const div = document.createElement('div');
      div.className = 'cell' + (cellData ? '' : ' block');
      div.dataset.r = r; div.dataset.c = c;
      if (cellData) {
        if (cellData.number) {
          const n = document.createElement('span'); n.className = 'num';
          n.textContent = cellData.number; div.appendChild(n);
        }
        const inp = document.createElement('input');
        inp.maxLength = 1;
        inp.value = state.answers[`${r},${c}`] || '';
        inp.dataset.r = r; inp.dataset.c = c;
        inp.autocomplete = 'off'; inp.spellcheck = false;
        inp.addEventListener('input', onCellInput);
        inp.addEventListener('keydown', onCellKey);
        inp.addEventListener('focus', () => setActiveFromCell(r, c));
        div.appendChild(inp);
        div.addEventListener('click', () => {
          if (document.activeElement === inp) toggleDirection(r, c);
        });
      }
      grid.appendChild(div);
    }
  }

  // Clues lists
  const across = puzzle.placements.filter((p) => p.dir === 'across').sort((a,b)=>a.number-b.number);
  const down   = puzzle.placements.filter((p) => p.dir === 'down').sort((a,b)=>a.number-b.number);
  renderClueList($('#cluesAcross'), across);
  renderClueList($('#cluesDown'), down);
}

function renderClueList(ul, items) {
  ul.innerHTML = '';
  for (const p of items) {
    const li = document.createElement('li');
    li.dataset.number = p.number;
    li.dataset.dir = p.dir;
    const tag = p.type !== 'text' ? `<span class="media-tag">${p.type === 'audio' ? 'dźwięk' : 'obraz'}</span>` : '';
    li.innerHTML = `<span class="num">${p.number}.</span><span>${escapeHtml(p.clue)} <span class="muted">(${p.length})</span> ${tag}</span>`;
    li.addEventListener('click', () => focusEntry(p));
    ul.appendChild(li);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function setActiveFromCell(r, c) {
  const entries = state.cellMap[`${r},${c}`] || [];
  if (entries.length === 0) return;
  // Prefer keeping current direction if possible.
  let chosen = entries[0];
  if (state.activeEntry) {
    const same = entries.find((e) => e.placement.dir === state.activeEntry.dir);
    if (same) chosen = same;
  }
  state.activeEntry = chosen.placement;
  highlightActive();
}

function toggleDirection(r, c) {
  const entries = state.cellMap[`${r},${c}`] || [];
  if (entries.length < 2) return;
  const other = entries.find((e) => e.placement !== state.activeEntry);
  if (other) { state.activeEntry = other.placement; highlightActive(); }
}

function focusEntry(p) {
  state.activeEntry = p;
  const cellEl = document.querySelector(`.cell[data-r="${p.row}"][data-c="${p.col}"] input`);
  if (cellEl) cellEl.focus();
  highlightActive();
}

function highlightActive() {
  $$('.cell').forEach((el) => el.classList.remove('highlight','focus'));
  $$('.clue-list li').forEach((el) => el.classList.remove('active'));
  const p = state.activeEntry;
  if (!p) { $('#mediaPanel').hidden = true; return; }
  for (let i = 0; i < p.length; i++) {
    const r = p.row + (p.dir === 'down' ? i : 0);
    const c = p.col + (p.dir === 'across' ? i : 0);
    const cell = document.querySelector(`.cell[data-r="${r}"][data-c="${c}"]`);
    if (cell) cell.classList.add('highlight');
  }
  const li = document.querySelector(`.clue-list li[data-number="${p.number}"][data-dir="${p.dir}"]`);
  if (li) li.classList.add('active');

  // Media panel
  const mp = $('#mediaPanel');
  if (p.type === 'image' && p.media) {
    mp.hidden = false;
    mp.innerHTML = `<div class="mp-head">${p.number} ${p.dir === 'across' ? 'poziomo' : 'pionowo'} · materiał wizualny</div>
      <div class="mp-clue">${escapeHtml(p.clue)}</div>
      <img src="${p.media}" alt="materiał do hasła" />`;
  } else if (p.type === 'audio' && p.media) {
    mp.hidden = false;
    mp.innerHTML = `<div class="mp-head">${p.number} ${p.dir === 'across' ? 'poziomo' : 'pionowo'} · ścieżka dźwiękowa</div>
      <div class="mp-clue">${escapeHtml(p.clue)}</div>
      <audio controls src="${p.media}"></audio>`;
  } else {
    mp.hidden = true; mp.innerHTML = '';
  }
}

function onCellInput(e) {
  const inp = e.target;
  // Akceptujemy polskie litery i cyfry, jedna pozycja.
  let v = inp.value.toUpperCase().replace(/[^A-Z0-9ĄĆĘŁŃÓŚŹŻ]/gi, '').toUpperCase();
  inp.value = v.slice(0, 1);
  const r = +inp.dataset.r, c = +inp.dataset.c;
  const key = `${r},${c}`;
  if (inp.value) state.answers[key] = inp.value; else delete state.answers[key];
  saveAnswers(state.date, state.answers);
  if (inp.value) advanceToNextEmpty(r, c, +1);
  // Clear correctness coloring on edit
  inp.parentElement.classList.remove('ok','bad');
}

function onCellKey(e) {
  const inp = e.target;
  const r = +inp.dataset.r, c = +inp.dataset.c;
  const dir = state.activeEntry?.dir || 'across';
  if (e.key === 'Backspace' && !inp.value) {
    e.preventDefault();
    moveCursor(r, c, -1, true);
    return;
  }
  if (e.key === 'ArrowRight') { e.preventDefault(); setDirAndMove(r, c, 'across', +1); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); setDirAndMove(r, c, 'across', -1); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); setDirAndMove(r, c, 'down', +1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); setDirAndMove(r, c, 'down', -1); }
  else if (e.key === ' ' || e.key === 'Tab') {
    e.preventDefault();
    // jump to next entry
    nextEntry(e.shiftKey ? -1 : 1);
  }
}

function setDirAndMove(r, c, dir, delta) {
  // If current active dir doesn't match, switch (without moving) if possible.
  if (state.activeEntry && state.activeEntry.dir !== dir) {
    const entries = state.cellMap[`${r},${c}`] || [];
    const e = entries.find((x) => x.placement.dir === dir);
    if (e) { state.activeEntry = e.placement; highlightActive(); }
  }
  moveCursor(r, c, delta, false, dir);
}

function moveCursor(r, c, delta, eraseOnBack = false, forceDir) {
  const dir = forceDir || state.activeEntry?.dir || 'across';
  let nr = r, nc = c;
  if (dir === 'across') nc += delta; else nr += delta;
  const target = document.querySelector(`.cell[data-r="${nr}"][data-c="${nc}"]:not(.block) input`);
  if (target) target.focus();
  if (eraseOnBack) {
    const cur = document.querySelector(`.cell[data-r="${r}"][data-c="${c}"] input`);
    if (cur) cur.value = '';
    delete state.answers[`${r},${c}`];
    saveAnswers(state.date, state.answers);
  }
}

// Po wpisaniu litery: skacz do następnej PUSTEJ komórki w obrębie aktywnego hasła,
// pomijając pola już wypełnione (np. przez nakładające się słowo).
function advanceToNextEmpty(r, c, delta) {
  const p = state.activeEntry;
  if (!p) { moveCursor(r, c, delta); return; }
  // Pozycja w obrębie hasła.
  let i = p.dir === 'across' ? (c - p.col) : (r - p.row);
  let next = i + delta;
  while (next >= 0 && next < p.length) {
    const nr = p.row + (p.dir === 'down' ? next : 0);
    const nc = p.col + (p.dir === 'across' ? next : 0);
    const input = document.querySelector(`.cell[data-r="${nr}"][data-c="${nc}"] input`);
    if (input && !input.value) { input.focus(); return; }
    next += delta;
  }
  // Brak pustych pól w tym haśle — przesuń o jedno (zachowanie zachowawcze).
  moveCursor(r, c, delta);
}

function nextEntry(delta) {
  const list = state.puzzle.placements;
  if (!state.activeEntry) { focusEntry(list[0]); return; }
  const idx = list.indexOf(state.activeEntry);
  const next = list[(idx + delta + list.length) % list.length];
  focusEntry(next);
}

// ---------- Check ----------
async function checkAnswers() {
  const res = await fetch('/api/check', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date: state.date, answers: state.answers }),
  });
  if (!res.ok) return;
  const data = await res.json();

  for (const [key, info] of Object.entries(data.cells)) {
    const [r, c] = key.split(',');
    const cell = document.querySelector(`.cell[data-r="${r}"][data-c="${c}"]`);
    if (!cell) continue;
    cell.classList.remove('ok','bad');
    cell.classList.add(info.ok ? 'ok' : 'bad');
  }

  const msg = scoreMessage(data.score);
  $('#result').hidden = false;
  $('#result').innerHTML = `
    <div class="score-num">${data.score}<small> / 100</small></div>
    <div>
      <div class="score-msg">${msg}</div>
      <div class="score-stats">${data.correct} z ${data.total} liter · ${data.entries.filter(e=>e.ok).length} z ${data.entries.length} haseł</div>
    </div>`;

  // Save result history
  const prev = JSON.parse(localStorage.getItem(resultKey(state.date)) || 'null');
  if (!prev || data.score > prev.score) {
    localStorage.setItem(resultKey(state.date), JSON.stringify({ score: data.score, correct: data.correct, total: data.total, when: Date.now() }));
  }
}

function scoreMessage(s) {
  if (s === 100) return 'Mistrzostwo. Bez skazy.';
  if (s >= 85)  return 'Znakomicie.';
  if (s >= 60)  return 'Solidna robota.';
  if (s >= 30)  return 'Próbuj dalej — jutro nowa szansa.';
  return 'Każdy zaczyna od pierwszego pióra.';
}

// ---------- Calendar ----------
let calCursor = new Date();
let archiveDates = new Set();

async function openCalendar() {
  try {
    const r = await fetch('/api/archive');
    const data = await r.json();
    archiveDates = new Set(data.dates);
  } catch {}
  calCursor = new Date();
  calCursor.setDate(1);
  $('#calendarModal').hidden = false;
  renderCalendar();
}

function renderCalendar() {
  const y = calCursor.getFullYear(), m = calCursor.getMonth();
  $('#calLabel').textContent = `${PL_MONTHS_TITLE[m]} ${y}`;
  const grid = $('#calGrid'); grid.innerHTML = '';
  const first = new Date(y, m, 1);
  // Monday-first weekday
  let startCol = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  for (let i = 0; i < startCol; i++) {
    const e = document.createElement('div'); e.className = 'cal-day empty'; grid.appendChild(e);
  }
  const today = todayKey();
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const el = document.createElement('div');
    el.className = 'cal-day';
    el.textContent = d;
    if (key > today || key < LAUNCH_KEY) {
      el.classList.add('locked');
    } else {
      el.classList.add('available');
      const result = JSON.parse(localStorage.getItem(resultKey(key)) || 'null');
      if (result) {
        el.classList.add('played');
        const pct = document.createElement('span'); pct.className = 'pct'; pct.textContent = result.score; el.appendChild(pct);
      }
      el.addEventListener('click', () => {
        $('#calendarModal').hidden = true;
        loadPuzzle(key);
      });
    }
    if (key === today) el.classList.add('today');
    grid.appendChild(el);
  }
}

// ---------- Auto-refresh at midnight ----------
function scheduleMidnightReload() {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
  setTimeout(() => { loadPuzzle(todayKey()); scheduleMidnightReload(); }, next - now);
}

// ---------- Wire up ----------
document.addEventListener('DOMContentLoaded', () => {
  loadPuzzle(todayKey());
  scheduleMidnightReload();

  $('#checkBtn').addEventListener('click', checkAnswers);
  $('#resetBtn').addEventListener('click', () => {
    if (!confirm('Wyczyścić wszystkie wpisane litery?')) return;
    state.answers = {}; saveAnswers(state.date, {});
    $$('.cell input').forEach((i) => i.value = '');
    $$('.cell').forEach((c) => c.classList.remove('ok','bad'));
    $('#result').hidden = true;
  });
  $('#openCalendar').addEventListener('click', openCalendar);
  $('#closeCalendar').addEventListener('click', () => $('#calendarModal').hidden = true);
  $('#calendarModal').addEventListener('click', (e) => {
    if (e.target.id === 'calendarModal') $('#calendarModal').hidden = true;
  });
  $('#calPrev').addEventListener('click', () => {
    const launch = new Date(LAUNCH.getFullYear(), LAUNCH.getMonth(), 1);
    const candidate = new Date(calCursor.getFullYear(), calCursor.getMonth() - 1, 1);
    if (candidate < launch) return;
    calCursor = candidate; renderCalendar();
  });
  $('#calNext').addEventListener('click', () => {
    const t = new Date(); t.setDate(1);
    if (calCursor.getFullYear() < t.getFullYear() || (calCursor.getFullYear()===t.getFullYear() && calCursor.getMonth() < t.getMonth())) {
      calCursor.setMonth(calCursor.getMonth() + 1); renderCalendar();
    }
  });
});
