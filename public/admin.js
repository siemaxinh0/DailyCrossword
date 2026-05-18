'use strict';

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

let token = localStorage.getItem('dk:adminToken') || null;
let bank = [];
let pendingMediaUrl = '';

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
}
function showAdmin() {
  show('#loginPanel', false);
  show('#composerPanel', true);
  show('#bankPanel', true);
  loadBank();
}

async function loadBank() {
  const r = await api('/api/admin/clues');
  bank = await r.json();
  renderBank();
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

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
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
});
