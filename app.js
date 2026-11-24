/* Start Stop Analyzer v2 — Browser-only Excel parser, Auto-Routing, Apple-style UI & 3-Page A4 Landscape PDF */
'use strict';
(() => {

// ---------------------------------------------------------------- constants
const PALLETIZERS = ['Palletizer 1', 'Palletizer 2'];
const PACKERS = ['Packer 1', 'Packer 2', 'Packer 3', 'Packer 4'];
const MACHINES = [...PACKERS, ...PALLETIZERS]; // P1..P4, Pal1..Pal2 (matches Page 2 & 3 order)
const SHARED = 'All / Shared';
const EQUIP_CHOICES = [...PACKERS, ...PALLETIZERS, SHARED];

// Physical plant line routing: P1, P2, P3 -> Pal 1; P2, P3, P4 -> Pal 2
const LINE_PACKERS = {
  'Palletizer 1': ['Packer 1', 'Packer 2', 'Packer 3'],
  'Palletizer 2': ['Packer 2', 'Packer 3', 'Packer 4'],
};
const DEFAULT_LINE_PACKER = { 'Palletizer 1': 'Packer 3', 'Palletizer 2': 'Packer 4' };

const PLANNED_GROUPS = [
  'Break', 'Housekeeping', 'Shift Changeover', 'Mechanical PM (Greasing)',
  'Planned Maintenance', 'Compliance/Calibration',
];
const UNPLANNED_GROUPS = [
  'Burst/Stuck Bag', 'Mis-shooting Bag', 'Stretch Hood Plastic', 'Flat Film Plastic',
  'Layer Pusher/Conveyor Mech', 'Sensor/Electrical Issue', 'Spout/Cement Filling Issue',
  'Destroyer Belt Issue', 'Auto Placer Issue', 'Packer Bin Issue',
  'Check Weigher Issue', 'Air Hose Leaking (General)', 'Unclassified reasons',
];
const UNCLASSIFIED = 'Unclassified reasons';
const categoryOf = g => PLANNED_GROUPS.includes(g) ? 'Planned' : 'Unplanned';

// Fixed color maps (consistent across Pages 1 & 2, distinct palette on Page 3)
const CAT_COLOR = {
  'Burst/Stuck Bag': '#c93c20',
  'Layer Pusher/Conveyor Mech': '#e07a22',
  'Stretch Hood Plastic': '#e89088',
  'Sensor/Electrical Issue': '#b89b14',
  'Flat Film Plastic': '#4c8c2b',
  'Mis-shooting Bag': '#1e3557',
  'Spout/Cement Filling Issue': '#75489c',
  'Destroyer Belt Issue': '#2c7fb8',
  'Auto Placer Issue': '#2a9d8f',
  'Check Weigher Issue': '#6c757d',
  'Packer Bin Issue': '#5c6bc0',
  'Air Hose Leaking (General)': '#8ab4d8',
  'Unclassified reasons': '#8e99a4',
  'Remaining categories': '#c5ccd4',
};
const MACHINE_COLOR = {
  'Palletizer 2': '#82a3d0',
  'Palletizer 1': '#213a5e',
  'Packer 4': '#236e6c',
  'Packer 3': '#459492',
  'Packer 1': '#9bc9c7',
  'Packer 2': '#dce8e7',
};
const BURST_COLOR = {
  'Diverter belt': '#274363',
  'Guiding plate conveyor': '#3c85c6',
  'Layer pusher': '#e6842a',
  'Turning bar': '#5a9a32',
  'Bag type': '#8752a3',
  'Bag saddle': '#2fa39c',
  'Curve link': '#1ca08c',
  'Gravity roller': '#8e5ea2',
  'Bag destroyer': '#8d5b4c',
  'Under table pallet pac': '#b8292f',
  'Long conveyor': '#64748b',
};
const FALLBACK_BURST_PALETTE = ['#274363', '#e6842a', '#5a9a32', '#3c85c6', '#b8292f', '#1ca08c', '#8e5ea2', '#8d5b4c', '#d97706', '#475569'];

// Classification rules (first match wins, aligned with October PDF report)
const DEFAULT_RULES = [
  ['\\b(break|rehat|lunch|dinner|supper|tea ?break|meal|prayer|solat|makan)\\b', 'Break'],
  ['house ?keeping|\\b5s\\b|clean ?up', 'Housekeeping'],
  ['closing\\s+(for\\s+)?(1st|2nd|3rd|night|day|shift)|shift\\s+closing|end\\s+of\\s+shift|continue\\s+running|shift\\s+change|change\\s*over|hand\\s*over|change\\s+product|test\\s+run|power\\s+switching|(stop|start)\\s+(packer|palleti[sz]er|operation|pcc|tsc|opc)|\\bnot\\s+operat|\\bno\\s+operat', 'Shift Changeover'],
  ['greas|lubric', 'Mechanical PM (Greasing)'],
  ['\\bpm\\b|planned\\s+maint|preventive|scheduled\\s+maint', 'Planned Maintenance'],
  ['calibrat|compliance|audit|weight\\s+verification|lab\\s*sampl|stock\\s*check', 'Compliance/Calibration'],

  ['mis-?\\s*shoot|miss\\s*shoot|misshoot|missshoot', 'Mis-shooting Bag'],
  ['d[ei]stroyer|destroter|bag\\s*cutter', 'Destroyer Belt Issue'],
  ['emergency\\s*(stop|off)|safety\\s*photo|swing\\s*table\\s*sensor|control\\s*voltage|peripheral\\s*error|control\\s*cabinet|a02-|d035|d600|d601|d700|thermistor|proximity|scanner|auxiliary\\s*drive|converter', 'Sensor/Electrical Issue'],
  ['stretch\\s*hood|stretchood|s\\/hood|sealing\\s*bar|clamping|scientex|tg\\s*plastic|hood\\s*(film|plastic)|film\\s*retriev', 'Stretch Hood Plastic'],
  ['flat\\s*film|f\\/film|flap\\s*film', 'Flat Film Plastic'],
  ['check\\s*weigh', 'Check Weigher Issue'],
  ['burst|stuck\\s+bag|bag\\s+stuck|bag\\s+jam|jammed\\s+bag|bag\\s+koyak|bag\\s+pecah|remove\\s+empty\\s+bag|empty\\s+pallet\\s+stuck|pallet\\s+stuck', 'Burst/Stuck Bag'],
  ['auto\\s*placer|autoplacer|bag\\s*placer|sucker\\s*arm|shooting\\s*belt|suction\\s*cup|manual\\s*placing', 'Auto Placer Issue'],
  ['layer\\s*pusher|press\\s*element|guiding\\s*plate|diverter|discharge\\s*belt|turning\\s*(bar|device)|long\\s*belt|roller\\s*transport|transport\\s*roller|hoist\\s*roller|table\\s*belting|vibrator\\s*screen|scrup?per|belt\\s*drift|bucket\\s*elevator|conveyor|roller|chain', 'Layer Pusher/Conveyor Mech'],
  ['packer\\s*bin|bin\\s*packer|bin\\s*manual\\s*gate|bin\\s*level|empty\\s+out\\s+packer\\s+bin', 'Packer Bin Issue'],
  ['spout|spoit|filling|nozzle|air\\s*slide|a\\/slide|cement\\s*flow|no\\s*cement|silo\\s*\\d|control\\s*bin\\s*screen|flow\\s*control\\s*gate|aeration\\s*pipe|rotary\\s*lock|resistance\\s*valve', 'Spout/Cement Filling Issue'],
  ['air\\s*hose|hose\\s*leak|air\\s*leak|s\\/valve\\s*air', 'Air Hose Leaking (General)'],
  ['sensor|electric|photo\\s*(cell|eye)|\\bplc\\b|motor|inverter|\\bvsd\\b|fuse|\\btrip|alarm|power\\s*supply|download\\s*software|flow\\s*gate|compressor', 'Sensor/Electrical Issue'],
].map(([pattern, group]) => ({ pattern, group }));

const PALLETIZER_ONLY_CAUSES = new Set([
  'Turning bar', 'Layer pusher', 'Under table pallet pac', 'Gravity roller', 'Guiding plate conveyor',
]);

const CAUSE_CANONICAL = {
  'diverter belt': 'Diverter belt',
  'long conveyor': 'Long conveyor',
  'guiding plate belt conveyor': 'Guiding plate conveyor',
  'guiding plate conveyor': 'Guiding plate conveyor',
  'layer pusher': 'Layer pusher',
  'turning bar': 'Turning bar',
  'bag type': 'Bag type',
  'bag saddle': 'Bag saddle',
  'curve link': 'Curve link',
  'gravity roller': 'Gravity roller',
  'bag destroyer': 'Bag destroyer',
  'under table pallet pac': 'Under table pallet pac',
};

const DEFAULT_ROUTING = {
  enabled: true,
  diverterToPacker: true,
  mergeLongConveyor: true,
  turningBarToPalletizer: true,
  mode: 'active', // 'active' | 'equal'
};

const LS = {
  routing: 'ssa.routing.v2',
  overrides: 'ssa.reasonMap.v2',
  rowFixes: 'ssa.rowFixes.v2',
  theme: 'ssa.theme.v2',
};
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September',
  'October', 'November', 'December'];

// ---------------------------------------------------------------- helpers
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => Math.round(n).toLocaleString('en-US');
const fmtH = (n, d = 1) => (n / 60).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (a, b) => (b > 0 ? (a / b) * 100 : 0);
const fmtPct = p => p.toFixed(1) + '%';
const cellText = v => (v == null ? '' : String(v).replace(/\u00a0/g, ' ').trim());
const normKey = s => cellText(s).toLowerCase().replace(/\s+/g, ' ');
const sentenceCase = s => { s = cellText(s).replace(/\s+/g, ' '); return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : ''; };
const clock = min => {
  if (min == null) return '';
  const m = ((Math.round(min) % 1440) + 1440) % 1440, h = Math.floor(m / 60);
  return String(h).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
};
const sum = (arr, f = x => x) => arr.reduce((a, x) => a + f(x), 0);
const fixKey = (fileName, sheet, row) => `${fileName}||${sheet}||${row}`;

function loadLS(key, def) {
  try { const v = localStorage.getItem(key); if (v) return { ...def, ...JSON.parse(v) }; } catch (e) { /* ignore */ }
  return JSON.parse(JSON.stringify(def));
}
function loadRawLS(key, def) {
  try { const v = localStorage.getItem(key); if (v) return JSON.parse(v); } catch (e) { /* ignore */ }
  return JSON.parse(JSON.stringify(def));
}
function saveLS(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* ignore */ }
}

