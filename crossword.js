// Crossword generator: greedy backtracking placement.
// Input: array of clue objects { id, answer, clue, type, media }
// Output: { size, cells: [[{letter,number?}|null]], placements: [{id,row,col,dir,number,answer,clue,type,media}] }

'use strict';

const MAX_SIZE = 21;

function normalize(word) {
  // Strip diacritics for grid letters (but keep originals in clue answer for display logic if needed).
  // Ł/ł nie rozkłada się przez NFD — trzeba je podmienić ręcznie.
  return word
    .toUpperCase()
    .replace(/Ł/g, 'L')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]/g, '');
}

function tryPlace(grid, word, row, col, dir) {
  const dr = dir === 'down' ? 1 : 0;
  const dc = dir === 'across' ? 1 : 0;
  // boundary
  for (let i = 0; i < word.length; i++) {
    const r = row + dr * i;
    const c = col + dc * i;
    if (r < 0 || c < 0 || r >= MAX_SIZE || c >= MAX_SIZE) return null;
    const existing = grid[r][c];
    if (existing && existing !== word[i]) return null;
    if (!existing) {
      // adjacent cells (perpendicular) must be empty to avoid touching parallel words
      if (dir === 'across') {
        if (grid[r - 1] && grid[r - 1][c]) return null;
        if (grid[r + 1] && grid[r + 1][c]) return null;
      } else {
        if (grid[r][c - 1]) return null;
        if (grid[r][c + 1]) return null;
      }
    }
  }
  // ends must not touch another letter inline
  const beforeR = row - dr, beforeC = col - dc;
  const afterR = row + dr * word.length, afterC = col + dc * word.length;
  if (grid[beforeR] && grid[beforeR][beforeC]) return null;
  if (grid[afterR] && grid[afterR][afterC]) return null;

  let intersections = 0;
  for (let i = 0; i < word.length; i++) {
    if (grid[row + dr * i][col + dc * i] === word[i]) intersections++;
  }
  return intersections;
}

function placeWord(grid, word, row, col, dir) {
  const dr = dir === 'down' ? 1 : 0;
  const dc = dir === 'across' ? 1 : 0;
  const written = [];
  for (let i = 0; i < word.length; i++) {
    const r = row + dr * i, c = col + dc * i;
    if (!grid[r][c]) { written.push([r, c]); grid[r][c] = word[i]; }
  }
  return written;
}

function unplace(grid, written) {
  for (const [r, c] of written) grid[r][c] = null;
}

function makeGrid() {
  return Array.from({ length: MAX_SIZE }, () => Array(MAX_SIZE).fill(null));
}

function generate(clues, opts = {}) {
  if (!Array.isArray(clues) || clues.length === 0) {
    return { size: 0, cells: [], placements: [], unplaced: [] };
  }
  // Sort longest first.
  const prepared = clues
    .map((c) => ({ ...c, _norm: normalize(c.answer) }))
    .filter((c) => c._norm.length >= 2)
    .sort((a, b) => b._norm.length - a._norm.length);

  const grid = makeGrid();
  const placements = [];
  const unplaced = [];

  // Place first word horizontally near center.
  const first = prepared[0];
  const startRow = Math.floor(MAX_SIZE / 2);
  const startCol = Math.floor((MAX_SIZE - first._norm.length) / 2);
  placeWord(grid, first._norm, startRow, startCol, 'across');
  placements.push({ ...first, row: startRow, col: startCol, dir: 'across' });

  for (let idx = 1; idx < prepared.length; idx++) {
    const w = prepared[idx];
    const candidates = [];
    for (let i = 0; i < w._norm.length; i++) {
      const ch = w._norm[i];
      for (const p of placements) {
        for (let j = 0; j < p._norm.length; j++) {
          if (p._norm[j] !== ch) continue;
          const pr = p.row + (p.dir === 'down' ? j : 0);
          const pc = p.col + (p.dir === 'across' ? j : 0);
          const dir = p.dir === 'across' ? 'down' : 'across';
          const row = dir === 'down' ? pr - i : pr;
          const col = dir === 'across' ? pc - i : pc;
          const score = tryPlace(grid, w._norm, row, col, dir);
          if (score !== null) candidates.push({ row, col, dir, score });
        }
      }
    }
    if (candidates.length === 0) { unplaced.push(w); continue; }
    candidates.sort((a, b) => b.score - a.score || (a.row + a.col) - (b.row + b.col));
    const best = candidates[0];
    placeWord(grid, w._norm, best.row, best.col, best.dir);
    placements.push({ ...w, row: best.row, col: best.col, dir: best.dir });
  }

  // Compute bounding box and trim.
  let minR = MAX_SIZE, minC = MAX_SIZE, maxR = -1, maxC = -1;
  for (let r = 0; r < MAX_SIZE; r++) {
    for (let c = 0; c < MAX_SIZE; c++) {
      if (grid[r][c]) {
        if (r < minR) minR = r;
        if (c < minC) minC = c;
        if (r > maxR) maxR = r;
        if (c > maxC) maxC = c;
      }
    }
  }
  if (maxR < 0) return { size: 0, cells: [], placements: [], unplaced: prepared };

  const height = maxR - minR + 1;
  const width = maxC - minC + 1;
  const cells = Array.from({ length: height }, (_, r) =>
    Array.from({ length: width }, (_, c) => {
      const ch = grid[minR + r][minC + c];
      return ch ? { letter: ch } : null;
    })
  );

  const adjusted = placements.map((p) => ({
    id: p.id,
    answer: p._norm,
    answerDisplay: p.answer,
    clue: p.clue,
    type: p.type || 'text',
    media: p.media || null,
    row: p.row - minR,
    col: p.col - minC,
    dir: p.dir,
    length: p._norm.length,
  }));

  // Number cells: a cell gets a number if it starts an across or down entry.
  let num = 1;
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      if (!cells[r][c]) continue;
      const startsAcross = (c === 0 || !cells[r][c - 1]) && (c + 1 < width && cells[r][c + 1]);
      const startsDown = (r === 0 || !cells[r - 1][c]) && (r + 1 < height && cells[r + 1][c]);
      if (startsAcross || startsDown) {
        cells[r][c].number = num++;
      }
    }
  }
  // Attach numbers to placements.
  for (const p of adjusted) {
    const cell = cells[p.row][p.col];
    p.number = cell.number;
  }
  adjusted.sort((a, b) => (a.number - b.number) || (a.dir < b.dir ? -1 : 1));

  return {
    size: { rows: height, cols: width },
    cells,
    placements: adjusted,
    unplaced: unplaced.map((u) => ({ id: u.id, answer: u.answer, clue: u.clue })),
  };
}

module.exports = { generate, normalize };
