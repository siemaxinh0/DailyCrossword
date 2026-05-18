'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { generate } = require('./crossword');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';
const DAILY_COUNT = 8; // how many clues per daily puzzle
const LAUNCH_KEY = '2026-05-18'; // pierwsze wydanie

const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const CLUES_FILE = path.join(DATA_DIR, 'clues.json');
const PUZZLES_FILE = path.join(DATA_DIR, 'puzzles.json');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(CLUES_FILE)) fs.writeFileSync(CLUES_FILE, '[]');
if (!fs.existsSync(PUZZLES_FILE)) fs.writeFileSync(PUZZLES_FILE, '{}');

function readJSON(file) { return JSON.parse(fs.readFileSync(file, 'utf-8')); }
function writeJSON(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }

// --- Deterministic daily selection ---
function todayKey(d = new Date()) {
  // Use local date.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function seededShuffle(arr, seed) {
  const a = arr.slice();
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  // mulberry32
  let s = h || 1;
  const rand = () => {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildPuzzleForDate(dateKey) {
  const clues = readJSON(CLUES_FILE);
  if (clues.length === 0) return null;
  const shuffled = seededShuffle(clues, dateKey);
  // Try to build with progressively fewer clues if generation drops too many.
  let bestPuzzle = null;
  for (let count = Math.min(DAILY_COUNT, shuffled.length); count >= 3; count--) {
    const subset = shuffled.slice(0, count);
    const puzzle = generate(subset);
    if (puzzle.placements.length >= Math.min(count, 4) && puzzle.unplaced.length <= 1) {
      bestPuzzle = puzzle; break;
    }
    if (!bestPuzzle || puzzle.placements.length > bestPuzzle.placements.length) {
      bestPuzzle = puzzle;
    }
  }
  return { date: dateKey, ...bestPuzzle };
}

function getPuzzleForDate(dateKey) {
  const cache = readJSON(PUZZLES_FILE);
  if (cache[dateKey]) return cache[dateKey];
  const puzzle = buildPuzzleForDate(dateKey);
  if (puzzle) {
    cache[dateKey] = puzzle;
    writeJSON(PUZZLES_FILE, cache);
  }
  return puzzle;
}

// Invalidate cached puzzles when clue bank changes so tomorrow rebuilds.
function clearFuturePuzzles() {
  // Keep past puzzles for archive integrity; clear today + future.
  const today = todayKey();
  const cache = readJSON(PUZZLES_FILE);
  for (const k of Object.keys(cache)) {
    if (k >= today) delete cache[k];
  }
  writeJSON(PUZZLES_FILE, cache);
}

// --- Middleware ---
app.use(express.json({ limit: '5mb' }));
app.use('/uploads', express.static(UPLOAD_DIR));
app.use(express.static(path.join(__dirname, 'public')));

function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.token;
  if (token !== ADMIN_PASSWORD) return res.status(401).json({ error: 'unauthorized' });
  next();
}

// --- Multer for file uploads ---
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const id = crypto.randomBytes(8).toString('hex');
      cb(null, `${id}${ext}`);
    },
  }),
  limits: { fileSize: 15 * 1024 * 1024 },
});

// --- Public API ---
app.get('/api/puzzle', (req, res) => {
  const date = req.query.date || todayKey();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'bad date' });
  // No future puzzles and nothing before launch.
  if (date > todayKey()) return res.status(403).json({ error: 'future' });
  if (date < LAUNCH_KEY) return res.status(403).json({ error: 'before launch' });
  const puzzle = getPuzzleForDate(date);
  if (!puzzle) return res.status(404).json({ error: 'no clues yet' });
  // Strip answers from response — send a public version.
  const publicCells = puzzle.cells.map((row) =>
    row.map((cell) => (cell ? { number: cell.number || null } : null))
  );
  const publicPlacements = puzzle.placements.map((p) => ({
    number: p.number,
    dir: p.dir,
    row: p.row,
    col: p.col,
    length: p.length,
    clue: p.clue,
    type: p.type,
    media: p.media,
  }));
  res.json({
    date: puzzle.date,
    size: puzzle.size,
    cells: publicCells,
    placements: publicPlacements,
  });
});