let toastTimer;
function toast(msg, opts = {}) {
  const t = $('#toast');
  if (!t) return;
  t.innerHTML = '';
  const span = document.createElement('span');
  span.textContent = msg;
  t.appendChild(span);
  if (opts.undo) {
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'toast-undo'; btn.textContent = 'Undo';
    btn.onclick = () => { t.hidden = true; clearTimeout(toastTimer); opts.undo(); };
    t.appendChild(btn);
  }
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), opts.undo ? 6000 : 3600);
}

// ---------------------------------------------------------------- state
const COMPILED_RULES = DEFAULT_RULES.map(r => ({ re: new RegExp(r.pattern, 'i'), group: r.group }));

const state = {
  months: new Map(),
  current: null,
  tab: 'overview',
  pdfPage: 1,
  routing: loadLS(LS.routing, DEFAULT_ROUTING),
  overrides: loadRawLS(LS.overrides, {}),
  rowFixes: loadRawLS(LS.rowFixes, {}),
  analysis: null,
  recFilter: '',
};

function classify(reason) {
  const key = normKey(reason);
  if (!key) return { group: UNCLASSIFIED, category: 'Unplanned', via: 'none' };
  if (state.overrides[key]) {
    const g = state.overrides[key];
    return { group: g, category: categoryOf(g), via: 'mapping' };
  }
  for (const r of COMPILED_RULES) {
    if (r.re.test(reason)) return { group: r.group, category: categoryOf(r.group), via: 'rule' };
  }
  return { group: UNCLASSIFIED, category: 'Unplanned', via: 'none' };
}

function normCause(raw, mergeLong = false) {
  const key = normKey(raw);
  if (!key) return '';
  let name = CAUSE_CANONICAL[key] || sentenceCase(raw);
  if (mergeLong && name === 'Long conveyor') name = 'Diverter belt';
  return name;
}

function burstColorOf(cause, idx = 0) {
  return BURST_COLOR[cause] || FALLBACK_BURST_PALETTE[idx % FALLBACK_BURST_PALETTE.length];
}

// ---------------------------------------------------------------- parsing
function parseTime(v) {
  if (v == null || v === '') return { empty: true };
  if (typeof v === 'number') {
    if (!isFinite(v) || v < 0) return { error: true, raw: String(v) };
    return { min: (Math.round((v % 1) * 1440 * 60) / 60) % 1440 };
  }
  if (v instanceof Date) return { min: v.getHours() * 60 + v.getMinutes() };
  const orig = cellText(v);
  if (!orig || /^[-–—]+$/.test(orig)) return { empty: true };
  let s = orig.toUpperCase().replace(/\s+/g, ' ');
  const fixes = [];
  if (s.includes(';')) { s = s.replace(/;/g, ':'); fixes.push('";" → ":"'); }
  if (s.includes('"')) { s = s.replace(/"/g, ':'); fixes.push('"\"" → ":"'); }
  if (/\d\.\d/.test(s)) { s = s.replace(/(\d)\.(?=\d)/g, '$1:'); fixes.push('"." → ":"'); }
  if (/\d,\d/.test(s)) { s = s.replace(/(\d),(?=\d)/g, '$1:'); fixes.push('"," → ":"'); }
  if (/::/.test(s)) { s = s.replace(/:+/g, ':'); fixes.push('double ":"'); }
  s = s.replace(/\bA\.?N\.?$/, 'AM').replace(/\bA\.?M\.?$/, 'AM').replace(/\bP\.?M\.?$/, 'PM');
  if (/:M$/.test(s)) { s = s.replace(/:M$/, 'PM'); fixes.push('":M" → "PM"'); }
  if (/:(AM|PM)$/.test(s)) { s = s.replace(/:(AM|PM)$/, '$1'); fixes.push('extra ":"'); }
  // 3-4 digit compact time like "835PM"
  const compact = s.match(/^(\d{1,2})(\d{2})\s*(AM|PM)$/);
  if (compact) { s = `${compact[1]}:${compact[2]} ${compact[3]}`; fixes.push('added ":"'); }
  const m = s.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?\s*(AM|PM)?$/);
  if (!m) {
    if (/^0?\.\d+$/.test(orig)) return parseTime(parseFloat(orig));
    return { error: true, raw: orig };
  }
  let h = +m[1]; const mi = +m[2], sec = +(m[3] || 0), ap = m[4];
  if (mi > 59 || sec > 59) return { error: true, raw: orig };
  if (ap) { if (h < 1 || h > 12) return { error: true, raw: orig }; h = (h % 12) + (ap === 'PM' ? 12 : 0); }
  else if (h > 24) return { error: true, raw: orig };
  return { min: (h * 60 + mi + sec / 60) % 1440, fixes, raw: orig };
}

function parseDT(v) {
  if (v == null || v === '') return { empty: true };
  if (typeof v === 'number') {
    if (!isFinite(v)) return { error: true, raw: String(v) };
    if (v < 0 && v > -1) return { min: Math.round((v + 1) * 1440 * 60) / 60, fixes: ['midnight wrap'] };
    if (v < 0) return { error: true, raw: String(v) };
    if (v === 0) return { min: 0, zero: true };
    if (v < 1) return { min: Math.round(v * 1440 * 60) / 60 };
    return { min: v };
  }
  if (v instanceof Date) return { min: v.getHours() * 60 + v.getMinutes() };
  const orig = cellText(v);
  if (!orig || /^[-–—]+$/.test(orig) || /^#/.test(orig)) return { empty: true };
  let s = orig.toUpperCase().trim(), fixes = [];
  if (s.includes(';')) { s = s.replace(/;/g, ':'); fixes.push('";" → ":"'); }
  if (/^0?\.\:/.test(s)) { s = s.replace(/^0?\.\:/, '0:'); fixes.push('".:" → ":"'); }
  const leadColon = s.match(/^:0?(\d{1,2})$/);
  if (leadColon) { s = '0:' + leadColon[1]; fixes.push('leading ":"'); }
  const ampm = s.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?\s*(AM|PM)$/);
  if (ampm) {
    const h = +ampm[1] === 12 ? 0 : +ampm[1];
    return { min: h * 60 + +ampm[2] + (+(ampm[3] || 0)) / 60, fixes: [...fixes, 'stripped AM/PM'] };
  }
  let m = s.match(/^(\d{1,3}):(\d{1,2})(?::(\d{1,2}))?$/);
  if (m) return { min: +m[1] * 60 + +m[2] + (+(m[3] || 0)) / 60, fixes };
  m = s.match(/^(\d+(?:\.\d+)?)\s*(min|mins|minutes|m)?$/i);
  if (m) return { min: +m[1] };
  return { error: true, raw: orig };
}

function parseDateCell(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') {
    const d = XLSX.SSF.parse_date_code(v);
    return d && d.y > 1900 ? { y: d.y, m: d.m, d: d.d } : null;
  }
  if (v instanceof Date) return { y: v.getFullYear(), m: v.getMonth() + 1, d: v.getDate() };
  const s = cellText(v);
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return { y: +m[1], m: +m[2], d: +m[3] };
  m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (m) { let y = +m[3]; if (y < 100) y += 2000; return { y, m: +m[2], d: +m[1] }; }
  const t = Date.parse(s);
  if (!isNaN(t)) { const d = new Date(t); return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() }; }
  return null;
}