app.post('/api/check', (req, res) => {
  const { date, answers } = req.body || {};
  if (!date || typeof answers !== 'object') return res.status(400).json({ error: 'bad payload' });
  if (date > todayKey()) return res.status(403).json({ error: 'future' });
  const puzzle = getPuzzleForDate(date);
  if (!puzzle) return res.status(404).json({ error: 'no puzzle' });

  // Build expected letters per cell from placements.
  const expected = {}; // key "r,c" -> letter
  for (const p of puzzle.placements) {
    for (let i = 0; i < p.length; i++) {
      const r = p.row + (p.dir === 'down' ? i : 0);
      const c = p.col + (p.dir === 'across' ? i : 0);
      expected[`${r},${c}`] = p.answer[i];
    }
  }

  const cellResults = {};
  let total = 0, correct = 0;
  for (const key of Object.keys(expected)) {
    total++;
    const raw = (answers[key] || '').toString();
    const got = raw
      .toUpperCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Z0-9]/g, '');
    const ok = got === expected[key];
    cellResults[key] = { expected: expected[key], got, ok };
    if (ok) correct++;
  }

  const entryResults = puzzle.placements.map((p) => {
    let entryOk = true;
    for (let i = 0; i < p.length; i++) {
      const r = p.row + (p.dir === 'down' ? i : 0);
      const c = p.col + (p.dir === 'across' ? i : 0);
      if (!cellResults[`${r},${c}`].ok) { entryOk = false; break; }
    }
    return { number: p.number, dir: p.dir, ok: entryOk };
  });

  res.json({
    date,
    total,
    correct,
    score: total ? Math.round((correct / total) * 100) : 0,
    cells: cellResults,
    entries: entryResults,
  });
});

// --- Admin API ---
app.get('/api/admin/clues', requireAdmin, (req, res) => {
  res.json(readJSON(CLUES_FILE));
});

app.post('/api/admin/clues', requireAdmin, (req, res) => {
  const { clue, answer, type, media } = req.body || {};
  if (!clue || !answer) return res.status(400).json({ error: 'clue and answer required' });
  const t = ['text', 'audio', 'image'].includes(type) ? type : 'text';
  const list = readJSON(CLUES_FILE);
  const id = crypto.randomBytes(6).toString('hex');
  list.push({ id, clue: String(clue).trim(), answer: String(answer).trim(), type: t, media: media || null, createdAt: Date.now() });
  writeJSON(CLUES_FILE, list);
  clearFuturePuzzles();
  res.json({ ok: true, id });
});

app.delete('/api/admin/clues/:id', requireAdmin, (req, res) => {
  const list = readJSON(CLUES_FILE);
  const idx = list.findIndex((c) => c.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'not found' });
  const [removed] = list.splice(idx, 1);
  writeJSON(CLUES_FILE, list);
  // remove media file if local upload
  if (removed.media && removed.media.startsWith('/uploads/')) {
    const f = path.join(UPLOAD_DIR, path.basename(removed.media));
    fs.promises.unlink(f).catch(() => {});
  }
  clearFuturePuzzles();
  res.json({ ok: true });
});

app.post('/api/admin/upload', requireAdmin, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no file' });
  res.json({ url: `/uploads/${req.file.filename}` });
});

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {};
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'bad password' });
  res.json({ token: ADMIN_PASSWORD });
});

// Preview generation without saving (for admin dry-run).
app.post('/api/admin/preview', requireAdmin, (req, res) => {
  const { clues } = req.body || {};
  if (!Array.isArray(clues)) return res.status(400).json({ error: 'clues array required' });
  res.json(generate(clues));
});

// Past dates with existing puzzles (for calendar dot indicators).
app.get('/api/archive', (req, res) => {
  const cache = readJSON(PUZZLES_FILE);
  res.json({ dates: Object.keys(cache).sort(), today: todayKey() });
});

app.listen(PORT, () => {
  console.log(`Codzienna Krzyżówka działa na http://localhost:${PORT}`);
  console.log(`Hasło administratora: ${ADMIN_PASSWORD}`);
});