function normEquipment(raw) {
  const s = cellText(raw).toLowerCase().replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  const m = s.match(/^(pac?ker|pkr|palleti[sz]er|pal)\s*-?\s*(?:no\.?\s*)?(\d)$/);
  if (m) {
    const isPacker = m[1].startsWith('p') && !m[1].startsWith('pal');
    const name = (isPacker ? 'Packer ' : 'Palletizer ') + m[2];
    if (MACHINES.includes(name)) return { name, type: isPacker ? 'Packer' : 'Palletizer' };
  }
  if (/all\s*equip|^all$|packer\s*(and|&|\/)\s*palleti[sz]er|palleti[sz]er\s*(and|&|\/)\s*packer/.test(s)) {
    return { name: SHARED, type: 'Shared' };
  }
  return { name: sentenceCase(s), type: 'Unknown' };
}

const TITLE_RE = /DAILY\s+START\s+STOP\s+PACKER\s*\/\s*PALLETI[SZ]ER\s+RECORD/i;
const HEADER_MATCH = {
  stop: /^stop\s*time/i,
  start: /^start\s*time/i,
  dt: /^d\.?\s*t\b|^downtime/i,
  equipment: /^equi?p?m?e?n?t/i,
  reason: /^reason/i,
  cause: /burst/i,
  remarks: /^remark/i,
};

function findColumns(row) {
  const col = { stop: null, start: null, dt: null, equipment: null, reason: null, cause: null, remarks: null };
  for (const k of Object.keys(HEADER_MATCH)) {
    const i = row.findIndex(c => HEADER_MATCH[k].test(cellText(c)));
    if (i >= 0) col[k] = i;
  }
  const base = col.stop != null ? Math.min(col.stop, col.start ?? col.stop) : 0;
  if (col.stop == null) col.stop = base;
  if (col.start == null) col.start = base + 1;
  if (col.dt == null) col.dt = base + 2;
  if (col.equipment == null) col.equipment = base + 3;
  if (col.reason == null) col.reason = base + 4;
  if (col.remarks == null) col.remarks = col.cause != null ? col.cause + 1 : base + 5;
  return { col, hasCauseCol: col.cause != null, reversedTimes: col.start < col.stop };
}

function monthFromFileName(name) {
  const up = name.toUpperCase();
  const idx = MONTHS.findIndex(m => up.includes(m.toUpperCase()));
  if (idx >= 0) return idx + 1;
  const i3 = MONTHS.findIndex(m => new RegExp('(^|[^A-Z])' + m.slice(0, 3).toUpperCase() + '([^A-Z]|$)').test(up));
  return i3 >= 0 ? i3 + 1 : null;
}

function parseWorkbook(wb, fileName) {
  const records = [], sheetsRead = [], blocksFound = [];
  const daySheets = wb.SheetNames.filter(n => /^\s*\d{1,2}\s*$/.test(n) && +n >= 1 && +n <= 31);
  const dateVotes = new Map();
  let hasCauseCol = false;
  let autoFixedCount = 0;

  for (const sn of daySheets) {
    const day = +sn.trim();
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, defval: null, blankrows: true });
    const headers = [];
    rows.forEach((r, i) => { if (r && r.some(c => /^stop\s*time$/i.test(cellText(c)))) headers.push(i); });
    if (!headers.length) continue;
    sheetsRead.push(sn);

    headers.forEach((h, bi) => {
      const { col, hasCauseCol: hc, reversedTimes } = findColumns(rows[h]);
      if (hc) hasCauseCol = true;
      const floor = bi > 0 ? headers[bi - 1] + 1 : 0;
      let block = '', dateCell = null, dateFound = false;
      for (let i = h - 1; i >= Math.max(floor, h - 8); i--) {
        const r = rows[i] || [];
        if (!dateFound) {
          const di = r.findIndex(c => /^date\s*:?$/i.test(cellText(c)));
          if (di >= 0) {
            dateFound = true;
            dateCell = r[5] != null && di < 5 ? r[5] : r.slice(di + 1).find(c => cellText(c) !== '');
          }
        }
        if (!block && r.some(c => TITLE_RE.test(cellText(c)))) {
          block = cellText(r[5]) && !TITLE_RE.test(cellText(r[5])) ? cellText(r[5])
            : (r.map(cellText).find(t => t && !TITLE_RE.test(t) && /packer|palleti/i.test(t)) || '');
        }
      }
      if (!block) block = bi === 0 ? 'PALLETIZER 1' : 'PALLETIZER 2';
      const blockMachine = normEquipment(block);
      const date = parseDateCell(dateCell);
      if (date) { const k = `${date.y}-${date.m}`; dateVotes.set(k, (dateVotes.get(k) || 0) + 1); }

      const end = bi + 1 < headers.length ? headers[bi + 1] : rows.length;
      let blockRecs = 0;
      for (let i = h + 1; i < end; i++) {
        const r = rows[i] || [];
        if (r.some(c => TITLE_RE.test(cellText(c)))) break;
        const get = k => (col[k] != null ? r[col[k]] : null);
        const stopRaw = cellText(get('stop')), startRaw = cellText(get('start')), dtRaw = cellText(get('dt'));
        const equipmentRaw = cellText(get('equipment')), reason = cellText(get('reason')).replace(/\s+/g, ' ');
        const causeRaw = cellText(get('cause')), remarks = cellText(get('remarks'));

        if (!stopRaw && !startRaw && !dtRaw && !equipmentRaw && !reason && !causeRaw && !remarks) continue;
        if (/^(total|jumlah|prepared|checked|verified)/i.test(stopRaw) || /^(total|jumlah)/i.test(equipmentRaw)) continue;
        if (/^date\s*:?$/i.test(equipmentRaw)) continue;
        // Skip template ghost rows (e.g. formula 0 in DT with empty stop/start/equipment/reason)
        if (!stopRaw && !startRaw && !equipmentRaw && !reason && (!dtRaw || dtRaw === '0' || dtRaw === '00:00:00')) continue;

        const stopParsed = parseTime(get('stop'));
        const startParsed = parseTime(get('start'));
        const dtParsed = parseDT(get('dt'));
        if (stopParsed.fixes?.length) autoFixedCount++;
        if (startParsed.fixes?.length) autoFixedCount++;
        if (dtParsed.fixes?.length) autoFixedCount++;

        blockRecs++;
        records.push({
          id: records.length, day, sheet: sn, row: i + 1, block,
          blockMachine, reversedTimes,
          date: date ? `${String(date.d).padStart(2, '0')}/${String(date.m).padStart(2, '0')}/${date.y}` : '',
          stopRaw, startRaw, dtRaw, equipmentRaw, reason, causeRaw, remarks,
          stopParsed, startParsed, dtParsed,
        });
      }
      if (blockRecs > 0) blocksFound.push({ sheet: sn, block });
    });
  }

  let y = null, m = null, best = 0;
  for (const [k, n] of dateVotes) if (n > best) { best = n; [y, m] = k.split('-').map(Number); }
  if (!m) m = monthFromFileName(fileName);
  const label = m ? `${MONTHS[m - 1]}${y ? ' ' + y : ''}` : fileName.replace(/\.[^.]+$/, '');
  const activeDays = [...new Set(records.map(r => r.day))].sort((a, b) => a - b);
  const pad2 = n => String(n).padStart(2, '0');
  const dateRange = activeDays.length
    ? `${pad2(activeDays[0])}-${pad2(activeDays[activeDays.length - 1])} ${label}`
    : label;

  return {
    key: label, label, monthName: m ? MONTHS[m - 1] : label, year: y, month: m, dateRange,
    hasCauseCol, autoFixedCount, fileName, daySheets, sheetsRead, blocksFound, records,
  };
}

// ---------------------------------------------------------------- Auto-Routing & Analysis
function detectStartedPacker(reason, allowedPackers) {
  const m = reason.match(/start\s+packer\s*-?\s*(\d)/i);
  if (m) {
    const p = 'Packer ' + m[1];
    if (allowedPackers.includes(p)) return p;
  }
  return null;
}

function analyze(month) {
  if (!month) return null;
  const rt = state.routing;
  const mergeLong = rt.enabled && rt.mergeLongConveyor;

  // Step 1: resolve base fields + in-app fixes
  const recs = month.records.map(raw => {
    const fk = fixKey(month.fileName, raw.sheet, raw.row);
    const fix = state.rowFixes[fk] || null;
    const excluded = Boolean(fix && fix.excluded);

    const stop = fix && fix.stop != null ? fix.stop : (raw.stopParsed.min ?? null);
    const start = fix && fix.start != null ? fix.start : (raw.startParsed.min ?? null);
    const hasInterval = (stop != null && start != null) || Boolean(fix && fix.dt != null);
    const calc = (stop != null && start != null)
      ? (raw.reversedTimes ? ((stop - start + 1440) % 1440) : ((start - stop + 1440) % 1440))
      : null;

    let dt = null;
    if (fix && fix.dt != null) dt = fix.dt;
    else if (raw.dtParsed.min != null && !raw.dtParsed.zero) dt = raw.dtParsed.min;
    else if (calc != null && calc > 0) dt = calc;
    else if (raw.dtParsed.zero && calc != null && calc > 0) dt = calc;

    let eq = fix && fix.equipment ? normEquipment(fix.equipment) : normEquipment(raw.equipmentRaw);
    if (!eq) eq = { name: '(Missing)', type: 'Unknown' };

    const reason = fix && fix.reason != null ? fix.reason : raw.reason;
    const c = fix && fix.group
      ? { group: fix.group, category: categoryOf(fix.group), via: 'fix' }
      : classify(reason);
    const causeOrig = normCause(fix && fix.cause != null ? fix.cause : raw.causeRaw, false);
    const cause = normCause(fix && fix.cause != null ? fix.cause : raw.causeRaw, mergeLong);

    return {
      ...raw, fk, fix, excluded, stop, start, calc, hasInterval, dt,
      equipmentOrig: eq.name, typeOrig: eq.type,
      equipment: eq.name, type: eq.type,
      reason, group: c.group, category: c.category, via: c.via,
      causeOrig, cause,
      routed: false, routedReason: '',
    };
  });

  // Step 2: Auto-Routing (Packer 1-3 -> Pal 1; Packer 2-4 -> Pal 2)
  const transfers = [];
  if (rt.enabled) {
    // Group records by (day, block) to track active packer per line chronologically
    const blocks = new Map();
    for (const r of recs) {
      const bk = `${r.day}||${r.block}`;
      if (!blocks.has(bk)) blocks.set(bk, []);
      blocks.get(bk).push(r);
    }

    // For equal-split mode, track round-robin index per line
    const equalIdx = { 'Palletizer 1': 0, 'Palletizer 2': 0 };
    const activePackersInMonth = PACKERS.filter(p => recs.some(r => !r.excluded && r.hasInterval && r.dt > 0 && r.equipment === p));

    for (const [, list] of blocks) {
      const blockPal = list[0]?.blockMachine?.type === 'Palletizer' ? list[0].blockMachine.name : null;
      const allowed = blockPal ? LINE_PACKERS[blockPal] : PACKERS;

      // Pre-scan first valid packer in this block as initial active packer
      let activePacker = null;
      for (const r of list) {
        if (r.type === 'Packer' && allowed.includes(r.equipment)) { activePacker = r.equipment; break; }
        const st = detectStartedPacker(r.reason, allowed);
        if (st) { activePacker = st; break; }
      }
      if (!activePacker) activePacker = blockPal ? DEFAULT_LINE_PACKER[blockPal] : 'Packer 3';

      for (const r of list) {
        if (r.excluded) continue;
        // Update active packer tracker
        const started = detectStartedPacker(r.reason, allowed);
        if (started) activePacker = started;
        else if (r.type === 'Packer' && allowed.includes(r.equipment)) activePacker = r.equipment;

        if (!r.hasInterval || !(r.dt > 0) || r.category === 'Planned') continue;

        // Rule A: Diverter Belt / Long Conveyor logged under Palletizer -> move to Packer
        const isDiverter = r.causeOrig === 'Diverter belt' || (rt.mergeLongConveyor && r.causeOrig === 'Long conveyor');
        if (rt.diverterToPacker && r.type === 'Palletizer' && isDiverter) {
          let targetPacker = activePacker;
          let why = `Active packer on ${r.equipment} line`;
          if (rt.mode === 'equal') {
            const pool = activePackersInMonth.length ? activePackersInMonth : allowed;
            const key = blockPal || 'Palletizer 1';
            targetPacker = pool[equalIdx[key] % pool.length];
            equalIdx[key]++;
            why = `Split equally across active packers (${pool.join(', ')})`;
          }
          r.equipment = targetPacker;
          r.type = 'Packer';
          r.routed = true;
          r.routedReason = why;
          transfers.push({ rec: r, from: r.equipmentOrig, to: targetPacker, cause: r.causeOrig, causeAfter: r.cause, dt: r.dt, why });
          continue;
        }

        // Rule B: Palletizer-only cause (Turning bar, Layer pusher, etc.) logged under Packer -> move to Palletizer
        if (rt.turningBarToPalletizer && r.type === 'Packer' && PALLETIZER_ONLY_CAUSES.has(r.cause) && blockPal) {
          r.equipment = blockPal;
          r.type = 'Palletizer';
          r.routed = true;
          r.routedReason = `${r.cause} belongs to ${blockPal}`;
          transfers.push({ rec: r, from: r.equipmentOrig, to: blockPal, cause: r.causeOrig, causeAfter: r.cause, dt: r.dt, why: r.routedReason });
        }
      }
    }
  }

  // Step 3: Filter to valid recorded unplanned machine records (matching October PDF scope)
  const validMachine = recs.filter(r => !r.excluded && r.hasInterval && r.dt > 0 && r.category === 'Unplanned' && (r.type === 'Palletizer' || r.type === 'Packer'));
  const sharedUnplanned = recs.filter(r => !r.excluded && r.hasInterval && r.dt > 0 && r.category === 'Unplanned' && r.type === 'Shared');
  const unclassifiedRecs = validMachine.filter(r => r.group === UNCLASSIFIED);

  const byMachine = {};
  for (const name of MACHINES) {
    const list = validMachine.filter(r => r.equipment === name);
    const byCat = new Map();
    for (const r of list) {
      const o = byCat.get(r.group) || { group: r.group, min: 0, count: 0 };
      o.min += r.dt; o.count++;
      byCat.set(r.group, o);
    }
    const cats = [...byCat.values()].sort((a, b) => b.min - a.min);
    byMachine[name] = { name, min: sum(list, r => r.dt), count: list.length, cats, recs: list };
  }

  const palTotal = sum(PALLETIZERS, n => byMachine[n].min);
  const pakTotal = sum(PACKERS, n => byMachine[n].min);
  const total = palTotal + pakTotal;
  const activeMachineCount = MACHINES.filter(n => byMachine[n].min > 0).length;

  const groupReasons = type => {
    const list = validMachine.filter(r => r.type === type);
    const tot = sum(list, r => r.dt);
    const by = new Map();
    for (const r of list) {
      const o = by.get(r.group) || { name: r.group, min: 0, count: 0 };
      o.min += r.dt; o.count++;
      by.set(r.group, o);
    }
    const sorted = [...by.values()].sort((a, b) => b.min - a.min);
    return { total: tot, rows: sorted, all: sorted };
  };

  // Burst Bag (Page 3): all valid machine rows with a non-empty Burst Bag Cause
  const burstRecs = validMachine.filter(r => Boolean(r.cause));
  const burstTotal = sum(burstRecs, r => r.dt);
  const burstByMachine = {};
  for (const name of MACHINES) {
    const list = burstRecs.filter(r => r.equipment === name);
    const by = new Map();
    for (const r of list) by.set(r.cause, (by.get(r.cause) || 0) + r.dt);
    const items = [...by.entries()].map(([cause, min]) => ({ cause, min })).sort((a, b) => b.min - a.min);
    burstByMachine[name] = { name, min: sum(list, r => r.dt), items };
  }
  const causeOrder = [...new Set(burstRecs.map(r => r.cause))].sort((a, b) => {
    const sa = sum(burstRecs.filter(r => r.cause === a), r => r.dt);
    const sb = sum(burstRecs.filter(r => r.cause === b), r => r.dt);
    return sb - sa;
  });
  const burstTable = causeOrder.map(cause => {
    const cells = MACHINES.map(m => sum(burstRecs.filter(r => r.cause === cause && r.equipment === m), r => r.dt));
    const tot = sum(cells);
    return { cause, cells, total: tot, share: pct(tot, burstTotal) };
  });

  // Actionable issues (clean, high-signal only)
  const missingDataMachines = MACHINES.filter(n => byMachine[n].min === 0);
  const issuesCount = sharedUnplanned.length + unclassifiedRecs.length + missingDataMachines.length;

  const palRanked = PALLETIZERS.map(n => byMachine[n]).sort((a, b) => b.min - a.min);
  const pakRanked = PACKERS.map(n => byMachine[n]).sort((a, b) => b.min - a.min);

  const headline = (palRanked[0]?.min > 0 && pakRanked[0]?.min > 0)
    ? `${palRanked[0].name} leads the palletizers (${fmtPct(pct(palRanked[0].min, palTotal))}); ${pakRanked[0].name} leads the packers (${fmtPct(pct(pakRanked[0].min, pakTotal))}).`
    : `Monthly downtime summary for ${month.label}.`;

  return {
    month, recs, validMachine, sharedUnplanned, unclassifiedRecs, missingDataMachines,
    byMachine, palTotal, pakTotal, total, activeMachineCount,
    palRanked, pakRanked, headline,
    topPal: groupReasons('Palletizer'), topPak: groupReasons('Packer'),
    burstRecs, burstTotal, burstByMachine, burstTable,
    transfers, issuesCount,
  };
}

// ---------------------------------------------------------------- SVG Pie / Donut
function pieSVG(slices, size = 104, opts = {}) {
  const { donut = false, labels = !donut } = opts;
  const positive = slices.filter(s => s.value > 0);
  const total = sum(positive, s => s.value);
  if (!total) {
    return `<svg width="${size}" height="${size}" viewBox="0 0 100 100" style="flex-shrink:0">
      <circle cx="50" cy="50" r="45" fill="#edf1f5" stroke="#d5dde6" stroke-width="1"/>
      <text x="50" y="53" text-anchor="middle" font-size="11" fill="#7c8b99">No data</text>
    </svg>`;
  }
  if (positive.length === 1) {
    const s = positive[0];
    return `<svg width="${size}" height="${size}" viewBox="0 0 100 100" style="flex-shrink:0">
      <circle cx="50" cy="50" r="45" fill="${s.color}"/>
      ${donut ? `<circle cx="50" cy="50" r="24" fill="var(--surface)"/>` : `<text x="50" y="53" text-anchor="middle" font-size="10" font-weight="700" fill="#fff">100.0%</text>`}
    </svg>`;
  }
  let ang = -Math.PI / 2, paths = '';
  for (const s of positive) {
    const frac = s.value / total, sweep = frac * Math.PI * 2;
    const x1 = 50 + 45 * Math.cos(ang), y1 = 50 + 45 * Math.sin(ang);
    const x2 = 50 + 45 * Math.cos(ang + sweep), y2 = 50 + 45 * Math.sin(ang + sweep);
    paths += `<path d="M50,50 L${x1.toFixed(2)},${y1.toFixed(2)} A45,45 0 ${sweep > Math.PI ? 1 : 0},1 ${x2.toFixed(2)},${y2.toFixed(2)} Z" fill="${s.color}" stroke="#fff" stroke-width="0.9"/>`;
    if (labels && frac >= 0.08) {
      const mid = ang + sweep / 2;
      paths += `<text x="${(50 + 28 * Math.cos(mid)).toFixed(1)}" y="${(53 + 28 * Math.sin(mid)).toFixed(1)}" text-anchor="middle" font-size="8.5" font-weight="700" fill="#fff">${(frac * 100).toFixed(1)}%</text>`;
    }
    ang += sweep;
  }
  if (donut) paths += `<circle cx="50" cy="50" r="24" fill="var(--surface)"/>`;
  return `<svg width="${size}" height="${size}" viewBox="0 0 100 100" style="flex-shrink:0">${paths}</svg>`;
}

// ---------------------------------------------------------------- Render: Overview
function renderOverview(a) {
  const el = $('#tab-overview');
  if (!a) { el.innerHTML = ''; return; }
  const rt = state.routing;

  const legend = (items, total, colorFn, drillAttr) => items.map(x => {
    const col = x.color || colorFn(x.name);
    const attr = drillAttr && x.min > 0 ? ` ${drillAttr}="${esc(x.name)}"` : '';
    return `<div class="legend-item${attr ? ' clickable' : ''}"${attr}>
      <span class="legend-left"><span class="dot" style="background:${col}"></span><span>${esc(x.name)}</span></span>
      <span class="legend-val"><strong>${fmt(x.min)}</strong> · ${fmtPct(pct(x.min, total))}</span>
    </div>`;
  }).join('');

  const palItems = a.palRanked.map(x => ({ name: x.name, min: x.min, color: MACHINE_COLOR[x.name] }));
  const pakItems = a.pakRanked.map(x => ({ name: x.name, min: x.min, color: MACHINE_COLOR[x.name] }));

  el.innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">${esc(a.month.dateRange)} · Offline</div>
        <h1>${esc(a.month.monthName)} Summary</h1>
      </div>
      <div class="card switch-card">
        <div class="switch-meta">
          <div class="t">Auto-Routing</div>
          <div class="s">${rt.enabled ? `${a.transfers.length} rows moved` : 'Raw Excel'}</div>
        </div>
        <label class="ios-switch">
          <input type="checkbox" id="ovRoutingToggle" ${rt.enabled ? 'checked' : ''}>
          <span class="ios-slider"></span>
        </label>
      </div>
    </div>

    <div class="grid-3">
      <div class="card">
        <div class="kpi-top"><span>Total Downtime</span></div>
        <div class="kpi-val">${fmt(a.total)}<small>min</small></div>
        <div class="kpi-sub">${fmtH(a.total)} hrs · ${a.activeMachineCount} active machines</div>
      </div>
      <div class="card">
        <div class="kpi-top"><span>Palletizers</span><span class="kpi-dot" style="background:var(--pal)"></span></div>
        <div class="kpi-val">${fmt(a.palTotal)}<small>min</small></div>
        <div class="kpi-sub">${fmtH(a.palTotal)} hrs · ${a.palRanked[0]?.min ? `${esc(a.palRanked[0].name)} (${fmtPct(pct(a.palRanked[0].min, a.palTotal))})` : 'No data'}</div>
      </div>
      <div class="card">
        <div class="kpi-top"><span>Packers</span><span class="kpi-dot" style="background:var(--pak)"></span></div>
        <div class="kpi-val">${fmt(a.pakTotal)}<small>min</small></div>
        <div class="kpi-sub">${fmtH(a.pakTotal)} hrs · ${a.pakRanked[0]?.min ? `${esc(a.pakRanked[0].name)} (${fmtPct(pct(a.pakRanked[0].min, a.pakTotal))})` : 'No data'}</div>
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-head"><h2>Palletizers</h2><span>${fmt(a.palTotal)} min</span></div>
        <div class="chart-row">
          ${pieSVG(palItems.map(x => ({ value: x.min, color: x.color })), 104, { donut: true })}
          <div class="legend-list">${legend(palItems, a.palTotal, () => '#233f64', 'data-drill-machine')}</div>
        </div>
        <div class="chart-divider">
          <div class="chart-subhead">All Reasons</div>
          <div class="chart-row">
            ${pieSVG(a.topPal.rows.map(x => ({ value: x.min, color: CAT_COLOR[x.name] || '#999' })), 104, { donut: true })}
            <div class="legend-list">${legend(a.topPal.rows, a.palTotal, n => CAT_COLOR[n] || '#999', 'data-drill-pal')}</div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h2>Packers</h2><span>${fmt(a.pakTotal)} min</span></div>
        <div class="chart-row">
          ${pieSVG(pakItems.map(x => ({ value: x.min, color: x.color })), 104, { donut: true })}
          <div class="legend-list">${legend(pakItems, a.pakTotal, () => '#2b7a78', 'data-drill-machine')}</div>
        </div>
        <div class="chart-divider">
          <div class="chart-subhead">All Reasons</div>
          <div class="chart-row">
            ${pieSVG(a.topPak.rows.map(x => ({ value: x.min, color: CAT_COLOR[x.name] || '#999' })), 104, { donut: true })}
            <div class="legend-list">${legend(a.topPak.rows, a.pakTotal, n => CAT_COLOR[n] || '#999', 'data-drill-pak')}</div>
          </div>
        </div>
      </div>
    </div>`;

  $('#ovRoutingToggle', el).onchange = e => {
    state.routing.enabled = e.target.checked;
    saveLS(LS.routing, state.routing);
    refresh();
  };
  $$('[data-drill-machine]', el).forEach(n => n.onclick = () => openDrill(n.dataset.drillMachine, a.byMachine[n.dataset.drillMachine].recs));
  $$('[data-drill-pal]', el).forEach(n => n.onclick = () => {
    const g = n.dataset.drillPal;
    if (g === 'Remaining categories') return;
    openDrill(`Palletizers · ${g}`, a.validMachine.filter(r => r.type === 'Palletizer' && r.group === g));
  });
  $$('[data-drill-pak]', el).forEach(n => n.onclick = () => {
    const g = n.dataset.drillPak;
    if (g === 'Remaining categories') return;
    openDrill(`Packers · ${g}`, a.validMachine.filter(r => r.type === 'Packer' && r.group === g));
  });
}

// ---------------------------------------------------------------- Render: Routing
function renderRouting(a) {
  const el = $('#tab-routing');
  if (!a) { el.innerHTML = ''; return; }
  const rt = state.routing;
  const movedMin = sum(a.transfers, t => t.dt);

  el.innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">Plant Line Flow</div>
        <h1>Belt Routing</h1>
      </div>
      <span class="badge ${rt.enabled ? 'badge-ok' : 'badge-muted'}">${rt.enabled ? `${a.transfers.length} transfers · ${fmt(movedMin)} min` : 'Auto-Routing Off'}</span>
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="line-label">LINE 1</div>
        <div class="line-flow">
          <div class="packer-stack">
            <span class="packer-chip">Packer 1</span>
            <span class="packer-chip">Packer 2</span>
            <span class="packer-chip">Packer 3</span>
          </div>
          <div class="flow-arrow"><div class="flow-dash"></div>Diverter Belt →</div>
          <div class="pal-box" style="background:var(--pal)">Palletizer 1</div>
        </div>
      </div>
      <div class="card">
        <div class="line-label">LINE 2</div>
        <div class="line-flow">
          <div class="packer-stack">
            <span class="packer-chip">Packer 2</span>
            <span class="packer-chip">Packer 3</span>
            <span class="packer-chip">Packer 4</span>
          </div>
          <div class="flow-arrow"><div class="flow-dash"></div>Diverter Belt →</div>
          <div class="pal-box" style="background:var(--pak)">Palletizer 2</div>
        </div>
      </div>
    </div>

    <div class="card card-list">
      <div class="list-row">
        <div>
          <div class="row-title">Diverter Belt → Active Packer</div>
          <div class="row-sub">Auto-detect running packer from shift logs</div>
        </div>
        <label class="ios-switch"><input type="checkbox" data-rt="diverterToPacker" ${rt.diverterToPacker ? 'checked' : ''}><span class="ios-slider"></span></label>
      </div>
      <div class="list-row">
        <div>
          <div class="row-title">Merge Long Conveyor → Diverter Belt</div>
          <div class="row-sub">Combine cause and attribute to Packer</div>
        </div>
        <label class="ios-switch"><input type="checkbox" data-rt="mergeLongConveyor" ${rt.mergeLongConveyor ? 'checked' : ''}><span class="ios-slider"></span></label>
      </div>
      <div class="list-row">
        <div>
          <div class="row-title">Turning Bar &amp; Palletizer Causes → Palletizer</div>
          <div class="row-sub">Fix entries mistakenly logged under Packer</div>
        </div>
        <label class="ios-switch"><input type="checkbox" data-rt="turningBarToPalletizer" ${rt.turningBarToPalletizer ? 'checked' : ''}><span class="ios-slider"></span></label>
      </div>
      <div class="list-row">
        <div>
          <div class="row-title">Packer Attribution Mode</div>
          <div class="row-sub">Match active packer per shift or split equally across active packers</div>
        </div>
        <div class="seg-wrap">
          <button class="seg-btn" type="button" data-rt-mode="active" aria-selected="${rt.mode === 'active'}">Active Packer</button>
          <button class="seg-btn" type="button" data-rt-mode="equal" aria-selected="${rt.mode === 'equal'}">Split Equal</button>
        </div>
      </div>
    </div>

    <details class="card" ${a.transfers.length && a.transfers.length <= 25 ? 'open' : ''}>
      <summary><span>Transfer Audit Log (${a.transfers.length} records · ${fmt(movedMin)} min)</span><span class="eyebrow">Click to expand</span></summary>
      ${a.transfers.length ? `<div class="table-wrap scroll-y" style="margin-top:14px">
        <table class="clean-tbl">
          <thead><tr><th>Sheet · Row</th><th>From</th><th>To</th><th>Cause</th><th class="num">DT</th><th>Rule</th></tr></thead>
          <tbody>${a.transfers.slice(0, 300).map(t => `<tr>
            <td class="tabular">Day ${esc(t.rec.sheet)} · R${t.rec.row}</td>
            <td>${esc(t.from)}</td>
            <td><strong>${esc(t.to)}</strong></td>
            <td>${esc(t.cause)}${t.cause !== t.causeAfter ? ` → ${esc(t.causeAfter)}` : ''}</td>
            <td class="num">${fmt(t.dt)} min</td>
            <td style="color:var(--muted)">${esc(t.why)}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>` : `<p class="row-sub" style="margin-top:12px">No transfers applied with current settings.</p>`}
    </details>`;

  $$('[data-rt]', el).forEach(inp => inp.onchange = () => {
    state.routing[inp.dataset.rt] = inp.checked;
    if (inp.checked) state.routing.enabled = true;
    saveLS(LS.routing, state.routing);
    refresh();
  });
  $$('[data-rt-mode]', el).forEach(b => b.onclick = () => {
    state.routing.mode = b.dataset.rtMode;
    saveLS(LS.routing, state.routing);
    refresh();
  });
}

// ---------------------------------------------------------------- 3-Page A4 Landscape PDF Builder
function pdfLegendRows(items, total, colorFn, showHours = false) {
  return items.map(x => {
    const col = x.color || colorFn(x.name);
    const val = showHours
      ? `${fmt(x.min)} min | ${fmtH(x.min)} h | ${fmtPct(pct(x.min, total))}`
      : `${fmt(x.min)} min | ${fmtPct(pct(x.min, total))}`;
    return `<div class="a4-leg-row">
      <span class="a4-leg-l"><span class="sq" style="background:${col}"></span><span>${esc(x.name)}</span></span>
      <span class="a4-leg-v">${val}</span>
    </div>`;
  }).join('');
}

function buildPdfPage1(a) {
  const palM = a.palRanked.map(x => ({ name: x.name, min: x.min, color: MACHINE_COLOR[x.name] }));
  const pakM = a.pakRanked.map(x => ({ name: x.name, min: x.min, color: MACHINE_COLOR[x.name] }));
  const noDataPaks = PACKERS.filter(n => a.byMachine[n].min === 0);
  const pakNote = `${PACKERS.length - noDataPaks.length} machines${noDataPaks.length ? `; ${noDataPaks.join(', ')} no data` : ''}`;

  return `<div class="a4-page">
    <div>
      <div class="a4-top-meta">
        <strong>${esc(a.month.label.toUpperCase())}</strong>
        <span>${esc(a.month.dateRange)} | Packer 1-4 and Palletizer 1-2</span>
      </div>
      <div class="a4-title">Start Stop Downtime Report</div>
      <hr class="a4-rule">
      <div class="a4-sub">${esc(a.headline)} Palletizers and packers are shown separately, each as its own 100%.</div>

      <div class="a4-kpis">
        <div class="a4-kpi">
          <div class="l">Recorded downtime</div>
          <div class="v">${fmt(a.total)} min</div>
          <div class="s">${fmtH(a.total, 2)} h | ${a.activeMachineCount} machines with recorded intervals</div>
        </div>
        <div class="a4-kpi">
          <div class="l">Palletizers</div>
          <div class="v">${fmt(a.palTotal)} min</div>
          <div class="s">${fmtH(a.palTotal, 2)} h | 2 machines</div>
        </div>
        <div class="a4-kpi pak">
          <div class="l">Packers</div>
          <div class="v">${fmt(a.pakTotal)} min</div>
          <div class="s">${fmtH(a.pakTotal, 2)} h | ${esc(pakNote)}</div>
        </div>
      </div>

      <div class="a4-cols">
        <div>
          <div class="a4-sec-bar">PALLETIZERS | ${fmt(a.palTotal)} min | ${fmtH(a.palTotal)} h | 100%</div>
          <div class="a4-pie-row">
            ${pieSVG(palM.map(x => ({ value: x.min, color: x.color })), 124)}
            <div class="a4-leg">${pdfLegendRows(palM, a.palTotal, () => '#233f64', true)}</div>
          </div>
          <div class="a4-pie-title">All reasons (% of palletizer total)</div>
          <div class="a4-pie-row">
            ${pieSVG(a.topPal.rows.map(x => ({ value: x.min, color: CAT_COLOR[x.name] || '#999' })), 120)}
            <div class="a4-leg a4-leg-compact">${pdfLegendRows(a.topPal.rows, a.palTotal, n => CAT_COLOR[n] || '#999')}</div>
          </div>
        </div>

        <div>
          <div class="a4-sec-bar pak">PACKERS | ${fmt(a.pakTotal)} min | ${fmtH(a.pakTotal)} h | 100%</div>
          <div class="a4-pie-row">
            ${pieSVG(pakM.map(x => ({ value: x.min, color: x.color })), 120)}
            <div class="a4-leg">${pdfLegendRows(pakM, a.pakTotal, () => '#2b7a78', true)}</div>
          </div>
          <div class="a4-pie-title">All reasons (% of packer total)</div>
          <div class="a4-pie-row">
            ${pieSVG(a.topPak.rows.map(x => ({ value: x.min, color: CAT_COLOR[x.name] || '#999' })), 120)}
            <div class="a4-leg a4-leg-compact">${pdfLegendRows(a.topPak.rows, a.pakTotal, n => CAT_COLOR[n] || '#999')}</div>
          </div>
        </div>
      </div>
    </div>
    <div class="a4-foot">1 / 3</div>
  </div>`;
}

function buildPdfPage2(a) {
  const cards = MACHINES.map(name => {
    const m = a.byMachine[name];
    const isPal = name.startsWith('Palletizer');
    const slices = m.cats.map(c => ({ value: c.min, color: CAT_COLOR[c.group] || '#999' }));
    const leg = m.cats.map(c => `<div class="a4-leg-row">
      <span class="a4-leg-l"><span class="sq" style="background:${CAT_COLOR[c.group] || '#999'}"></span><span>${esc(c.group)}</span></span>
      <span class="a4-leg-v">${fmt(c.min)} min ${fmtPct(pct(c.min, m.min))}</span>
    </div>`).join('');
    return `<div class="a4-mcard${isPal ? ' pal' : ''}">
      <div class="a4-mcard-h">${esc(name.toUpperCase())}</div>
      <div class="a4-mcard-s">${m.min ? `${fmt(m.min)} min | ${m.count} records` : 'No positive-duration data recorded'}</div>
      <div class="a4-mcard-body">
        ${pieSVG(slices, 94)}
        <div class="a4-mcard-leg">${leg}</div>
      </div>
    </div>`;
  }).join('');

  return `<div class="a4-page">
    <div>
      <div class="a4-top-meta">
        <strong>${esc(a.month.label.toUpperCase())}</strong>
        <span>${esc(a.month.dateRange)} | Packer 1-4 and Palletizer 1-2</span>
      </div>
      <div class="a4-title">Start Stop Downtime Report</div>
      <hr class="a4-rule">
      <div class="a4-sub">All positive-duration reasons | minutes and % of each machine total | each pie = 100% of that machine</div>
      <div class="a4-grid-6">${cards}</div>
    </div>
    <div class="a4-foot">2 / 3</div>
  </div>`;
}

function buildPdfPage3(a) {
  const cards = MACHINES.map(name => {
    const m = a.burstByMachine[name];
    const isPal = name.startsWith('Palletizer');
    const slices = m.items.map((x, i) => ({ value: x.min, color: burstColorOf(x.cause, i) }));
    const leg = m.items.slice(0, 8).map((x, i) => `<div class="a4-leg-row">
      <span class="a4-leg-l"><span class="sq" style="background:${burstColorOf(x.cause, i)}"></span><span>${esc(x.cause)}</span></span>
      <span class="a4-leg-v">${fmt(x.min)} min | ${fmtPct(pct(x.min, m.min))}</span>
    </div>`).join('');
    return `<div class="a4-mcard${isPal ? ' pal' : ''}">
      <div class="a4-mcard-top">
        <span class="a4-mcard-h">${esc(name.toUpperCase())}</span>
        <span class="a4-mcard-s">${m.min ? `${fmt(m.min)} min` : 'No data recorded'}</span>
      </div>
      <div class="a4-mcard-body">
        ${pieSVG(slices, 72)}
        <div class="a4-mcard-leg">${leg}</div>
      </div>
    </div>`;
  }).join('');

  const machineTotals = MACHINES.map(m => a.burstByMachine[m].min);
  const rows = a.burstTable.map((r, i) => `<tr>
    <td><span class="sq" style="background:${burstColorOf(r.cause, i)}"></span>${esc(r.cause)}</td>
    ${r.cells.map(v => `<td>${v ? fmt(v) : '-'}</td>`).join('')}
    <td><strong>${fmt(r.total)}</strong></td>
    <td>${fmtPct(r.share)}</td>
  </tr>`).join('');

  const tblHTML = a.burstTable.length
    ? `<table class="a4-tbl">
        <thead><tr><th>Causes</th><th>Packer 1</th><th>Packer 2</th><th>Packer 3</th><th>Packer 4</th><th>Pal 1</th><th>Pal 2</th><th>Total</th><th>Share</th></tr></thead>
        <tbody>
          ${rows}
          <tr class="total-row">
            <td>All causes</td>
            ${machineTotals.map(v => `<td>${v ? fmt(v) : '-'}</td>`).join('')}
            <td>${fmt(a.burstTotal)}</td>
            <td>100.0%</td>
          </tr>
        </tbody>
      </table>`
    : `<p style="font-size:11px;color:#64748b;margin-top:12px">No Burst Bag Cause column recorded in this workbook.</p>`;

  return `<div class="a4-page">
    <div>
      <div class="a4-top-meta">
        <strong>${esc(a.month.label.toUpperCase())}</strong>
        <span>${esc(a.month.dateRange)} | Packer 1-4 and Palletizer 1-2</span>
      </div>
      <div class="a4-title">Burst Bag Issues</div>
      <hr class="a4-rule">
      <div class="a4-sub">Each pie = 100% of that machine | minutes per cause</div>
      <div class="a4-grid-6 compact">${cards}</div>
      <div class="a4-tbl-title">Burst/stuck bag minutes by cause and machine</div>
      ${tblHTML}
    </div>
    <div class="a4-foot">3 / 3</div>
  </div>`;
}

function renderPdfTab(a) {
  const el = $('#tab-pdf');
  const pr = $('#printReport');
  if (!a) { el.innerHTML = ''; pr.innerHTML = ''; return; }
  const pages = [buildPdfPage1(a), buildPdfPage2(a), buildPdfPage3(a)];
  pr.innerHTML = pages.join('');

  el.innerHTML = `
    <div class="pdf-bar">
      <div class="seg-wrap">
        <button class="seg-btn" type="button" data-pdf-page="1" aria-selected="${state.pdfPage === 1}">Page 1 · Summary</button>
        <button class="seg-btn" type="button" data-pdf-page="2" aria-selected="${state.pdfPage === 2}">Page 2 · Machines</button>
        <button class="seg-btn" type="button" data-pdf-page="3" aria-selected="${state.pdfPage === 3}">Page 3 · Burst Bag</button>
      </div>
      <button class="pill-btn pill-primary" id="savePdfBtn" type="button">Save 3-Page PDF</button>
    </div>
    <div class="pdf-stage">${pages[state.pdfPage - 1]}</div>`;

  $$('[data-pdf-page]', el).forEach(b => b.onclick = () => {
    state.pdfPage = +b.dataset.pdfPage;
    renderPdfTab(a);
  });
  $('#savePdfBtn', el).onclick = triggerPrint;
}

// ---------------------------------------------------------------- Render: Issues (Data Check)
function renderIssues(a) {
  const el = $('#tab-issues');
  if (!a) { el.innerHTML = ''; return; }

  const sharedRows = a.sharedUnplanned.map(r => `
    <div class="list-row">
      <div>
        <div class="row-title">Day ${esc(r.sheet)} · R${r.row} · ${esc(r.reason)} (${fmt(r.dt)} min)</div>
        <div class="row-sub">Logged under "${esc(r.equipmentOrig)}" — excluded from machine pies unless assigned</div>
      </div>
      <div class="inline-controls">
        <select class="mini-select" data-assign-eq="${esc(r.fk)}">
          <option value="">Assign machine…</option>
          ${MACHINES.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('')}
        </select>
      </div>
    </div>`).join('');

  const unclassMap = new Map();
  for (const r of a.unclassifiedRecs) {
    const k = normKey(r.reason);
    const o = unclassMap.get(k) || { key: k, text: r.reason, count: 0, min: 0 };
    o.count++; o.min += r.dt;
    unclassMap.set(k, o);
  }
  const unclassRows = [...unclassMap.values()].sort((x, y) => y.min - x.min).map(u => `
    <div class="list-row">
      <div>
        <div class="row-title">${esc(u.text)} <span class="badge badge-muted">${u.count} · ${fmt(u.min)} min</span></div>
        <div class="row-sub">Included in machine totals as "Unclassified reasons"</div>
      </div>
      <select class="mini-select" data-map-reason="${esc(u.key)}">
        <option value="">Keep as Unclassified</option>
        <optgroup label="Unplanned">${UNPLANNED_GROUPS.filter(g => g !== UNCLASSIFIED).map(g => `<option value="${esc(g)}">${esc(g)}</option>`).join('')}</optgroup>
        <optgroup label="Planned">${PLANNED_GROUPS.map(g => `<option value="${esc(g)}">${esc(g)}</option>`).join('')}</optgroup>
      </select>
    </div>`).join('');

  const missingRows = a.missingDataMachines.map(m => `
    <div class="list-row">
      <div>
        <div class="row-title">${esc(m)} · No records</div>
        <div class="row-sub">Shown as "No data" in PDF</div>
      </div>
      <span class="badge badge-muted">Info</span>
    </div>`).join('');

  const hasFixes = Object.keys(state.rowFixes).length > 0 || Object.keys(state.overrides).length > 0;

  el.innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">${a.month.autoFixedCount} time typos auto-fixed</div>
        <h1>Data Check</h1>
      </div>
      <div class="inline-controls">
        <button class="pill-btn" id="dlCleanXlsx" type="button">Download Cleaned Excel</button>
        ${hasFixes ? `<button class="pill-btn" id="resetFixesBtn" type="button">Reset Fixes</button>` : ''}
        <span class="badge badge-ok">✓ Ready for PDF</span>
      </div>
    </div>

    <div class="card card-list">
      ${sharedRows || unclassRows || missingRows
        ? sharedRows + unclassRows + missingRows
        : `<div class="list-row"><div class="row-title">All records look clean.</div><span class="badge badge-ok">0 issues</span></div>`}
    </div>

    <details class="card">
      <summary><span>All Parsed Records (${a.recs.length})</span><span class="eyebrow">Search &amp; verify</span></summary>
      <div style="margin:12px 0"><input class="mini-input" style="width:100%;max-width:340px" id="recSearch" type="search" placeholder="Filter by machine, reason, cause…" value="${esc(state.recFilter)}"></div>
      <div class="table-wrap scroll-y" id="recTableWrap"></div>
    </details>`;

  $$('[data-assign-eq]', el).forEach(sel => sel.onchange = () => {
    if (!sel.value) return;
    const fk = sel.dataset.assignEq;
    const prev = state.rowFixes[fk] ? { ...state.rowFixes[fk] } : null;
    state.rowFixes[fk] = { ...(state.rowFixes[fk] || {}), equipment: sel.value };
    saveLS(LS.rowFixes, state.rowFixes);
    toast(`Assigned to ${sel.value}`, {
      undo: () => { if (prev) state.rowFixes[fk] = prev; else delete state.rowFixes[fk]; saveLS(LS.rowFixes, state.rowFixes); refresh(); },
    });
    refresh();
  });

  $$('[data-map-reason]', el).forEach(sel => sel.onchange = () => {
    if (!sel.value) return;
    const k = sel.dataset.mapReason;
    state.overrides[k] = sel.value;
    saveLS(LS.overrides, state.overrides);
    toast(`Mapped to ${sel.value}`, {
      undo: () => { delete state.overrides[k]; saveLS(LS.overrides, state.overrides); refresh(); },
    });
    refresh();
  });

  $('#dlCleanXlsx', el).onclick = () => exportCleanedExcel(a);
  const resetBtn = $('#resetFixesBtn', el);
  if (resetBtn) resetBtn.onclick = () => {
    state.rowFixes = {}; state.overrides = {};
    saveLS(LS.rowFixes, state.rowFixes); saveLS(LS.overrides, state.overrides);
    toast('All manual fixes cleared.');
    refresh();
  };

  const renderRecs = () => {
    const q = state.recFilter.toLowerCase();
    const list = a.recs.filter(r => !q || `${r.sheet} ${r.equipment} ${r.reason} ${r.group} ${r.cause}`.toLowerCase().includes(q));
    $('#recTableWrap', el).innerHTML = `<table class="clean-tbl">
      <thead><tr><th>Day</th><th>Stop</th><th>Start</th><th class="num">DT</th><th>Equipment</th><th>Reason</th><th>Category</th><th>Burst Cause</th></tr></thead>
      <tbody>${list.slice(0, 500).map(r => `<tr>
        <td class="tabular">${r.day}</td>
        <td class="tabular">${clock(r.stop)}</td>
        <td class="tabular">${clock(r.start)}</td>
        <td class="num">${r.dt != null ? fmt(r.dt) : '—'}</td>
        <td>${esc(r.equipment)}${r.routed ? ' <span class="badge badge-ok">routed</span>' : ''}</td>
        <td>${esc(r.reason)}</td>
        <td>${esc(r.group)}</td>
        <td>${esc(r.cause)}</td>
      </tr>`).join('')}</tbody>
    </table>${list.length > 500 ? `<p class="row-sub" style="padding:10px">Showing first 500 of ${list.length} records.</p>` : ''}`;
  };
  renderRecs();
  $('#recSearch', el).oninput = e => { state.recFilter = e.target.value; renderRecs(); };
}

function exportCleanedExcel(a) {
  if (typeof XLSX === 'undefined') return;
  const rows = a.validMachine.map(r => ({
    Day: r.day, Sheet: r.sheet, Row: r.row, Block: r.block,
    Stop: clock(r.stop), Start: clock(r.start), 'DT (min)': Math.round(r.dt),
    'Original Equipment': r.equipmentOrig, Equipment: r.equipment, Routed: r.routed ? 'Yes' : 'No',
    Reason: r.reason, 'Reason Group': r.group, 'Burst Bag Cause': r.cause, Remarks: r.remarks,
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Cleaned_Records');
  XLSX.writeFile(wb, `Cleaned_${a.month.label.replace(/\s+/g, '_')}.xlsx`);
  toast('Downloaded cleaned Excel.');
}

// ---------------------------------------------------------------- Modal, Print & Theme
function openDrill(title, recs) {
  const dlg = $('#drillDialog');
  $('#drillTitle').textContent = title;
  $('#drillSub').textContent = `${recs.length} records · ${fmt(sum(recs, r => r.dt))} min`;
  $('#drillBody').innerHTML = `<table class="clean-tbl">
    <thead><tr><th>Day</th><th>Stop–Start</th><th class="num">DT</th><th>Reason</th><th>Cause</th></tr></thead>
    <tbody>${recs.slice(0, 300).map(r => `<tr>
      <td class="tabular">${r.day}</td>
      <td class="tabular">${clock(r.stop)}–${clock(r.start)}</td>
      <td class="num">${fmt(r.dt)} min</td>
      <td>${esc(r.reason)}</td>
      <td>${esc(r.cause)}</td>
    </tr>`).join('')}</tbody>
  </table>`;
  dlg.showModal();
}

function triggerPrint() {
  const a = state.analysis;
  if (!a) return;
  const old = document.title;
  document.title = `Start Stop Report ${a.month.label}`;
  window.print();
  setTimeout(() => (document.title = old), 500);
}

function applyTheme(t) {
  const theme = t === 'dark' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', theme);
  const nextIsDark = theme === 'light';
  $('#themeIcon').textContent = nextIsDark ? '☾' : '☀';
  $('#themeText').textContent = nextIsDark ? 'Dark' : 'Light';
}

// ---------------------------------------------------------------- Navigation & App Loop
function setTab(tab) {
  if (!['overview', 'routing', 'pdf', 'issues'].includes(tab)) tab = 'overview';
  state.tab = tab;
  $$('[data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  const loaded = state.months.size > 0;
  ['overview', 'routing', 'pdf', 'issues'].forEach(p => {
    $('#tab-' + p).hidden = !loaded || p !== tab;
  });
}

function refresh() {
  const loaded = state.months.size > 0;
  $('#loader').hidden = loaded;
  $('#monthSelect').hidden = !loaded;
  $('#pdfBtn').hidden = !loaded;

  if (!loaded) {
    ['overview', 'routing', 'pdf', 'issues'].forEach(p => ($('#tab-' + p).hidden = true));
    $('#issuesBadge').hidden = true;
    $('#issuesBadgeMob').hidden = true;
    return;
  }

  const sel = $('#monthSelect');
  sel.innerHTML = [...state.months.keys()].map(k => `<option value="${esc(k)}"${k === state.current ? ' selected' : ''}>${esc(k)}</option>`).join('');
  const a = analyze(state.months.get(state.current));
  state.analysis = a;

  const badgeText = a.issuesCount > 0 ? String(a.issuesCount) : '';
  $('#issuesBadge').textContent = badgeText; $('#issuesBadge').hidden = !badgeText;
  $('#issuesBadgeMob').textContent = badgeText; $('#issuesBadgeMob').hidden = !badgeText;

  renderOverview(a);
  renderRouting(a);
  renderPdfTab(a);
  renderIssues(a);
  setTab(state.tab);
}

async function readFile(name, buf) {
  const wb = XLSX.read(buf, { type: 'array', cellDates: false });
  const m = parseWorkbook(wb, name);
  if (!m.daySheets.length) throw new Error(`${name}: no daily sheets (1–31) found.`);
  state.months.set(m.key, m);
  state.current = m.key;
  return m;
}

async function handleFiles(files) {
  let ok = 0;
  for (const f of files) {
    if (!/\.xls[xm]?$/i.test(f.name)) { toast(`${f.name} is not an Excel file.`); continue; }
    try {
      const m = await readFile(f.name, await f.arrayBuffer());
      ok++;
      toast(`Loaded ${m.label} (${m.records.length} rows)`);
    } catch (e) { console.error(e); toast(e.message || `Could not read ${f.name}`); }
  }
  if (ok) refresh();
}

function init() {
  const savedTheme = loadRawLS(LS.theme, null)
    || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  applyTheme(savedTheme);

  $('#themeBtn').onclick = () => {
    const cur = document.documentElement.getAttribute('data-theme');
    const next = cur === 'dark' ? 'light' : 'dark';
    saveLS(LS.theme, next);
    applyTheme(next);
  };

  const input = $('#fileInput');
  input.onchange = () => { handleFiles([...input.files]); input.value = ''; };
  $('#uploadBtn').onclick = () => input.click();
  $('#pdfBtn').onclick = () => { setTab('pdf'); setTimeout(triggerPrint, 60); };
  $('#monthSelect').onchange = e => { state.current = e.target.value; refresh(); };

  $('#sampleBtn').onclick = async () => {
    try {
      const res = await fetch('sample/START_STOP_PACKER_SAMPLE.xlsx');
      if (!res.ok) throw new Error('Sample file not found.');
      await readFile('START_STOP_PACKER_SAMPLE.xlsx', await res.arrayBuffer());
      refresh();
    } catch (e) { toast(e.message || 'Could not load sample.'); }
  };

  const dlg = $('#drillDialog');
  $('#drillClose').onclick = () => dlg.close();
  dlg.onclick = e => { if (e.target === dlg) dlg.close(); };

  const dz = $('#dropzone');
  ['dragenter', 'dragover'].forEach(ev => document.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach(ev => document.addEventListener(ev, e => { e.preventDefault(); if (ev === 'drop' || e.target === dz) dz.classList.remove('drag'); }));
  document.addEventListener('drop', e => { dz.classList.remove('drag'); if (e.dataTransfer?.files?.length) handleFiles([...e.dataTransfer.files]); });

  $$('[data-tab]').forEach(b => b.onclick = () => setTab(b.dataset.tab));
  refresh();
}

window.StartStopAnalyzer = { parseTime, parseDT, normEquipment, parseWorkbook, analyze, classify, normCause };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
