/* Start Stop Analyzer — all processing happens in the browser. No data is sent anywhere. */
'use strict';
(() => {

// ---------------------------------------------------------------- constants
const PALLETIZERS = ['Palletizer 1', 'Palletizer 2'];
const PACKERS = ['Packer 1', 'Packer 2', 'Packer 3', 'Packer 4'];
const MACHINES = [...PALLETIZERS, ...PACKERS];
const SHARED = 'All / Shared';
const EQUIP_CHOICES = [...PALLETIZERS, ...PACKERS, SHARED];

const PLANNED_GROUPS = ['Break', 'Housekeeping', 'Shift Changeover', 'Mechanical PM (Greasing)',
  'Planned Maintenance', 'Compliance/Calibration'];
const UNPLANNED_GROUPS = ['Burst/Stuck Bag', 'Mis-shooting Bag', 'Stretch Hood Plastic', 'Flat Film Plastic',
  'Layer Pusher/Conveyor Mech', 'Sensor/Electrical Issue', 'Spout/Cement Filling Issue', 'Destroyer Belt Issue',
  'Auto Placer Issue', 'Packer Bin Issue', 'Silo/Dust Plant Issue', 'Check Weigher Issue', 'Compressor Trip',
  'Air Hose Leaking (General)', 'Other'];
const UNCLASSIFIED = 'Unclassified';
const BURST_GROUP = 'Burst/Stuck Bag';
const categoryOf = g => PLANNED_GROUPS.includes(g) ? 'Planned' : UNPLANNED_GROUPS.includes(g) ? 'Unplanned' : UNCLASSIFIED;

// Keyword rules: regex (case-insensitive), first match wins. Order matters.
const DEFAULT_RULES = [
  ['\\b(break|rehat|lunch|dinner|supper|tea ?break|meal|prayer|solat|makan)\\b', 'Break'],
  ['house ?keeping|\\bcleaning\\b|clean ?up|\\b5s\\b', 'Housekeeping'],
  ['shift ?change|change ?over|hand ?over|closing for|shift closing|end of shift|(stop|start)\\s+(packer|palleti[sz]er|operation|pcc|tsc|opc)|\\bnot\\s+operat|\\bno\\s+operat', 'Shift Changeover'],
  ['greas|lubric', 'Mechanical PM (Greasing)'],
  ['\\bpm\\b|planned maint|preventive|scheduled maint', 'Planned Maintenance'],
  ['calibrat|compliance|audit|weight verification|lab ?sampl|stock ?check', 'Compliance/Calibration'],
  ['mis-? ?shoot|miss ?shoot|misshoot|missshoot', 'Mis-shooting Bag'],
  ['d[ei]stroyer|bag ?cutter', 'Destroyer Belt Issue'],
  ['emergency ?(stop|off)|safety ?photo ?(cell|eye)|swing ?table ?sensor', 'Sensor/Electrical Issue'],
  ['stretch ?hood|stretchood|s\\/hood|hood (film|plastic)|film ?retriev', 'Stretch Hood Plastic'],
  ['flat ?film|f\\/film|flap ?film', 'Flat Film Plastic'],
  ['check ?weigh', 'Check Weigher Issue'],
  ['burst|stuck bag|bag stuck|bag jam|jammed bag|bag koyak|bag pecah|remove empty bag|empty pallet stuck|pallet stuck', 'Burst/Stuck Bag'],
  ['auto ?placer|bag ?placer|sucker ?arm|vacuum ?motor', 'Auto Placer Issue'],
  ['layer ?pusher|pusher|guiding ?plate|diverter|discharge ?belt|vibrator ?screen|scrup?per|turning ?(bar|device)|conveyor|roller|chain', 'Layer Pusher/Conveyor Mech'],
  ['compressor', 'Compressor Trip'],
  ['air ?hose|hose ?leak|air ?leak', 'Air Hose Leaking (General)'],
  ['silo|dust|bag ?filter|aeration', 'Silo/Dust Plant Issue'],
  ['spout|filling|nozzle|air ?slide|cement ?flow', 'Spout/Cement Filling Issue'],
  ['packer ?bin|bin ?packer|\\bbin\\b|hopper', 'Packer Bin Issue'],
  ['sensor|electric|photo ?(cell|eye)|proximity|\\bplc\\b|motor|inverter|\\bvsd\\b|fuse|\\btrip|alarm|power ?supply|download ?software|flow ?gate', 'Sensor/Electrical Issue'],
].map(([pattern, group]) => ({ pattern, group }));

const DEFAULT_ALIASES = [{ from: 'Long conveyor', to: 'Diverter belt' }];

const LS = {
  rules: 'ssa.rules.v1',
  aliases: 'ssa.aliases.v1',
  overrides: 'ssa.reasonMap.v1',
  eqMap: 'ssa.eqMap.v1',
  rowFixes: 'ssa.rowFixes.v1',
  theme: 'ssa.theme.v1',
};
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September',
  'October', 'November', 'December'];

// ---------------------------------------------------------------- helpers
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => Math.round(n).toLocaleString('en-US');
const fmtH = n => (n / 60).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const pct = (a, b) => (b > 0 ? (a / b) * 100 : 0);
const fmtPct = p => (p > 0 && p < 10 ? p.toFixed(1) : Math.round(p)) + '%';
const cellText = v => (v == null ? '' : String(v).replace(/\u00a0/g, ' ').trim());
const normKey = s => cellText(s).toLowerCase().replace(/\s+/g, ' ');
const sentenceCase = s => { s = cellText(s).replace(/\s+/g, ' '); return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s; };
const titleCase = s => cellText(s).toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
const clock = min => {
  if (min == null) return '';
  const m = ((Math.round(min) % 1440) + 1440) % 1440, h = Math.floor(m / 60);
  return String(h).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
};
const sum = (arr, f = x => x) => arr.reduce((a, x) => a + f(x), 0);
const fixKey = (fileName, sheet, row) => `${fileName}||${sheet}||${row}`;

function loadLS(key, def) {
  try { const v = localStorage.getItem(key); if (v) return JSON.parse(v); } catch (e) { /* ignore */ }
  return JSON.parse(JSON.stringify(def));
}
function saveLS(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); return true; } catch (e) { return false; }
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
    btn.type = 'button';
    btn.className = 'toast-undo';
    btn.textContent = 'Undo';
    btn.onclick = () => { t.hidden = true; clearTimeout(toastTimer); opts.undo(); };
    t.appendChild(btn);
  }
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), opts.undo ? 6500 : 4000);
}

// ---------------------------------------------------------------- state
const state = {
  months: new Map(),       // key -> parsed month
  current: null,
  tab: 'report',
  rules: loadLS(LS.rules, DEFAULT_RULES),
  aliases: loadLS(LS.aliases, DEFAULT_ALIASES),
  overrides: loadLS(LS.overrides, {}),  // normalized reason text -> group
  eqMap: loadLS(LS.eqMap, {}),          // normalized unknown equipment -> canonical machine
  rowFixes: loadLS(LS.rowFixes, {}),    // fileName||sheet||row -> { dt, stop, start, equipment, reason, group, cause, excluded, ackLong, useCalcDt }
  compiled: [],
  analysis: null,
  qFilter: { sev: '', text: '' },
  openGroups: {},                       // type -> boolean (user toggle memory)
  recFilter: { text: '', cat: '', eq: '', status: '' },
};

function compileRules() {
  state.compiled = [];
  for (const r of state.rules) {
    if (!r.pattern || !r.pattern.trim()) continue;
    try { state.compiled.push({ re: new RegExp(r.pattern, 'i'), group: r.group }); } catch (e) { /* invalid: skip */ }
  }
}

function classify(reason) {
  const key = normKey(reason);
  if (!key) return { group: UNCLASSIFIED, category: UNCLASSIFIED, via: 'none' };
  if (state.overrides[key]) {
    const g = state.overrides[key];
    return { group: g, category: categoryOf(g), via: 'mapping' };
  }
  for (const r of state.compiled) {
    if (r.re.test(reason)) return { group: r.group, category: categoryOf(r.group), via: 'rule' };
  }
  return { group: UNCLASSIFIED, category: UNCLASSIFIED, via: 'none' };
}

function suggestGroup(reason) {
  const s = normKey(reason);
  if (!s) return null;
  const hints = [
    [/power|blackout|voltage|tnb|electric|switch|panel|relay|breaker|cable|wire|overload|fault|error/, 'Sensor/Electrical Issue'],
    [/waiting|lorry|truck|forklift|pallet supply|no order|standby|idle|shift|meeting|briefing|training/, 'Shift Changeover'],
    [/empty bag|magazine|paper bag|torn bag|bag drop|bag fell/, 'Auto Placer Issue'],
    [/belt|chain|gear|bearing|shaft|coupling|align|jam|guide|frame|table/, 'Layer Pusher/Conveyor Mech'],
    [/plastic|film|roll|shrink|hood|seal|heater/, 'Stretch Hood Plastic'],
    [/cement|chute|clog|block|choke|flow|weight|scale|load cell/, 'Spout/Cement Filling Issue'],
    [/air|pressure|valve|cylinder|hose|pneumatic|leak/, 'Air Hose Leaking (General)'],
    [/clean|wash|sweep|dust|house/, 'Housekeeping'],
    [/maint|repair|replace|welding|service|pm\b|check/, 'Planned Maintenance'],
  ];
  for (const [re, g] of hints) if (re.test(s)) return g;
  return 'Other';
}

function normCause(raw) {
  const key = normKey(raw);
  if (!key) return '';
  const a = state.aliases.find(x => normKey(x.from) === key && cellText(x.to));
  return a ? cellText(a.to) : sentenceCase(raw);
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = i - 1;
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[b.length];
}

function findSimilarCauses(paretoRows) {
  const valid = paretoRows.filter(r => r.cause && r.cause !== '(Not specified)');
  const pairs = [];
  const seen = new Set();
  for (let i = 0; i < valid.length; i++) {
    for (let j = i + 1; j < valid.length; j++) {
      const a = valid[i], b = valid[j];
      const ka = a.cause.toLowerCase().replace(/[^a-z0-9]/g, '');
      const kb = b.cause.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (ka.length < 4 || kb.length < 4) continue;
      const d = levenshtein(ka, kb);
      const maxLen = Math.max(ka.length, kb.length);
      const similar = (ka === kb) || (d === 1 && maxLen >= 5) || (d === 2 && maxLen >= 8);
      if (similar && !seen.has(b.cause)) {
        seen.add(b.cause);
        // keep higher-minutes/count cause as the suggested target
        const target = a.min >= b.min ? a : b;
        const from = target === a ? b : a;
        pairs.push({ from: from.cause, fromCount: from.count, fromMin: from.min, to: target.cause, toCount: target.count, toMin: target.min });
      }
    }
  }
  return pairs;
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
  if (/\d\.\d/.test(s)) { s = s.replace(/(\d)\.(?=\d)/g, '$1:'); fixes.push('"." → ":"'); }
  if (/\d,\d/.test(s)) { s = s.replace(/(\d),(?=\d)/g, '$1:'); fixes.push('"," → ":"'); }
  if (/::/.test(s)) { s = s.replace(/:+/g, ':'); fixes.push('double ":"'); }
  s = s.replace(/\s*A\.?M\.?$/, ' AM').replace(/\s*P\.?M\.?$/, ' PM').trim();

  // 4-digit military time e.g. "0705" or "1430"
  const m4 = s.match(/^(\d{2})(\d{2})$/);
  if (m4 && +m4[1] <= 24 && +m4[2] <= 59) {
    fixes.push('HHMM → HH:MM');
    return { min: ((+m4[1] * 60 + +m4[2]) % 1440), fixes, raw: orig };
  }

  const m = s.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?(?:\s*(AM|PM))?$/);
  if (!m) {
    if (/^0?\.\d+$/.test(orig)) return parseTime(parseFloat(orig));
    return { error: true, raw: orig };
  }
  let h = +m[1]; const mi = +m[2], sec = +(m[3] || 0), ap = m[4];
  if (mi > 59 || sec > 59) return { error: true, raw: orig };
  if (ap) {
    if (h === 0 && ap === 'AM') {
      fixes.push('0:xx AM → 12:xx AM');
      return { min: (mi + sec / 60) % 1440, fixes, raw: orig };
    }
    if (h < 1 || h > 12) return { error: true, raw: orig };
    h = (h % 12) + (ap === 'PM' ? 12 : 0);
  } else if (h > 24 || (h === 24 && (mi > 0 || sec > 0))) {
    return { error: true, raw: orig };
  }
  return { min: (h * 60 + mi + sec / 60) % 1440, fixes, raw: orig };
}

function parseDT(v) {
  if (v == null || v === '') return { empty: true };
  if (typeof v === 'number') {
    if (!isFinite(v)) return { error: true, raw: String(v) };
    if (v < 0) return { error: true, negative: true, raw: String(v) };
    if (v < 1) return { min: Math.round(v * 1440 * 60) / 60 };
    return { min: v, note: 'DT was a plain number; read as minutes' };
  }
  if (v instanceof Date) return { min: v.getHours() * 60 + v.getMinutes() };
  const orig = cellText(v);
  if (!orig || /^[-–—]+$/.test(orig)) return { empty: true };
  if (/^#/.test(orig)) return { error: true, raw: orig };
  let s = orig, fixes = [];
  if (s.includes(';')) { s = s.replace(/;/g, ':'); fixes.push('";" → ":"'); }
  if (/\d,\d/.test(s) && !/min|hr|h\b/i.test(s)) { s = s.replace(/(\d),(?=\d)/g, '$1:'); fixes.push('"," → ":"'); }

  // Operator typed duration as AM/PM time e.g. "0:04PM", "0:15 AM", "12:05 AM"
  let m = s.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?\s*(AM|PM)$/i);
  if (m && (+m[1] === 0 || (+m[1] === 12 && m[4].toUpperCase() === 'AM')) && +m[2] <= 59) {
    fixes.push('AM/PM duration → min');
    return { min: +m[2] + (+(m[3] || 0)) / 60, fixes, raw: orig };
  }
  // Standard hh:mm(:ss)
  m = s.match(/^(\d{1,3}):(\d{1,2})(?::(\d{1,2}))?$/);
  if (m && +m[2] <= 59 && +(m[3] || 0) <= 59) return { min: +m[1] * 60 + +m[2] + (+(m[3] || 0)) / 60, fixes, raw: orig };
  // "1h 20m", "1 hr 15 min"
  m = s.match(/^(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\s*(?:(\d+(?:\.\d+)?)\s*(?:m|min|mins|minutes)?)?$/i);
  if (m) return { min: +m[1] * 60 + (+(m[2] || 0)), fixes, raw: orig };
  // Plain minutes "45", "45 min", "45m"
  m = s.match(/^(\d+(?:\.\d+)?)\s*(min|mins|minutes|m)?$/i);
  if (m) return { min: +m[1], note: m[2] ? undefined : 'DT was a plain number; read as minutes', raw: orig };
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
  let m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (m) { let y = +m[3]; if (y < 100) y += 2000; return { y, m: +m[2], d: +m[1] }; }
  m = s.match(/^(\d{1,2})[\s\-]+([A-Za-z]{3,9})[\s\-,]+(\d{2,4})$/);
  if (m) {
    const mi = MONTHS.findIndex(x => x.slice(0, 3).toLowerCase() === m[2].slice(0, 3).toLowerCase());
    let y = +m[3]; if (y < 100) y += 2000;
    if (mi >= 0) return { y, m: mi + 1, d: +m[1] };
  }
  const t = Date.parse(s);
  if (!isNaN(t)) { const d = new Date(t); return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() }; }
  return null;
}

function normEquipment(raw) {
  const s = cellText(raw).toLowerCase().replace(/[_#]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  if (s === 'all / shared' || s === 'all/shared') return { name: SHARED, type: 'Shared' };
  const m = s.match(/^(pac?ker|pkr|pk|palle?ti[sz]er|pal|plt)\s*[-.]?\s*(?:no\.?\s*)?(\d)$/);
  if (m) {
    const isPacker = /^(pac?ker|pkr|pk)$/.test(m[1]);
    const name = (isPacker ? 'Packer ' : 'Palletizer ') + m[2];
    if (MACHINES.includes(name)) return { name, type: isPacker ? 'Packer' : 'Palletizer' };
  }
  if (/all\s*(equipment|machine|packer|palleti[sz]er|stop)|^all$|^both$|pac?ker\s*(and|&|\/)\s*palle?ti[sz]er|palle?ti[sz]er\s*(and|&|\/)\s*pac?ker|pac?ker\s*&\s*pal\b/.test(s)) {
    return { name: SHARED, type: 'Shared' };
  }
  return { name: titleCase(s), type: 'Unknown' };
}

const TITLE_RE = /DAILY\s+START\s+STOP\s+PACKER\s*\/\s*PALLETI[SZ]ER\s+RECORD/i;
const HEADER_MATCH = {
  stop: /^stop\s*time\b/i,
  start: /^start\s*time\b/i,
  dt: /^d\.?\s*t\b|^downtime/i,
  equipment: /^equi?p?m|^machine/i,
  reason: /^reason/i,
  cause: /burst|bag\s*cause/i,
  remarks: /^remark/i,
};

function findColumns(row) {
  const col = {};
  const used = new Set();
  for (const k of Object.keys(HEADER_MATCH)) {
    const i = row.findIndex(c => HEADER_MATCH[k].test(cellText(c)));
    if (i >= 0) { col[k] = i; used.add(i); } else col[k] = null;
  }
  // Offset fallbacks relative to the first time column (handles both A..G and B..G sheets)
  const timeCols = [col.stop, col.start].filter(x => x != null);
  const base = timeCols.length ? Math.min(...timeCols) : 0;
  const reqFallback = { stop: 0, start: 1, dt: 2, equipment: 3, reason: 4 };
  for (const [k, off] of Object.entries(reqFallback)) {
    if (col[k] == null && !used.has(base + off)) {
      col[k] = base + off;
      used.add(base + off);
    }
  }
  // Optional columns (cause, remarks): do NOT blindly assign if absent (6-col Aug/Sep format!)
  return col;
}

function monthFromFileName(name) {
  const up = name.toUpperCase();
  const idx = MONTHS.findIndex(m => up.includes(m.toUpperCase()));
  if (idx >= 0) return idx + 1;
  const i3 = MONTHS.findIndex(m => new RegExp('(^|[^A-Z])' + m.slice(0, 3).toUpperCase() + '([^A-Z]|$)').test(up));
  return i3 >= 0 ? i3 + 1 : null;
}

function parseWorkbook(wb, fileName) {
  const records = [], sheetIssues = [], sheetsRead = [], blocksFound = [];
  const daySheets = wb.SheetNames.filter(n => /^\s*\d{1,2}\s*$/.test(n) && +n >= 1 && +n <= 31);
  const ignored = wb.SheetNames.filter(n => !daySheets.includes(n));
  const dateVotes = new Map();
  let hasCauseCol = false;
  let skippedNoiseRows = 0;
  const sheetIssue = (sev, type, sheet, row, block, detail) => sheetIssues.push({ sev, type, sheet, row, block, detail });

  for (const sn of daySheets) {
    const day = +sn.trim();
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, defval: null, blankrows: true });
    const headers = [];
    rows.forEach((r, i) => {
      if (r && r.some(c => /^stop\s*time\b/i.test(cellText(c)))) headers.push(i);
    });
    if (!headers.length) {
      sheetIssue('warn', 'No block found', sn, null, '', 'No "Stop Time" header row on this sheet');
      continue;
    }
    sheetsRead.push(sn);

    headers.forEach((h, bi) => {
      const col = findColumns(rows[h]);
      if (col.cause != null) hasCauseCol = true;
      const reversedTimes = col.start != null && col.stop != null && col.start < col.stop;
      const floor = bi > 0 ? headers[bi - 1] + 1 : 0;
      let block = '', dateCell = null, dateFound = false;
      for (let i = h - 1; i >= Math.max(floor, h - 8); i--) {
        const r = rows[i] || [];
        if (!dateFound) {
          const di = r.findIndex(c => /^date\s*:?$/i.test(cellText(c)));
          if (di >= 0) {
            dateFound = true;
            dateCell = r[di + 1] != null && cellText(r[di + 1]) !== ''
              ? r[di + 1]
              : (r[5] != null && di < 5 ? r[5] : r.slice(di + 1).find(c => cellText(c) !== ''));
          }
        }
        if (!block && r.some(c => TITLE_RE.test(cellText(c)))) {
          block = cellText(r[5]) && !TITLE_RE.test(r[5]) ? cellText(r[5])
            : (r.map(cellText).find(t => t && !TITLE_RE.test(t) && /packer|palleti/i.test(t)) || '');
        }
      }
      if (!block) block = `Block ${bi + 1}`;
      blocksFound.push({ sheet: sn, block, headerRow: h + 1, reversedTimes });

      const date = parseDateCell(dateCell);
      if (date) {
        const k = date.y + '-' + date.m; dateVotes.set(k, (dateVotes.get(k) || 0) + 1);
      }
      const blockMachine = normEquipment(block);

      const end = bi + 1 < headers.length ? headers[bi + 1] : rows.length;
      let blockRecCount = 0;

      for (let i = h + 1; i < end; i++) {
        const r = rows[i] || [];
        if (r.some(c => TITLE_RE.test(cellText(c)))) break;
        const get = k => (col[k] != null ? r[col[k]] : null);
        const vals = ['stop', 'start', 'dt', 'equipment', 'reason', 'cause', 'remarks'].map(k => cellText(get(k)));
        if (vals.every(v => !v)) continue;
        if (/^(total|jumlah|prepared|checked|verified|signature|approved)/i.test(vals[0]) || /^(total|jumlah)/i.test(vals[3])) continue;
        if (/^date\s*:?$/i.test(vals[3]) || /^date\s*:?$/i.test(vals[4])) continue;

        const st = parseTime(get('stop'));
        const sa = parseTime(get('start'));
        const dt = parseDT(get('dt'));

        // Skip phantom empty template rows (e.g. pre-filled DT=0 / #VALUE! formula, or stray 0 in one time cell with no equipment/reason/remarks)
        const noMeta = !vals[3] && !vals[4] && !vals[5] && !vals[6];
        if (noMeta) {
          const bothTimesEmpty = st.empty && sa.empty;
          const strayZeroOnly = ((st.empty && sa.min === 0) || (sa.empty && st.min === 0)) && (dt.empty || dt.min === 0);
          if (bothTimesEmpty || strayZeroOnly) {
            skippedNoiseRows++;
            continue;
          }
        }

        // If one time is missing and DT is a formula 0 (common =Start-Stop formula artifact), treat DT=0 as empty so we don't fake 0-min valid row
        const dtEffective = (dt.min === 0 && (st.empty || sa.empty) && (vals[3] || vals[4]))
          ? { empty: true, phantomZero: true }
          : dt;

        const excelRow = i + 1;
        blockRecCount++;
        records.push({
          id: records.length,
          day, sheet: sn, row: excelRow, block, reversedTimes,
          date: date ? `${String(date.d).padStart(2, '0')}/${String(date.m).padStart(2, '0')}/${date.y}` : '',
          stopRaw: vals[0], startRaw: vals[1], dtRaw: vals[2],
          equipmentRaw: vals[3], reason: vals[4].replace(/\s+/g, ' '), causeRaw: vals[5], remarks: vals[6],
          stopParsed: st, startParsed: sa, dtParsed: dtEffective,
          blockMachine,
        });
      }

      // Only flag missing/mismatched block dates when the block actually has records (avoids 60 false issues on partial months!)
      if (blockRecCount > 0) {
        if (date) {
          if (date.d !== day) sheetIssue('info', 'Date differs from sheet', sn, null, block, `Block date is ${date.d}/${date.m}/${date.y} but sheet is "${sn}"`);
        } else {
          sheetIssue('info', 'Block date missing', sn, null, block, dateCell == null ? 'No date next to "Date:"' : `Could not read date "${cellText(dateCell)}"`);
        }
      }
    });
  }

  // Month / year detection
  let y = null, m = null, best = 0;
  for (const [k, n] of dateVotes) if (n > best) { best = n; [y, m] = k.split('-').map(Number); }
  const fileMonth = monthFromFileName(fileName);
  if (fileMonth && m && fileMonth !== m) {
    sheetIssues.push({ sev: 'info', type: 'Month mismatch', sheet: '', row: null, block: '', detail: `File name says ${MONTHS[fileMonth - 1]} but sheet dates say ${MONTHS[m - 1]} ${y}; used the sheet dates` });
  }
  if (!m) m = fileMonth;
  const label = m ? `${MONTHS[m - 1]}${y ? ' ' + y : ''}` : fileName.replace(/\.[^.]+$/, '');
  const daysInMonth = m && y ? new Date(y, m, 0).getDate() : 31;
  const activeDays = [...new Set(records.map(r => r.day))].sort((a, b) => a - b);

  return {
    key: label, label, monthName: m ? MONTHS[m - 1] : label, year: y, month: m, daysInMonth,
    activeDayMin: activeDays[0] || null, activeDayMax: activeDays[activeDays.length - 1] || null,
    activeDaysCount: activeDays.length,
    hasCauseCol, skippedNoiseRows,
    fileName, daySheets, sheetsRead, ignored, blocksFound, records,
    issues: sheetIssues, // sheet/block-level issues; row issues are computed live in analyze()
  };
}

// ---------------------------------------------------------------- analysis (live with in-app fixes)
function analyze(month) {
  if (!month) return null;
  const liveIssues = month.issues.map(i => ({ ...i }));
  const addIssue = (sev, type, rec, detail, extra = {}) => {
    const obj = { sev, type, sheet: rec.sheet, row: rec.row, block: rec.block, detail, recId: rec.id, ...extra };
    liveIssues.push(obj);
    rec.issues.push(obj);
  };

  let fixedRows = 0;
  let excludedRows = 0;

  const recs = month.records.map(raw => {
    const fk = fixKey(month.fileName, raw.sheet, raw.row);
    const fix = state.rowFixes[fk] || null;
    const hasFix = fix && Object.keys(fix).length > 0;
    const excluded = Boolean(fix && fix.excluded);
    if (excluded) excludedRows++;
    else if (hasFix) fixedRows++;

    const rec = {
      ...raw,
      fk, fix, fixed: hasFix && !excluded, excluded,
      stop: null, start: null, dt: null, dtSource: '', calc: null,
      equipment: '', type: '', group: UNCLASSIFIED, category: UNCLASSIFIED, via: 'none',
      cause: '', issues: [],
    };

    // Times
    const st = fix && fix.stop != null ? { min: fix.stop, fixed: true } : raw.stopParsed;
    const sa = fix && fix.start != null ? { min: fix.start, fixed: true } : raw.startParsed;
    rec.stop = st.min ?? null;
    rec.start = sa.min ?? null;

    const elapsed = (rec.stop != null && rec.start != null)
      ? (raw.reversedTimes ? ((rec.stop - rec.start + 1440) % 1440) : ((rec.start - rec.stop + 1440) % 1440))
      : null;
    rec.calc = elapsed;

    // DT resolution
    const dt = raw.dtParsed;
    if (fix && fix.dt != null) {
      rec.dt = fix.dt;
      rec.dtSource = 'Fixed in app';
    } else if (fix && fix.useCalcDt && elapsed != null) {
      rec.dt = elapsed;
      rec.dtSource = raw.reversedTimes ? 'Stop − Start (chosen)' : 'Start − Stop (chosen)';
    } else if (fix && (fix.stop != null || fix.start != null) && elapsed != null) {
      rec.dt = elapsed;
      rec.dtSource = 'Fixed times';
    } else if (dt.min != null) {
      rec.dt = dt.min;
      rec.dtSource = 'DT column';
    } else if (elapsed != null) {
      rec.dt = elapsed;
      rec.dtSource = raw.reversedTimes ? 'Stop − Start' : 'Start − Stop';
    } else {
      rec.dt = null;
      rec.dtSource = 'Missing';
    }

    // Equipment resolution
    let eq = null;
    let eqVia = 'file';
    if (fix && fix.equipment) {
      eq = normEquipment(fix.equipment);
      eqVia = 'fix';
    } else {
      eq = normEquipment(raw.equipmentRaw);
      if (eq && eq.type === 'Unknown') {
        const mapped = state.eqMap[normKey(raw.equipmentRaw)];
        if (mapped) { eq = normEquipment(mapped); eqVia = 'eqMap'; }
      }
      if (!eq) {
        if (raw.blockMachine && raw.blockMachine.type !== 'Unknown') {
          eq = raw.blockMachine; eqVia = 'block';
        } else {
          eq = { name: '(Missing)', type: 'Unknown' }; eqVia = 'missing';
        }
      }
    }
    rec.equipment = eq.name;
    rec.type = eq.type;
    rec.eqVia = eqVia;

    // Reason & Classification
    rec.reason = (fix && fix.reason != null ? fix.reason : raw.reason);
    if (fix && fix.group) {
      rec.group = fix.group;
      rec.category = categoryOf(fix.group);
      rec.via = 'fix';
    } else {
      const c = classify(rec.reason);
      rec.group = c.group;
      rec.category = c.category;
      rec.via = c.via;
    }

    // Burst Bag Cause
    rec.cause = fix && fix.cause != null ? normCause(fix.cause) : normCause(raw.causeRaw);

    if (excluded) return rec;

    // Live row-level issue evaluation
    if (!st.fixed) {
      if (st.fixes && st.fixes.length) addIssue('info', 'Time typo auto-fixed', rec, `Stop Time "${st.raw}" → ${clock(st.min)} (${st.fixes.join(', ')})`);
      if (st.error) addIssue('warn', 'Unreadable time', rec, `Stop Time "${st.raw}" could not be read`);
    }
    if (!sa.fixed) {
      if (sa.fixes && sa.fixes.length) addIssue('info', 'Time typo auto-fixed', rec, `Start Time "${sa.raw}" → ${clock(sa.min)} (${sa.fixes.join(', ')})`);
      if (sa.error) addIssue('warn', 'Unreadable time', rec, `Start Time "${sa.raw}" could not be read`);
    }

    if (rec.dtSource === 'DT column') {
      if (dt.fixes && dt.fixes.length) addIssue('info', 'Time typo auto-fixed', rec, `DT "${raw.dtRaw}" → ${fmt(dt.min)} min (${dt.fixes.join(', ')})`);
      if (dt.note) addIssue('info', 'DT format', rec, `${dt.note}: "${raw.dtRaw}"`);
      if (elapsed != null && Math.abs(elapsed - dt.min) > 1.01 && Math.abs(elapsed - dt.min) < 1439) {
        const diffLabel = raw.reversedTimes ? 'Stop − Start' : 'Start − Stop';
        addIssue('info', 'DT differs from Start − Stop', rec, `DT column ${fmt(dt.min)} min, ${diffLabel} = ${fmt(elapsed)} min (DT column used)`, { dtCol: dt.min, calcMin: elapsed, diffLabel });
      }
    } else if (rec.dtSource === 'Start − Stop' || rec.dtSource === 'Stop − Start') {
      if (dt.error) {
        const msg = dt.negative ? `DT formula was negative ("${dt.raw}"); used ${rec.dtSource} = ${fmt(elapsed)} min`
          : `DT "${dt.raw}" unreadable; used ${rec.dtSource} = ${fmt(elapsed)} min`;
        addIssue('info', 'DT unreadable — calculated', rec, msg);
      }
    } else if (rec.dt == null) {
      addIssue('error', 'Downtime missing', rec, 'No DT value and Stop/Start times are incomplete — row excluded from totals');
    }

    if (rec.dt != null && rec.dt > 720 && !(fix && fix.ackLong)) {
      addIssue('warn', 'Very long stop', rec, `${fmt(rec.dt)} min (over 12 h) — please check`);
    }

    if (eqVia === 'block') {
      addIssue('warn', 'Equipment missing', rec, `No equipment — used block name "${raw.block}"`);
    } else if (eqVia === 'missing') {
      addIssue('warn', 'Equipment missing', rec, 'No equipment — not counted in per-machine charts');
    } else if (rec.type === 'Unknown') {
      addIssue('warn', 'Unknown equipment', rec, `"${raw.equipmentRaw}" is not Packer 1–4, Palletizer 1–2 or All / Shared`, { eqKey: normKey(raw.equipmentRaw), eqRaw: raw.equipmentRaw });
    }

    if (!rec.reason && !(fix && fix.group)) {
      addIssue('warn', 'Reason missing', rec, 'Reason column is empty');
    }

    if (month.hasCauseCol && rec.dt != null && rec.group === BURST_GROUP && !rec.cause) {
      addIssue('info', 'Burst bag cause missing', rec, `Burst/Stuck Bag stop (${rec.equipment}, ${fmt(rec.dt)} min) has no Burst Bag Cause`);
    }

    return rec;
  });

  const active = recs.filter(r => !r.excluded);
  const valid = active.filter(r => r.dt != null);
  const unpl = valid.filter(r => r.category === 'Unplanned');
  const total = sum(unpl, r => r.dt);
  const planned = sum(valid.filter(r => r.category === 'Planned'), r => r.dt);
  const unclassMin = sum(valid.filter(r => r.category === UNCLASSIFIED), r => r.dt);

  const machine = {};
  for (const name of MACHINES) {
    const all = active.filter(r => r.equipment === name);
    const u = unpl.filter(r => r.equipment === name);
    machine[name] = { name, records: all.length, min: sum(u, r => r.dt), count: u.length };
  }
  const palTotal = sum(PALLETIZERS, n => machine[n].min);
  const pakTotal = sum(PACKERS, n => machine[n].min);
  const sharedMin = sum(unpl.filter(r => r.type === 'Shared'), r => r.dt);
  const unknownMin = sum(unpl.filter(r => r.type === 'Unknown'), r => r.dt);

  const topReasons = type => {
    const list = unpl.filter(r => r.type === type);
    const tot = sum(list, r => r.dt);
    const by = new Map();
    for (const r of list) {
      const o = by.get(r.group) || { group: r.group, min: 0, count: 0, texts: new Map() };
      o.min += r.dt; o.count++; o.texts.set(r.reason, (o.texts.get(r.reason) || 0) + r.dt);
      by.set(r.group, o);
    }
    return { total: tot, rows: [...by.values()].sort((a, b) => b.min - a.min).slice(0, 5) };
  };

  // Burst bag: Burst/Stuck Bag group, plus any unplanned row with a Burst Bag Cause filled in.
  const burst = valid.filter(r => r.group === BURST_GROUP || (r.cause && r.category !== 'Planned'));
  const burstTotal = sum(burst, r => r.dt);
  const pareto = list => {
    const by = new Map();
    for (const r of list) {
      const k = r.cause || '(Not specified)';
      const o = by.get(k) || { cause: k, min: 0, count: 0 };
      o.min += r.dt; o.count++; by.set(k, o);
    }
    const rows = [...by.values()].sort((a, b) => b.min - a.min || b.count - a.count);
    const tot = sum(rows, r => r.min);
    let cum = 0;
    for (const r of rows) { const before = cum; cum += r.min; r.cumPct = pct(cum, tot); r.vital = pct(before, tot) < 80; r.pct = pct(r.min, tot); }
    return { rows, total: tot };
  };
  const burstPareto = pareto(burst);
  const burstPalPareto = pareto(burst.filter(r => r.type === 'Palletizer'));
  const burstPakPareto = pareto(burst.filter(r => r.type === 'Packer'));
  const similarCauses = findSimilarCauses(burstPareto.rows);
  for (const sc of similarCauses) {
    liveIssues.push({
      sev: 'info', type: 'Similar burst bag causes', sheet: '', row: null, block: '',
      detail: `"${sc.from}" (${sc.fromCount} rows, ${fmt(sc.fromMin)} min) looks like "${sc.to}" (${sc.toCount} rows, ${fmt(sc.toMin)} min)`,
      similar: sc,
    });
  }

  const weeks = [1, 2, 3, 4, 5].map(w => {
    const from = (w - 1) * 7 + 1, to = w === 5 ? month.daysInMonth : w * 7;
    const list = burst.filter(r => Math.min(5, Math.ceil(r.day / 7)) === w);
    return {
      week: w, from, to: Math.max(from, to), days: Math.max(0, to - from + 1),
      pal: sum(list.filter(r => r.type === 'Palletizer'), r => r.dt),
      pak: sum(list.filter(r => r.type === 'Packer'), r => r.dt),
      other: sum(list.filter(r => r.type !== 'Palletizer' && r.type !== 'Packer'), r => r.dt),
      count: list.length,
    };
  });
  const causeByMachine = burstPareto.rows.map(p => ({
    cause: p.cause,
    cells: [...MACHINES, SHARED].map(n => sum(burst.filter(r => (r.cause || '(Not specified)') === p.cause && r.equipment === n), r => r.dt)),
    total: p.min,
  }));

  // Unclassified reasons (unique texts)
  const unclassified = new Map();
  for (const r of active.filter(r => r.category === UNCLASSIFIED)) {
    const k = normKey(r.reason) || '(empty)';
    const o = unclassified.get(k) || { key: k, text: r.reason || '(empty reason)', count: 0, min: 0, empty: !r.reason, machines: new Set(), remarks: new Set() };
    o.count++; o.min += r.dt || 0;
    if (r.equipment) o.machines.add(r.equipment);
    if (r.remarks) o.remarks.add(r.remarks);
    unclassified.set(k, o);
  }
  const unclassList = [...unclassified.values()].sort((a, b) => b.min - a.min);
  const unclassUnique = unclassList.filter(u => !u.empty).length;
  const unclassRows = active.filter(r => r.category === UNCLASSIFIED && r.reason).length;
  const parseReview = liveIssues.filter(i => i.sev !== 'info').length;
  const autoFixed = liveIssues.filter(i => i.type === 'Time typo auto-fixed' || i.type === 'DT unreadable — calculated').length;

  // Clean rows: active rows with zero error/warn issues and classified
  const cleanRows = active.filter(r => r.category !== UNCLASSIFIED && !r.issues.some(i => i.sev !== 'info')).length;
  const missingDtRows = active.filter(r => r.dt == null).length;

  // Known burst bag causes (for inline dropdown suggestions)
  const knownCauses = [...new Set(burstPareto.rows.map(r => r.cause).filter(c => c && c !== '(Not specified)'))];

  const ranked = MACHINES.map(n => machine[n]).filter(x => x.min > 0).sort((a, b) => b.min - a.min);
  return {
    month, recs, active, valid, unpl, total, planned, unclassMin, machine, palTotal, pakTotal, sharedMin, unknownMin,
    topPal: topReasons('Palletizer'), topPak: topReasons('Packer'),
    burst, burstTotal, burstPareto, burstPalPareto, burstPakPareto, weeks, causeByMachine, knownCauses, similarCauses,
    liveIssues, unclassList, unclassUnique, unclassRows, needsReview: parseReview + unclassRows,
    autoFixed, fixedRows, excludedRows, cleanRows, missingDtRows,
    top: ranked[0] || null,
  };
}

// ---------------------------------------------------------------- charts (SVG)
function niceMax(v) {
  if (v <= 0) return 10;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}
const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

function paretoSVG(p) {
  const rows = p.rows;
  if (!rows.length) return '<p class="nodata">No burst/stuck bag records this month.</p>';
  const W = 760, H = 340, L = 52, R = 48, T = 22;
  const rotate = rows.length > 5;
  const B = rotate ? 96 : 52;
  const iw = W - L - R, ih = H - T - B;
  const max = niceMax(rows[0].min);
  const bw = iw / rows.length;
  const y = v => T + ih - (v / max) * ih;
  const yp = v => T + ih - (v / 100) * ih;
  let g = '';
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i, yy = y(v);
    g += `<line class="grid-line" x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}"/>`;
    g += `<text x="${L - 8}" y="${yy + 4}" text-anchor="end">${fmt(v)}</text>`;
    g += `<text x="${W - R + 8}" y="${yp(25 * i) + 4}">${25 * i}%</text>`;
  }
  g += `<line class="ref80" x1="${L}" x2="${W - R}" y1="${yp(80)}" y2="${yp(80)}"/>`;
  g += `<text class="ref80-label" x="${W - R - 4}" y="${yp(80) - 5}" text-anchor="end">80%</text>`;
  let pts = [];
  rows.forEach((r, i) => {
    const x = L + i * bw, w = Math.max(4, bw * 0.68), cx = x + bw / 2;
    const yy = y(r.min);
    g += `<rect x="${cx - w / 2}" y="${yy}" width="${w}" height="${T + ih - yy}" rx="2" fill="var(${r.vital ? '--hi' : '--lo'})"><title>${esc(r.cause)}: ${fmt(r.min)} min, ${r.count} times, cumulative ${fmtPct(r.cumPct)}</title></rect>`;
    g += `<text class="val-label" x="${cx}" y="${yy - 14}" text-anchor="middle">${fmt(r.min)}</text>`;
    g += `<text x="${cx}" y="${yy - 3}" text-anchor="middle">×${r.count}</text>`;
    const lbl = esc(trunc(r.cause, rotate ? 18 : 14));
    g += rotate
      ? `<text x="${cx}" y="${T + ih + 12}" text-anchor="end" transform="rotate(-35 ${cx} ${T + ih + 12})">${lbl}</text>`
      : `<text x="${cx}" y="${T + ih + 16}" text-anchor="middle">${lbl}</text>`;
    pts.push([cx, yp(r.cumPct), r.cumPct]);
  });
  g += `<polyline class="cum" points="${pts.map(p => p[0] + ',' + p[1]).join(' ')}"/>`;
  pts.forEach(([x, yy, v]) => { g += `<circle class="cum-dot" cx="${x}" cy="${yy}" r="3.5"><title>Cumulative ${fmtPct(v)}</title></circle>`; });
  g += `<line class="axis" x1="${L}" x2="${W - R}" y1="${T + ih}" y2="${T + ih}"/>`;
  g += `<text x="${L - 8}" y="${T - 8}" text-anchor="end">min</text><text x="${W - R + 8}" y="${T - 8}">cum %</text>`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Pareto chart of burst bag causes">${g}</svg>`;
}

function weeklySVG(weeks) {
  const W = 760, H = 280, L = 52, R = 16, T = 22, B = 46;
  const iw = W - L - R, ih = H - T - B;
  const max = niceMax(Math.max(...weeks.map(w => w.pal + w.pak + w.other), 1));
  const y = v => T + ih - (v / max) * ih;
  const gw = iw / weeks.length;
  let g = '';
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i, yy = y(v);
    g += `<line class="grid-line" x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}"/><text x="${L - 8}" y="${yy + 4}" text-anchor="end">${fmt(v)}</text>`;
  }
  weeks.forEach((w, i) => {
    const cx = L + i * gw + gw / 2, bw = Math.min(46, gw * 0.3);
    const bars = [['pal', '--pal', 'Palletizers'], ['pak', '--pak', 'Packers']];
    bars.forEach(([k, color, label], j) => {
      const x = cx + (j === 0 ? -bw - 3 : 3), v = w[k], yy = y(v);
      g += `<rect x="${x}" y="${yy}" width="${bw}" height="${T + ih - yy}" rx="2" fill="var(${color})"><title>Week ${w.week} ${label}: ${fmt(v)} min</title></rect>`;
      if (v > 0) g += `<text class="val-label" x="${x + bw / 2}" y="${yy - 4}" text-anchor="middle">${fmt(v)}</text>`;
    });
    g += `<text x="${cx}" y="${T + ih + 16}" text-anchor="middle" class="val-label">Week ${w.week}</text>`;
    g += `<text x="${cx}" y="${T + ih + 31}" text-anchor="middle">Days ${w.from}–${w.to}</text>`;
  });
  g += `<line class="axis" x1="${L}" x2="${W - R}" y1="${T + ih}" y2="${T + ih}"/><text x="${L - 8}" y="${T - 8}" text-anchor="end">min</text>`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Weekly burst bag downtime">${g}</svg>`;
}

const ICONS = {
  clock: '<path d="M12 7v5l3 3"/><circle cx="12" cy="12" r="9"/>',
  pallet: '<path d="M3 17h18M5 17v3M12 17v3M19 17v3"/><rect x="5" y="10" width="6" height="7" rx="1"/><rect x="13" y="10" width="6" height="7" rx="1"/><rect x="9" y="3" width="6" height="7" rx="1"/>',
  bag: '<path d="M7 4h10l2 5v10a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V9l2-5Z"/><path d="M5 9h14M10 13h4"/>',
  alert: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  burst: '<path d="M12 3c1 3 4 4.5 4 8.5a4 4 0 0 1-8 0c0-1.5.7-2.7 1.5-3.5.3 1.5 1 2.5 2 3 0-3 .5-5.5.5-8Z"/><path d="M6 21h12"/>',
  trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4Z"/><path d="M17 6h3a3 3 0 0 1-3 4M7 6H4a3 3 0 0 0 3 4"/>',
  wrench: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4l-5.6 5.6a2 2 0 1 0 2.8 2.8l5.6-5.6a4 4 0 0 0 5.4-5.4l-2.1 2.1-2.8-2.8 2.1-2.1Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/>',
};
const icon = n => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n]}</svg>`;

function hbarRow(name, min, total, isTop, hasData, extra = '', drillAttrs = '') {
  if (!hasData) {
    return `<div class="bar-row nodata-row"><span class="name">${esc(name)}</span><div class="bar-track"></div><span class="val nodata">No data</span></div>`;
  }
  const p = pct(min, total);
  const cls = `bar-row${isTop ? ' is-top' : ''}${drillAttrs ? ' clickable' : ''}`;
  return `<div class="${cls}" ${drillAttrs} title="${esc(name)}: ${fmt(min)} min (${fmtPct(p)})${extra}${drillAttrs ? '\nClick to inspect stops' : ''}">
    <span class="name">${esc(name)}</span>
    <div class="bar-track"><div class="bar-fill${isTop ? ' top' : ''}" style="width:${p.toFixed(2)}%"></div></div>
    <span class="val">${fmt(min)} min<span class="p">${fmtPct(p)}</span></span></div>`;
}

function dateRangeLabel(m) {
  if (!m.activeDayMin || !m.activeDayMax) return '';
  if (m.activeDayMin === 1 && m.activeDayMax >= m.daysInMonth - 1) return '';
  return ` · Days ${m.activeDayMin}–${m.activeDayMax}`;
}

// ---------------------------------------------------------------- drill-down dialog
function openDrill(title, subtitle, rows) {
  const dlg = $('#drillDialog');
  if (!dlg) return;
  $('#drillTitle').textContent = title;
  $('#drillSub').textContent = subtitle;
  const sorted = rows.slice().sort((a, b) => a.day - b.day || (a.stop || 0) - (b.stop || 0));
  $('#drillBody').innerHTML = sorted.length
    ? `<div class="table-wrap"><table><thead><tr><th class="num">Day</th><th class="num">Row</th><th>Stop</th><th>Start</th><th class="num">DT min</th><th>Equipment</th><th>Reason</th><th>Group</th><th>Remarks</th></tr></thead><tbody>
      ${sorted.map(r => `<tr><td class="num">${r.day}</td><td class="num">${r.row}</td><td class="mono">${clock(r.stop)}</td><td class="mono">${clock(r.start)}</td>
        <td class="num"><b>${fmt(r.dt)}</b></td><td class="nowrap">${esc(r.equipment)}</td><td>${esc(r.reason)}</td><td>${esc(r.group)}</td><td>${esc(r.remarks)}</td></tr>`).join('')}
      </tbody></table></div>`
    : '<p class="nodata">No matching stops.</p>';
  if (typeof dlg.showModal === 'function') dlg.showModal();
}

// ---------------------------------------------------------------- render: report
function renderReport(a) {
  const el = $('#tab-report');
  if (!a) { el.innerHTML = ''; return; }
  const m = a.month;
  const headline = a.top
    ? `${a.top.name} caused the most downtime in ${m.monthName}`
    : `No unplanned downtime recorded in ${m.monthName}`;
  const machineMax = a.top ? `${fmt(a.top.min)} min of unplanned stops (${fmtPct(pct(a.top.min, a.top.name.startsWith('Packer') ? a.pakTotal : a.palTotal))} of all ${a.top.name.startsWith('Packer') ? 'packer' : 'palletizer'} downtime).` : '';
  const reviewCls = a.needsReview ? '' : ' clean';
  const isTopOf = (group, n) => {
    const best = Math.max(...group.map(x => a.machine[x].min));
    return best > 0 && a.machine[n].min === best;
  };

  const topTable = (t, type) => {
    if (!t.rows.length) return '<p class="nodata">No unplanned downtime.</p>';
    return `<div class="bars reasons">${t.rows.map((r, i) => {
      const examples = [...r.texts.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3).map(x => x[0]).join(' · ');
      return hbarRow(
        `${i + 1}. ${r.group}`, r.min, t.total, i === 0, true,
        `\n${r.count} stops\nExamples: ${examples}`,
        `data-drill-reason="${esc(r.group)}" data-drill-type="${esc(type)}"`
      );
    }).join('')}</div>`;
  };

  el.innerHTML = `
    <div class="page-head">
      <div class="eyebrow">Monthly report · ${esc(m.label)}${esc(dateRangeLabel(m))}${a.fixedRows || a.excludedRows ? ` · ${a.fixedRows + a.excludedRows} in-app fix${a.fixedRows + a.excludedRows === 1 ? '' : 'es'}` : ''}</div>
      <h1>${esc(headline)}</h1>
      <p class="lede">${machineMax} Charts and top reasons use unplanned downtime only. Click any bar to inspect its stops.</p>
    </div>
    <div class="grid kpis">
      <div class="card kpi total"><div class="label">${icon('clock')}Total unplanned downtime</div>
        <div class="value">${fmt(a.total)}<small>min</small></div>
        <div class="note">${fmtH(a.total)} h · ${a.unpl.length} stops${a.sharedMin ? ` · incl. ${fmt(a.sharedMin)} min All / Shared` : ''}<br>Planned ${fmt(a.planned)} min${a.unclassMin ? ` · Unclassified ${fmt(a.unclassMin)} min (not counted)` : ''}</div></div>
      <div class="card kpi pal"><div class="label">${icon('pallet')}Palletizers total</div>
        <div class="value">${fmt(a.palTotal)}<small>min</small></div>
        <div class="note">${fmtH(a.palTotal)} h · ${fmtPct(pct(a.palTotal, a.total))} of total</div></div>
      <div class="card kpi pak"><div class="label">${icon('bag')}Packers total</div>
        <div class="value">${fmt(a.pakTotal)}<small>min</small></div>
        <div class="note">${fmtH(a.pakTotal)} h · ${fmtPct(pct(a.pakTotal, a.total))} of total</div></div>
      <button class="card kpi review${reviewCls}" type="button" data-goto="quality"><div class="label">${icon(a.needsReview ? 'alert' : 'check')}Needs review</div>
        <div class="value">${fmt(a.needsReview)}<small>issues</small></div>
        <div class="note">${a.needsReview ? 'Open Data Quality →' : 'All rows look fine'}${a.autoFixed ? ` · ${a.autoFixed} auto-fixed` : ''}</div></button>
    </div>

    <div class="card">
      <div class="card-head"><h2>Unplanned downtime by machine</h2><span class="sub">Palletizers and packers each add up to 100%</span></div>
      <div class="bar-group">
        <div class="bar-group-title"><span>Palletizers</span><span>${fmt(a.palTotal)} min</span></div>
        <div class="bars">${PALLETIZERS.map(n => hbarRow(n, a.machine[n].min, a.palTotal, isTopOf(PALLETIZERS, n), a.machine[n].records > 0, `\n${a.machine[n].count} unplanned stops`, a.machine[n].count > 0 ? `data-drill-machine="${esc(n)}"` : '')).join('')}</div>
      </div>
      <div class="bar-group">
        <div class="bar-group-title"><span>Packers</span><span>${fmt(a.pakTotal)} min</span></div>
        <div class="bars">${PACKERS.map(n => hbarRow(n, a.machine[n].min, a.pakTotal, isTopOf(PACKERS, n), a.machine[n].records > 0, `\n${a.machine[n].count} unplanned stops`, a.machine[n].count > 0 ? `data-drill-machine="${esc(n)}"` : '')).join('')}</div>
      </div>
      ${a.sharedMin || a.unknownMin ? `<div class="note-box">Not in this chart: ${a.sharedMin ? `${fmt(a.sharedMin)} min All / Shared (all equipment stopped, packer and palletizer)` : ''}${a.sharedMin && a.unknownMin ? ' · ' : ''}${a.unknownMin ? `${fmt(a.unknownMin)} min with unknown equipment` : ''}.</div>` : ''}
    </div>

    <div class="grid two" style="margin-top:14px">
      <div class="card"><div class="card-head"><h2>Top 5 unplanned reasons — Palletizers</h2><span class="sub">% of ${fmt(a.topPal.total)} min</span></div>${topTable(a.topPal, 'Palletizer')}</div>
      <div class="card"><div class="card-head"><h2>Top 5 unplanned reasons — Packers</h2><span class="sub">% of ${fmt(a.topPak.total)} min</span></div>${topTable(a.topPak, 'Packer')}</div>
    </div>
    <p class="print-only fineprint">Source: ${esc(m.fileName)} · ${m.sheetsRead.length} day sheets · ${a.active.length} active records · generated ${new Date().toLocaleString('en-GB')}</p>`;

  $$('[data-drill-machine]', el).forEach(row => row.onclick = () => {
    const eq = row.dataset.drillMachine;
    const list = a.unpl.filter(r => r.equipment === eq);
    openDrill(`${eq} — Unplanned stops`, `${list.length} stops · ${fmt(sum(list, r => r.dt))} min (${fmtH(sum(list, r => r.dt))} h)`, list);
  });
  $$('[data-drill-reason]', el).forEach(row => row.onclick = () => {
    const grp = row.dataset.drillReason, type = row.dataset.drillType;
    const list = a.unpl.filter(r => r.group === grp && r.type === type);
    openDrill(`${grp} (${type}s)`, `${list.length} stops · ${fmt(sum(list, r => r.dt))} min`, list);
  });
}

// ---------------------------------------------------------------- render: burst bag
function renderBurst(a) {
  const el = $('#tab-burst');
  if (!a) { el.innerHTML = ''; return; }
  const m = a.month, p = a.burstPareto;
  const top = p.rows[0], topPal = a.burstPalPareto.rows[0];
  const vital = p.rows.filter(r => r.vital);
  const w5 = a.weeks[4];
  el.innerHTML = `
    <div class="page-head">
      <div class="eyebrow">Burst / stuck bag · ${esc(m.label)}${esc(dateRangeLabel(m))}</div>
      <h1>${top ? `${esc(top.cause)} is the No. 1 burst bag cause in ${esc(m.monthName)}` : `No burst bag stops in ${esc(m.monthName)}`}</h1>
      ${vital.length ? `<p class="lede">${vital.length} of ${p.rows.length} causes make up the first 80% of burst/stuck bag downtime.</p>` : ''}
      ${!m.hasCauseCol ? '<div class="note-box">This workbook uses the 6-column format (no "Burst Bag Cause" column). Burst/Stuck Bag stops are still counted from the Reason column.</div>' : ''}
    </div>
    <div class="grid kpis">
      <div class="card kpi hi"><div class="label">${icon('burst')}Burst / stuck bag downtime</div>
        <div class="value">${fmt(a.burstTotal)}<small>min</small></div>
        <div class="note">${fmtH(a.burstTotal)} h · ${a.burst.length} stops · ${fmtPct(pct(a.burstTotal, a.total))} of unplanned</div></div>
      <div class="card kpi"><div class="label">${icon('trophy')}No. 1 cause</div>
        <div class="value text">${top ? esc(top.cause) : '—'}</div>
        <div class="note">${top ? `${fmt(top.min)} min · ${top.count} times · ${fmtPct(top.pct)}` : 'No data'}</div></div>
      <div class="card kpi pal"><div class="label">${icon('pallet')}No. 1 cause at palletizers</div>
        <div class="value text">${topPal ? esc(topPal.cause) : '—'}</div>
        <div class="note">${topPal ? `${fmt(topPal.min)} min · ${topPal.count} times · ${fmtPct(topPal.pct)} of palletizer burst` : 'No data'}</div></div>
    </div>

    <div class="card">
      <div class="card-head"><h2>Pareto of burst bag cause</h2><span class="sub">Bars = minutes (×count) · line = cumulative %</span></div>
      ${paretoSVG(p)}
      <div class="legend"><span><i style="background:var(--hi)"></i>First 80% (vital few)</span><span><i style="background:var(--lo)"></i>Remaining causes</span><span><i class="line"></i>Cumulative %</span></div>
    </div>

    <div class="card">
      <div class="card-head"><h2>Weekly trend</h2><span class="sub">Burst / stuck bag minutes per week</span></div>
      ${weeklySVG(a.weeks)}
      <div class="legend"><span><i style="background:var(--pal)"></i>Palletizers</span><span><i style="background:var(--pak)"></i>Packers</span></div>
      <div class="note-box">Week 1 = days 1–7, Week 2 = 8–14, Week 3 = 15–21, Week 4 = 22–28, Week 5 = days 29–${w5.to}. Week 5 has only ${w5.days} day${w5.days === 1 ? '' : 's'}, so compare it with care.${a.weeks.some(w => w.other) ? ' All / Shared stops are not shown.' : ''}</div>
    </div>

    <div class="card">
      <div class="card-head"><h2>Cause by machine (min)</h2></div>
      ${p.rows.length ? `<div class="table-wrap"><table><thead><tr><th>Cause</th>${[...MACHINES, SHARED].map(n => `<th class="num">${esc(n)}</th>`).join('')}<th class="num">Total</th><th class="num">Cum %</th></tr></thead><tbody>
      ${a.causeByMachine.map((c, i) => `<tr><td>${p.rows[i].vital ? '<b>' + esc(c.cause) + '</b>' : esc(c.cause)}</td>${c.cells.map(v => `<td class="num">${v ? fmt(v) : '<span class="nodata">–</span>'}</td>`).join('')}<td class="num"><b>${fmt(c.total)}</b></td><td class="num">${fmtPct(p.rows[i].cumPct)}</td></tr>`).join('')}
      </tbody></table></div>` : '<p class="nodata">No data</p>'}
      <p class="help" style="margin-top:10px">Burst bag records = Reason Group "Burst/Stuck Bag", plus any unplanned row with a Burst Bag Cause filled in. Cause names are cleaned with the alias table on the Rules tab.</p>
    </div>`;
}

// ---------------------------------------------------------------- exports (Quality & Cleaned Excel)
function csvCell(v) {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}

function buildAllIssues(a) {
  const unclassIssues = a.active.filter(r => r.category === UNCLASSIFIED && r.reason).map(r => ({
    sev: 'warn', type: 'Unclassified reason', sheet: r.sheet, row: r.row, block: r.block, recId: r.id,
    detail: `"${r.reason}" (${r.equipment}, ${fmt(r.dt || 0)} min)`, key: normKey(r.reason),
  }));
  return [...a.liveIssues, ...unclassIssues];
}

function copyIssueChecklist(a) {
  const all = buildAllIssues(a).filter(i => i.sev !== 'info');
  if (!all.length) { toast('No errors or warnings to copy.'); return; }
  const byType = new Map();
  for (const i of all) {
    if (!byType.has(i.type)) byType.set(i.type, []);
    byType.get(i.type).push(i);
  }
  const lines = [
    `Start Stop Data Quality Checklist — ${a.month.label} (${a.month.fileName})`,
    `Needs action: ${all.length} issues (${a.unclassUnique ? `${a.unclassUnique} unclassified reasons, ` : ''}${a.missingDtRows} missing DT)`,
    '',
  ];
  for (const [type, items] of byType) {
    lines.push(`[${items[0].sev.toUpperCase()}] ${type} (${items.length})`);
    if (type === 'Unclassified reason') {
      for (const u of a.unclassList.filter(x => !x.empty)) {
        lines.push(`  - "${u.text}" (${u.count} rows, ${fmt(u.min)} min)`);
      }
    } else {
      const sorted = items.slice().sort((x, y) => (+x.sheet || 0) - (+y.sheet || 0) || (x.row || 0) - (y.row || 0));
      for (const i of sorted.slice(0, 60)) {
        const loc = i.sheet ? `Sheet ${i.sheet}${i.row ? ` Row ${i.row}` : ''}` : 'File';
        lines.push(`  - ${loc} [${i.block || '-'}]: ${i.detail}`);
      }
      if (sorted.length > 60) lines.push(`  ... and ${sorted.length - 60} more`);
    }
    lines.push('');
  }
  const text = lines.join('\n');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => toast('Issue checklist copied — paste into WhatsApp or Email.'))
      .catch(() => fallbackCopy(text));
  } else fallbackCopy(text);
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); toast('Issue checklist copied.'); } catch (e) { toast('Could not copy automatically.'); }
  document.body.removeChild(ta);
}

function exportIssuesCSV(a) {
  const all = buildAllIssues(a).sort((x, y) => SEV_ORDER[x.sev] - SEV_ORDER[y.sev] || (+x.sheet || 0) - (+y.sheet || 0) || (x.row || 0) - (y.row || 0));
  const recById = new Map(a.recs.map(r => [r.id, r]));
  const header = ['Severity', 'Issue Type', 'Sheet', 'Row', 'Block', 'Equipment', 'Stop', 'Start', 'DT (min)', 'Reason', 'Detail', 'What to do'];
  const rows = [header.map(csvCell).join(',')];
  for (const i of all) {
    const r = i.recId != null ? recById.get(i.recId) : null;
    rows.push([
      SEV_LABEL[i.sev] || i.sev, i.type, i.sheet || '', i.row || '', i.block || '',
      r ? r.equipment : '', r ? clock(r.stop) : '', r ? clock(r.start) : '', r && r.dt != null ? Math.round(r.dt * 10) / 10 : '',
      r ? r.reason : '', i.detail, ISSUE_HELP[i.type] || '',
    ].map(csvCell).join(','));
  }
  const safe = a.month.label.replace(/[^A-Za-z0-9_-]+/g, '_');
  downloadBlob(new Blob(['\uFEFF' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8' }), `Data_Quality_Issues_${safe}.csv`);
  toast(`Exported ${all.length} issues to CSV.`);
}

function exportCleanedExcel(a) {
  if (typeof XLSX === 'undefined') { toast('SheetJS not loaded.'); return; }
  const wb = XLSX.utils.book_new();
  const cleanRows = a.active.map(r => ({
    Day: r.day,
    Date: r.date,
    Sheet: r.sheet,
    Excel_Row: r.row,
    Block: r.block,
    Stop_Time: clock(r.stop),
    Start_Time: clock(r.start),
    DT_Min: r.dt != null ? Math.round(r.dt * 10) / 10 : null,
    DT_Source: r.dtSource,
    Equipment: r.equipment,
    Equipment_Type: r.type,
    Reason: r.reason,
    Reason_Group: r.group,
    Category: r.category,
    Burst_Bag_Cause: r.cause,
    Remarks: r.remarks,
    In_App_Fixed: r.fixed ? 'Yes' : '',
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(cleanRows), 'Cleaned_Records');

  const summary = [
    ['Metric', 'Minutes', 'Hours'],
    ['Total Unplanned Downtime', Math.round(a.total), +(a.total / 60).toFixed(2)],
    ['Palletizers Unplanned', Math.round(a.palTotal), +(a.palTotal / 60).toFixed(2)],
    ['Packers Unplanned', Math.round(a.pakTotal), +(a.pakTotal / 60).toFixed(2)],
    ['All / Shared Unplanned', Math.round(a.sharedMin), +(a.sharedMin / 60).toFixed(2)],
    ['Planned Downtime', Math.round(a.planned), +(a.planned / 60).toFixed(2)],
    ['Unclassified Downtime', Math.round(a.unclassMin), +(a.unclassMin / 60).toFixed(2)],
    ['Burst / Stuck Bag Downtime', Math.round(a.burstTotal), +(a.burstTotal / 60).toFixed(2)],
    [],
    ['Machine', 'Unplanned Min', 'Stops'],
    ...MACHINES.map(n => [n, Math.round(a.machine[n].min), a.machine[n].count]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), 'Summary');

  const rem = buildAllIssues(a).map(i => ({
    Severity: SEV_LABEL[i.sev] || i.sev,
    Type: i.type,
    Sheet: i.sheet || '',
    Row: i.row || '',
    Block: i.block || '',
    Detail: i.detail,
  }));
  if (rem.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rem), 'Remaining_Issues');

  const safe = a.month.label.replace(/[^A-Za-z0-9_-]+/g, '_');
  XLSX.writeFile(wb, `START_STOP_CLEANED_${safe}.xlsx`);
  toast('Downloaded cleaned Excel workbook.');
}

// ---------------------------------------------------------------- row fix helpers (with Undo + scroll preserve)
function applyRowFix(fk, patch, label) {
  const prev = state.rowFixes[fk] ? { ...state.rowFixes[fk] } : null;
  state.rowFixes[fk] = { ...(state.rowFixes[fk] || {}), ...patch };
  saveLS(LS.rowFixes, state.rowFixes);
  refreshKeepScroll();
  toast(label, {
    undo: () => {
      if (prev) state.rowFixes[fk] = prev; else delete state.rowFixes[fk];
      saveLS(LS.rowFixes, state.rowFixes);
      refreshKeepScroll();
      toast('Undid change.');
    },
  });
}

function clearRowFix(fk, label = 'Restored original row.') {
  const prev = state.rowFixes[fk] ? { ...state.rowFixes[fk] } : null;
  delete state.rowFixes[fk];
  saveLS(LS.rowFixes, state.rowFixes);
  refreshKeepScroll();
  toast(label, prev ? {
    undo: () => {
      state.rowFixes[fk] = prev;
      saveLS(LS.rowFixes, state.rowFixes);
      refreshKeepScroll();
    },
  } : {});
}

function refreshKeepScroll(opts = {}) {
  const y = window.scrollY;
  refresh(opts);
  requestAnimationFrame(() => window.scrollTo(0, y));
}

// ---------------------------------------------------------------- render: data quality
function groupOptions(selected, withLeave = true) {
  const opt = g => `<option value="${esc(g)}"${g === selected ? ' selected' : ''}>${esc(g)}</option>`;
  return (withLeave ? `<option value="">— pick Reason Group —</option>` : '') +
    `<optgroup label="Planned">${PLANNED_GROUPS.map(opt).join('')}</optgroup>` +
    `<optgroup label="Unplanned">${UNPLANNED_GROUPS.map(opt).join('')}</optgroup>`;
}

function equipOptions(selected) {
  return `<option value="">— pick equipment —</option>` +
    EQUIP_CHOICES.map(e => `<option value="${esc(e)}"${e === selected ? ' selected' : ''}>${esc(e)}</option>`).join('');
}

const ISSUE_HELP = {
  'Downtime missing': 'No DT value and Stop/Start times are incomplete — excluded from totals. Enter minutes below, or exclude the row if it is blank noise.',
  'Unclassified reason': 'Pick a Reason Group once for each text below. It fixes every matching row and is saved for future months.',
  'Unreadable time': 'The time cell could not be read. Enter Stop/Start (HH:MM) or DT minutes below, or fix in Excel.',
  'Equipment missing': 'No equipment on this row. Pick the right machine below (or exclude if blank noise).',
  'Unknown equipment': 'Not recognized as Packer 1–4, Palletizer 1–2, or All / Shared. Map each text once below to fix all matching rows.',
  'Reason missing': 'Reason column is empty. Pick a Reason Group below, or exclude the row if it is incomplete noise.',
  'Very long stop': 'Single stop over 12 hours (720 min). Edit minutes, click OK if genuine, or exclude.',
  'No block found': 'This day sheet has no "Stop Time" header row, so nothing was read from it.',
  'Time typo auto-fixed': 'Already corrected automatically by the app. Fix in Excel to keep the master file clean.',
  'DT differs from Start − Stop': 'The DT column was used by default. Click "Use Start − Stop" on any row where clock times are more accurate.',
  'DT unreadable — calculated': 'DT cell was unreadable or negative formula, so elapsed Stop/Start time was used automatically.',
  'DT format': 'DT was a plain number and was read as minutes. Check that is correct.',
  'Burst bag cause missing': 'Burst/Stuck Bag stop has no Burst Bag Cause (appears as "(Not specified)" in Pareto). Fill it in below if known.',
  'Similar burst bag causes': 'These Burst Bag Cause names look like typos or variants of each other. Merge them into an alias with one click.',
  'Block date missing': 'Block has records but no date next to "Date:". The sheet number was used as the day.',
  'Date differs from sheet': 'The block date does not match the sheet number. The sheet number was used as the day.',
  'Month mismatch': 'The file name and the sheet dates disagree about the month; sheet dates were used.',
};
const FIXABLE_TYPES = new Set([
  'Downtime missing', 'Unclassified reason', 'Unreadable time', 'Equipment missing',
  'Unknown equipment', 'Reason missing', 'Very long stop', 'DT differs from Start − Stop',
  'Burst bag cause missing', 'Similar burst bag causes',
]);
const SEV_LABEL = { error: 'Error', warn: 'Warning', info: 'Info' };
const SEV_ORDER = { error: 0, warn: 1, info: 2 };

function renderQuality(a) {
  const el = $('#tab-quality');
  if (!a) { el.innerHTML = ''; return; }
  const m = a.month;
  const issues = a.liveIssues;
  const nErr = issues.filter(i => i.sev === 'error').length;
  const nWarn = issues.filter(i => i.sev === 'warn').length;
  const nInfo = issues.filter(i => i.sev === 'info').length;
  const issueTotal = issues.length + a.unclassRows;
  const cleanPct = pct(a.cleanRows, a.active.length);
  const fileFixKeys = Object.keys(state.rowFixes).filter(k => k.startsWith(m.fileName + '||'));

  el.innerHTML = `
    <div class="page-head">
      <div class="eyebrow">Data quality · ${esc(m.label)}${esc(dateRangeLabel(m))}</div>
      <h1>${a.needsReview ? `${fmt(a.needsReview)} issue${a.needsReview === 1 ? '' : 's'} need action` : 'All actionable issues resolved'}</h1>
      <p class="lede">${a.needsReview
        ? `Fix rows directly below (saved in your browser) or export a checklist to fix the Excel source. ${fmt(nInfo)} info notes are collapsed by default.`
        : `All ${fmt(a.active.length)} active records are clean and classified.${nInfo ? ` (${fmt(nInfo)} info notes available below.)` : ''}`}</p>
    </div>

    <div class="grid kpis">
      <div class="card kpi ${cleanPct >= 95 ? 'total' : 'hi'}"><div class="label">${icon('check')}Clean rows</div>
        <div class="value">${fmtPct(cleanPct)}</div>
        <div class="note">${fmt(a.cleanRows)} of ${fmt(a.active.length)} active rows${a.excludedRows ? ` · ${a.excludedRows} excluded` : ''}</div></div>
      <div class="card kpi ${a.missingDtRows ? 'review' : 'total'}"><div class="label">${icon('alert')}Excluded (missing DT)</div>
        <div class="value">${fmt(a.missingDtRows)}<small>${a.missingDtRows === 1 ? 'row' : 'rows'}</small></div>
        <div class="note">${a.missingDtRows ? 'Left out of totals until fixed' : 'All active rows have DT'}</div></div>
      <div class="card kpi ${a.unclassRows ? 'pal' : 'total'}"><div class="label">${icon('clock')}Unclassified impact</div>
        <div class="value">${fmt(a.unclassMin)}<small>min</small></div>
        <div class="note">${a.unclassUnique ? `${a.unclassUnique} unique reason${a.unclassUnique === 1 ? '' : 's'} (${a.unclassRows} rows)` : 'All reasons classified'}</div></div>
      <div class="card kpi"><div class="label">${icon('wrench')}Auto &amp; in-app fixes</div>
        <div class="value">${fmt(a.autoFixed + a.fixedRows + a.excludedRows)}</div>
        <div class="note">${a.autoFixed} auto-fixed · ${a.fixedRows} edited${a.excludedRows ? ` · ${a.excludedRows} excluded` : ''}${m.skippedNoiseRows ? `<br>${m.skippedNoiseRows} blank noise rows skipped` : ''}</div></div>
    </div>

    <div class="dq-bar">
      <div class="dq-actions">
        <button type="button" class="btn btn-sm" id="copyChecklistBtn">Copy checklist</button>
        <button type="button" class="btn btn-sm" id="exportIssuesBtn">Export issues (.csv)</button>
        <button type="button" class="btn btn-sm btn-primary" id="exportCleanBtn">Download cleaned Excel (.xlsx)</button>
        ${fileFixKeys.length ? `<button type="button" class="btn btn-sm btn-ghost" id="resetFixesBtn">Reset ${fileFixKeys.length} in-app fix${fileFixKeys.length === 1 ? '' : 'es'}</button>` : ''}
      </div>
    </div>

    <div class="sev-filter" role="group" aria-label="Filter by severity">
      ${[['', 'All', issueTotal], ['error', 'Errors', nErr], ['warn', 'Warnings', nWarn + a.unclassRows], ['info', 'Info', nInfo]].map(([v, l, n]) =>
        `<button type="button" class="sev-btn ${v || 'all'}" data-sev="${v}" aria-pressed="${(state.qFilter.sev || '') === v}"><b>${n}</b> ${l}</button>`).join('')}
      <input type="search" id="qText" placeholder="Search sheet, block, reason…" value="${esc(state.qFilter.text)}" aria-label="Search issues">
    </div>
    <datalist id="knownCausesList">${a.knownCauses.map(c => `<option value="${esc(c)}">`).join('')}</datalist>
    <div id="issueGroups"></div>

    <details class="card" id="allRecsDetails">
      <summary><h2 style="display:inline">All records</h2> <span class="sub">(${a.recs.length} total · ${a.active.length} active${a.excludedRows ? ` · ${a.excludedRows} excluded` : ''}) — inspect, filter, or edit any row</span></summary>
      <div class="filters" style="margin-top:12px">
        <input type="search" id="recText" placeholder="Search reason, remarks, sheet…" value="${esc(state.recFilter.text)}">
        <select id="recCat" aria-label="Filter by category">
          <option value="">All categories</option>
          ${['Unplanned', 'Planned', UNCLASSIFIED].map(c => `<option value="${c}"${state.recFilter.cat === c ? ' selected' : ''}>${c}</option>`).join('')}
        </select>
        <select id="recEq" aria-label="Filter by equipment">
          <option value="">All equipment</option>
          ${[...MACHINES, SHARED, '(Missing)'].map(eq => `<option value="${esc(eq)}"${state.recFilter.eq === eq ? ' selected' : ''}>${esc(eq)}</option>`).join('')}
        </select>
        <select id="recStatus" aria-label="Filter by status">
          <option value="">All rows</option>
          <option value="issues"${state.recFilter.status === 'issues' ? ' selected' : ''}>Has issues only</option>
          <option value="fixed"${state.recFilter.status === 'fixed' ? ' selected' : ''}>Fixed in app</option>
          <option value="excluded"${state.recFilter.status === 'excluded' ? ' selected' : ''}>Excluded</option>
        </select>
      </div>
      <div class="table-wrap scroll-y" id="recTable"></div>
    </details>

    <div class="card">
      <div class="card-head"><h2>File details</h2></div>
      <p class="help">${esc(m.fileName)} — read ${m.sheetsRead.length} of ${m.daySheets.length} day sheets (${m.activeDaysCount} with records), ${m.blocksFound.length} blocks, ${m.records.length} rows${m.skippedNoiseRows ? ` (${m.skippedNoiseRows} blank formula/noise rows ignored)` : ''}.
      ${!m.hasCauseCol ? ' Detected 6-column format (no Burst Bag Cause column).' : ' Detected 7-column format.'}
      ${m.ignored.length ? ` Ignored sheets: ${m.ignored.map(esc).join(', ')}.` : ''}</p>
    </div>`;

  renderIssueGroups(a);
  renderRecTable(a);

  $('#copyChecklistBtn').onclick = () => copyIssueChecklist(a);
  $('#exportIssuesBtn').onclick = () => exportIssuesCSV(a);
  $('#exportCleanBtn').onclick = () => exportCleanedExcel(a);
  const resetBtn = $('#resetFixesBtn');
  if (resetBtn) {
    resetBtn.onclick = () => {
      if (!confirm(`Clear all ${fileFixKeys.length} in-app row fixes for ${m.fileName}?`)) return;
      for (const k of fileFixKeys) delete state.rowFixes[k];
      saveLS(LS.rowFixes, state.rowFixes);
      refreshKeepScroll();
      toast('Cleared all in-app row fixes for this file.');
    };
  }

  $$('.sev-btn', el).forEach(b => b.onclick = () => {
    state.qFilter.sev = b.dataset.sev;
    $$('.sev-btn', el).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    renderIssueGroups(a);
  });
  $('#qText').oninput = e => { state.qFilter.text = e.target.value; renderIssueGroups(a); };
  $('#recText').oninput = e => { state.recFilter.text = e.target.value; renderRecTable(a); };
  $('#recCat').onchange = e => { state.recFilter.cat = e.target.value; renderRecTable(a); };
  $('#recEq').onchange = e => { state.recFilter.eq = e.target.value; renderRecTable(a); };
  $('#recStatus').onchange = e => { state.recFilter.status = e.target.value; renderRecTable(a); };

  wireQualityActions(el, a);
}

function wireQualityActions(el, a) {
  const recById = new Map(a.recs.map(r => [r.id, r]));

  el.onchange = e => {
    // 1. Map unclassified reason
    const selMap = e.target.closest('select[data-map]');
    if (selMap && selMap.value) {
      const key = selMap.dataset.map, val = selMap.value;
      const prev = state.overrides[key];
      state.overrides[key] = val;
      saveLS(LS.overrides, state.overrides);
      refreshKeepScroll();
      toast(`Mapped to ${val}. Saved for later months.`, {
        undo: () => {
          if (prev) state.overrides[key] = prev; else delete state.overrides[key];
          saveLS(LS.overrides, state.overrides);
          refreshKeepScroll();
        },
      });
      return;
    }

    // 2. Bulk map unknown equipment
    const selEqMap = e.target.closest('select[data-eq-map]');
    if (selEqMap && selEqMap.value) {
      const key = selEqMap.dataset.eqMap, val = selEqMap.value;
      const prev = state.eqMap[key];
      state.eqMap[key] = val;
      saveLS(LS.eqMap, state.eqMap);
      refreshKeepScroll();
      toast(`Mapped equipment "${key}" → ${val}.`, {
        undo: () => {
          if (prev) state.eqMap[key] = prev; else delete state.eqMap[key];
          saveLS(LS.eqMap, state.eqMap);
          refreshKeepScroll();
        },
      });
      return;
    }

    // 3. Fix single row equipment
    const selRowEq = e.target.closest('select[data-fix-eq]');
    if (selRowEq && selRowEq.value) {
      const r = recById.get(+selRowEq.dataset.fixEq);
      if (r) applyRowFix(r.fk, { equipment: selRowEq.value }, `Row ${r.row} (Sheet ${r.sheet}) → ${selRowEq.value}.`);
      return;
    }

    // 4. Fix single row missing reason by picking group
    const selRowGrp = e.target.closest('select[data-fix-grp]');
    if (selRowGrp && selRowGrp.value) {
      const r = recById.get(+selRowGrp.dataset.fixGrp);
      if (r) applyRowFix(r.fk, { group: selRowGrp.value, reason: r.reason || selRowGrp.value }, `Row ${r.row} (Sheet ${r.sheet}) → ${selRowGrp.value}.`);
      return;
    }
  };

  el.onclick = e => {
    // Suggested group quick-click
    const sug = e.target.closest('[data-suggest-key]');
    if (sug) {
      const key = sug.dataset.suggestKey, val = sug.dataset.suggestGroup;
      const prev = state.overrides[key];
      state.overrides[key] = val;
      saveLS(LS.overrides, state.overrides);
      refreshKeepScroll();
      toast(`Mapped to ${val}.`, {
        undo: () => {
          if (prev) state.overrides[key] = prev; else delete state.overrides[key];
          saveLS(LS.overrides, state.overrides);
          refreshKeepScroll();
        },
      });
      return;
    }

    // Apply inline DT fix (Downtime missing / Unreadable time / Very long stop)
    const dtBtn = e.target.closest('[data-apply-dt]');
    if (dtBtn) {
      const r = recById.get(+dtBtn.dataset.applyDt);
      const wrap = dtBtn.closest('.fix-inline');
      const inp = wrap && $('input[data-dt-val]', wrap);
      const v = inp ? parseFloat(inp.value) : NaN;
      if (!r || isNaN(v) || v < 0) { toast('Enter valid minutes (e.g. 15).'); return; }
      applyRowFix(r.fk, { dt: v, ackLong: true }, `Set Sheet ${r.sheet} row ${r.row} DT = ${fmt(v)} min.`);
      return;
    }

    // Apply inline time fix (Unreadable time)
    const tmBtn = e.target.closest('[data-apply-time]');
    if (tmBtn) {
      const r = recById.get(+tmBtn.dataset.applyTime);
      const wrap = tmBtn.closest('.fix-inline');
      const stIn = $('input[data-stop-in]', wrap), saIn = $('input[data-start-in]', wrap);
      const patch = {};
      if (stIn && stIn.value.trim()) {
        const p = parseTime(stIn.value.trim());
        if (p.error || p.empty) { toast('Invalid Stop Time (use HH:MM, e.g. 07:15).'); return; }
        patch.stop = p.min;
      }
      if (saIn && saIn.value.trim()) {
        const p = parseTime(saIn.value.trim());
        if (p.error || p.empty) { toast('Invalid Start Time (use HH:MM, e.g. 07:45).'); return; }
        patch.start = p.min;
      }
      if (!Object.keys(patch).length) { toast('Enter Stop or Start time (HH:MM).'); return; }
      applyRowFix(r.fk, patch, `Updated time on Sheet ${r.sheet} row ${r.row}.`);
      return;
    }

    // Use Start - Stop instead of DT column
    const calcBtn = e.target.closest('[data-use-calc]');
    if (calcBtn) {
      const r = recById.get(+calcBtn.dataset.useCalc);
      if (r) applyRowFix(r.fk, { useCalcDt: true }, `Sheet ${r.sheet} row ${r.row} now uses ${fmt(r.calc)} min.`);
      return;
    }

    // Acknowledge Very Long Stop
    const ackBtn = e.target.closest('[data-ack-long]');
    if (ackBtn) {
      const r = recById.get(+ackBtn.dataset.ackLong);
      if (r) applyRowFix(r.fk, { ackLong: true }, `Marked Sheet ${r.sheet} row ${r.row} as verified.`);
      return;
    }

    // Apply inline Burst Bag Cause
    const causeBtn = e.target.closest('[data-apply-cause]');
    if (causeBtn) {
      const r = recById.get(+causeBtn.dataset.applyCause);
      const wrap = causeBtn.closest('.fix-inline');
      const inp = wrap && $('input[data-cause-in]', wrap);
      const v = inp ? cellText(inp.value) : '';
      if (!r || !v) { toast('Enter or pick a Burst Bag Cause.'); return; }
      applyRowFix(r.fk, { cause: v }, `Set cause "${normCause(v)}" on Sheet ${r.sheet} row ${r.row}.`);
      return;
    }

    // Merge similar burst bag causes into alias
    const mergeBtn = e.target.closest('[data-merge-from]');
    if (mergeBtn) {
      const from = mergeBtn.dataset.mergeFrom, to = mergeBtn.dataset.mergeTo;
      const prev = JSON.parse(JSON.stringify(state.aliases));
      state.aliases.push({ from, to });
      saveLS(LS.aliases, state.aliases);
      refreshKeepScroll();
      toast(`Merged "${from}" → "${to}". Saved to aliases.`, {
        undo: () => {
          state.aliases = prev;
          saveLS(LS.aliases, state.aliases);
          refreshKeepScroll();
        },
      });
      return;
    }

    // Exclude row
    const exBtn = e.target.closest('[data-exclude-rec]');
    if (exBtn) {
      const r = recById.get(+exBtn.dataset.excludeRec);
      if (r) applyRowFix(r.fk, { excluded: true }, `Excluded Sheet ${r.sheet} row ${r.row} from report.`);
      return;
    }

    // Restore excluded or undo row fix
    const resBtn = e.target.closest('[data-restore-rec]');
    if (resBtn) {
      const r = recById.get(+resBtn.dataset.restoreRec);
      if (r) clearRowFix(r.fk, `Restored Sheet ${r.sheet} row ${r.row}.`);
      return;
    }
  };
}

function renderIssueGroups(a) {
  const q = state.qFilter.text.toLowerCase();
  const sev = state.qFilter.sev || '';
  const recById = new Map(a.recs.map(r => [r.id, r]));
  const list = buildAllIssues(a)
    .filter(i => !sev || i.sev === sev)
    .filter(i => !q || `${i.type} ${i.detail} ${i.sheet} ${i.block}`.toLowerCase().includes(q));

  const groups = new Map();
  for (const i of list) { if (!groups.has(i.type)) groups.set(i.type, []); groups.get(i.type).push(i); }
  const ordered = [...groups.entries()].sort((x, y) => SEV_ORDER[x[1][0].sev] - SEV_ORDER[y[1][0].sev] || y[1].length - x[1].length);
  const byRow = (x, y) => (+x.sheet || 0) - (+y.sheet || 0) || (x.row || 0) - (y.row || 0);
  const where = i => (i.sheet ? `Sheet ${esc(i.sheet)}${i.row ? ` · row ${i.row}` : ''}` : '—');

  const rowsTable = items => `<div class="table-wrap scroll-y"><table><thead><tr><th>Where in Excel</th><th>Block</th><th>Detail</th></tr></thead><tbody>
    ${items.slice().sort(byRow).map(i => `<tr><td class="nowrap">${where(i)}</td><td>${esc(i.block)}</td><td>${esc(i.detail)}</td></tr>`).join('')}
    </tbody></table></div>`;

  const unclassBody = items => {
    const keys = new Set(items.map(i => i.key));
    const uniq = a.unclassList.filter(u => !u.empty && keys.has(u.key));
    return `<div class="table-wrap"><table><thead><tr><th>Reason text &amp; context</th><th class="num">Rows</th><th class="num">Min</th><th>Map to Reason Group</th></tr></thead><tbody>
      ${uniq.map(u => {
        const sug = suggestGroup(u.text);
        const mList = [...u.machines].slice(0, 3).join(', ');
        const rmk = [...u.remarks].slice(0, 1).join('');
        return `<tr>
          <td><b>${esc(u.text)}</b>
            ${mList || rmk ? `<div class="ctx-note">${esc(mList)}${rmk ? ` · “${esc(trunc(rmk, 50))}”` : ''}</div>` : ''}
          </td>
          <td class="num">${u.count}</td>
          <td class="num">${fmt(u.min)}</td>
          <td>
            <select data-map="${esc(u.key)}" aria-label="Reason group for ${esc(u.text)}">${groupOptions('')}</select>
            ${sug ? `<div><button type="button" class="suggest-btn" data-suggest-key="${esc(u.key)}" data-suggest-group="${esc(sug)}" title="Click to map immediately">Quick pick: ${esc(sug)} ✓</button></div>` : ''}
          </td>
        </tr>`;
      }).join('')}
      </tbody></table></div>
      <details class="sub-details"><summary>Show all ${items.length} matching rows</summary>${rowsTable(items)}</details>`;
  };

  const missingDtBody = items => `<div class="table-wrap scroll-y"><table><thead><tr><th>Where</th><th>Row context</th><th>Quick fix in app</th></tr></thead><tbody>
    ${items.slice().sort(byRow).map(i => {
      const r = recById.get(i.recId);
      return `<tr>
        <td class="nowrap">${where(i)}<div class="ctx-note">${esc(i.block)}</div></td>
        <td><b>${esc(r.equipment)}</b> · ${esc(r.reason || '(no reason)')}<div class="ctx-note">Stop: ${esc(r.stopRaw || '—')} · Start: ${esc(r.startRaw || '—')} · DT: ${esc(r.dtRaw || '—')}</div></td>
        <td><div class="fix-inline">
          <input type="number" min="0" step="1" placeholder="DT min" data-dt-val aria-label="Minutes for row ${r.row}">
          <button type="button" class="btn btn-sm btn-primary" data-apply-dt="${r.id}">Apply</button>
          <button type="button" class="btn btn-sm btn-ghost" data-exclude-rec="${r.id}" title="Ignore this row in report">Exclude</button>
        </div></td>
      </tr>`;
    }).join('')}
  </tbody></table></div>`;

  const badTimeBody = items => `<div class="table-wrap scroll-y"><table><thead><tr><th>Where</th><th>Problem &amp; raw times</th><th>Quick fix in app</th></tr></thead><tbody>
    ${items.slice().sort(byRow).map(i => {
      const r = recById.get(i.recId);
      return `<tr>
        <td class="nowrap">${where(i)}<div class="ctx-note">${esc(i.block)}</div></td>
        <td>${esc(i.detail)}<div class="ctx-note">${esc(r.equipment)} · ${esc(r.reason || '(no reason)')}${r.dt != null ? ` · DT: ${fmt(r.dt)} min` : ''}</div></td>
        <td><div class="fix-inline">
          <input type="text" placeholder="Stop HH:MM" value="${r.stop != null ? clock(r.stop) : ''}" data-stop-in aria-label="Stop time">
          <input type="text" placeholder="Start HH:MM" value="${r.start != null ? clock(r.start) : ''}" data-start-in aria-label="Start time">
          <button type="button" class="btn btn-sm btn-primary" data-apply-time="${r.id}">Save</button>
          <button type="button" class="btn btn-sm btn-ghost" data-exclude-rec="${r.id}">Exclude</button>
        </div></td>
      </tr>`;
    }).join('')}
  </tbody></table></div>`;

  const eqMissingBody = items => `<div class="table-wrap scroll-y"><table><thead><tr><th>Where</th><th>Current &amp; reason</th><th>Assign equipment</th></tr></thead><tbody>
    ${items.slice().sort(byRow).map(i => {
      const r = recById.get(i.recId);
      return `<tr>
        <td class="nowrap">${where(i)}<div class="ctx-note">${esc(i.block)}</div></td>
        <td>${esc(i.detail)}<div class="ctx-note">${r.dt != null ? fmt(r.dt) + ' min · ' : ''}${esc(r.reason || '(no reason)')}</div></td>
        <td><div class="fix-inline">
          <select data-fix-eq="${r.id}" aria-label="Equipment for row ${r.row}">${equipOptions(r.equipment !== '(Missing)' ? r.equipment : '')}</select>
          <button type="button" class="btn btn-sm btn-ghost" data-exclude-rec="${r.id}">Exclude</button>
        </div></td>
      </tr>`;
    }).join('')}
  </tbody></table></div>`;

  const eqUnknownBody = items => {
    const byEq = new Map();
    for (const i of items) {
      const r = recById.get(i.recId);
      const k = i.eqKey || normKey(r.equipmentRaw);
      const o = byEq.get(k) || { key: k, raw: i.eqRaw || r.equipmentRaw, count: 0, min: 0 };
      o.count++; o.min += r.dt || 0;
      byEq.set(k, o);
    }
    return `<div class="table-wrap"><table><thead><tr><th>Equipment text in Excel</th><th class="num">Rows</th><th class="num">Min</th><th>Map all matching rows to</th></tr></thead><tbody>
      ${[...byEq.values()].sort((x, y) => y.min - x.min).map(u => `<tr>
        <td><b>${esc(u.raw)}</b></td><td class="num">${u.count}</td><td class="num">${fmt(u.min)}</td>
        <td><select data-eq-map="${esc(u.key)}" aria-label="Map equipment ${esc(u.raw)}">${equipOptions('')}</select></td>
      </tr>`).join('')}
    </tbody></table></div>
    <details class="sub-details"><summary>Show all ${items.length} matching rows</summary>${rowsTable(items)}</details>`;
  };

  const reasonMissingBody = items => `<div class="table-wrap scroll-y"><table><thead><tr><th>Where</th><th>Row context</th><th>Quick fix in app</th></tr></thead><tbody>
    ${items.slice().sort(byRow).map(i => {
      const r = recById.get(i.recId);
      return `<tr>
        <td class="nowrap">${where(i)}<div class="ctx-note">${esc(i.block)}</div></td>
        <td><b>${esc(r.equipment)}</b> · ${r.dt != null ? fmt(r.dt) + ' min' : 'no DT'}<div class="ctx-note">${clock(r.stop)}–${clock(r.start)}${r.remarks ? ` · Remarks: ${esc(r.remarks)}` : ''}</div></td>
        <td><div class="fix-inline">
          <select data-fix-grp="${r.id}" aria-label="Reason group for row ${r.row}">${groupOptions('')}</select>
          <button type="button" class="btn btn-sm btn-ghost" data-exclude-rec="${r.id}">Exclude</button>
        </div></td>
      </tr>`;
    }).join('')}
  </tbody></table></div>`;

  const longStopBody = items => `<div class="table-wrap scroll-y"><table><thead><tr><th>Where</th><th>Details</th><th>Verify or fix</th></tr></thead><tbody>
    ${items.slice().sort(byRow).map(i => {
      const r = recById.get(i.recId);
      return `<tr>
        <td class="nowrap">${where(i)}<div class="ctx-note">${esc(i.block)}</div></td>
        <td><b>${fmt(r.dt)} min</b> (${fmtH(r.dt)} h) · ${esc(r.equipment)}<div class="ctx-note">${esc(r.reason || '(no reason)')} · ${clock(r.stop)}–${clock(r.start)}</div></td>
        <td><div class="fix-inline">
          <input type="number" min="0" step="1" placeholder="New min" data-dt-val aria-label="New minutes">
          <button type="button" class="btn btn-sm btn-primary" data-apply-dt="${r.id}">Update</button>
          <button type="button" class="btn btn-sm" data-ack-long="${r.id}" title="Keep this value and clear warning">OK</button>
          <button type="button" class="btn btn-sm btn-ghost" data-exclude-rec="${r.id}">Exclude</button>
        </div></td>
      </tr>`;
    }).join('')}
  </tbody></table></div>`;

  const dtDiffBody = items => `<div class="table-wrap scroll-y"><table><thead><tr><th>Where</th><th>Comparison</th><th>Action</th></tr></thead><tbody>
    ${items.slice().sort(byRow).map(i => {
      const r = recById.get(i.recId);
      return `<tr>
        <td class="nowrap">${where(i)}<div class="ctx-note">${esc(i.block)}</div></td>
        <td>DT col: <b>${fmt(i.dtCol)} min</b> vs ${esc(i.diffLabel || 'Start − Stop')}: <b>${fmt(i.calcMin)} min</b><div class="ctx-note">${esc(r.equipment)} · ${esc(r.reason)} (${clock(r.stop)}–${clock(r.start)})</div></td>
        <td><button type="button" class="btn btn-sm" data-use-calc="${r.id}">Use ${fmt(i.calcMin)} min</button></td>
      </tr>`;
    }).join('')}
  </tbody></table></div>`;

  const causeMissingBody = items => `<div class="table-wrap scroll-y"><table><thead><tr><th>Where</th><th>Burst stop</th><th>Set Burst Bag Cause</th></tr></thead><tbody>
    ${items.slice().sort(byRow).map(i => {
      const r = recById.get(i.recId);
      return `<tr>
        <td class="nowrap">${where(i)}<div class="ctx-note">${esc(i.block)}</div></td>
        <td><b>${esc(r.equipment)}</b> · ${fmt(r.dt)} min<div class="ctx-note">${esc(r.reason)}${r.remarks ? ` · ${esc(r.remarks)}` : ''}</div></td>
        <td><div class="fix-inline">
          <input type="text" class="fix-text" list="knownCausesList" placeholder="Pick or type cause…" data-cause-in aria-label="Burst bag cause">
          <button type="button" class="btn btn-sm btn-primary" data-apply-cause="${r.id}">Save</button>
        </div></td>
      </tr>`;
    }).join('')}
  </tbody></table></div>`;

  const similarCauseBody = items => `<div class="table-wrap"><table><thead><tr><th>Variant found</th><th>Matches existing</th><th>Merge as alias</th></tr></thead><tbody>
    ${items.map(i => {
      const sc = i.similar;
      return `<tr>
        <td><b>${esc(sc.from)}</b> <span class="ctx-note">(${sc.fromCount} rows · ${fmt(sc.fromMin)} min)</span></td>
        <td><b>${esc(sc.to)}</b> <span class="ctx-note">(${sc.toCount} rows · ${fmt(sc.toMin)} min)</span></td>
        <td><button type="button" class="btn btn-sm btn-primary" data-merge-from="${esc(sc.from)}" data-merge-to="${esc(sc.to)}">Merge → ${esc(sc.to)}</button></td>
      </tr>`;
    }).join('')}
  </tbody></table></div>`;

  const bodyFor = (type, items) => {
    if (type === 'Unclassified reason') return unclassBody(items);
    if (type === 'Downtime missing') return missingDtBody(items);
    if (type === 'Unreadable time') return badTimeBody(items);
    if (type === 'Equipment missing') return eqMissingBody(items);
    if (type === 'Unknown equipment') return eqUnknownBody(items);
    if (type === 'Reason missing') return reasonMissingBody(items);
    if (type === 'Very long stop') return longStopBody(items);
    if (type === 'DT differs from Start − Stop') return dtDiffBody(items);
    if (type === 'Burst bag cause missing') return causeMissingBody(items);
    if (type === 'Similar burst bag causes') return similarCauseBody(items);
    return rowsTable(items);
  };

  $('#issueGroups').innerHTML = ordered.length ? ordered.map(([type, items]) => {
    const sv = items[0].sev;
    const defaultOpen = sv !== 'info' || sev === 'info' || Boolean(q);
    const isOpen = type in state.openGroups ? state.openGroups[type] : defaultOpen;
    const countLabel = type === 'Unclassified reason'
      ? `${new Set(items.map(i => i.key)).size} unique (${items.length} rows · ${fmt(a.unclassMin)} min)`
      : `${items.length} ${items.length === 1 ? 'row' : 'rows'}`;
    return `<details class="card issue-group ${sv}" data-group-type="${esc(type)}"${isOpen ? ' open' : ''}>
      <summary>
        <span class="pill ${sv}">${SEV_LABEL[sv]}</span>
        <span class="ig-title">${esc(type)}</span>
        <span class="ig-count">${countLabel}</span>
        ${FIXABLE_TYPES.has(type) ? '<span class="ig-tag">Fixable here</span>' : ''}
      </summary>
      <p class="ig-help">${esc(ISSUE_HELP[type] || '')}</p>
      ${bodyFor(type, items)}
    </details>`;
  }).join('') : `<div class="card"><p class="nodata">${q || sev ? 'No issues match this filter.' : 'No issues. Every row was read cleanly.'}</p></div>`;

  // Remember user open/close state on each issue group
  $$('details.issue-group', $('#issueGroups')).forEach(d => {
    d.ontoggle = () => { state.openGroups[d.dataset.groupType] = d.open; };
  });
}

function renderRecTable(a) {
  const f = state.recFilter;
  const q = f.text.toLowerCase();
  const list = a.recs.filter(r => {
    if (f.cat && r.category !== f.cat) return false;
    if (f.eq && r.equipment !== f.eq) return false;
    if (f.status === 'issues' && (r.excluded || (r.category !== UNCLASSIFIED && !r.issues.some(i => i.sev !== 'info')))) return false;
    if (f.status === 'fixed' && !r.fixed) return false;
    if (f.status === 'excluded' && !r.excluded) return false;
    if (q && !`${r.sheet} ${r.block} ${r.equipment} ${r.reason} ${r.group} ${r.cause} ${r.remarks}`.toLowerCase().includes(q)) return false;
    return true;
  });

  $('#recTable').innerHTML = `<table><thead><tr><th class="num">Day</th><th class="num">Row</th><th>Block</th><th>Stop</th><th>Start</th><th class="num">DT min</th><th>DT from</th><th>Equipment</th><th>Reason</th><th>Group</th><th>Category</th><th>Burst cause</th><th>Remarks</th><th></th></tr></thead><tbody>
    ${list.slice(0, 2000).map(r => `<tr class="${r.excluded ? 'row-excluded' : ''}">
      <td class="num">${r.day}</td><td class="num">${r.row}</td><td>${esc(r.block)}</td>
      <td class="mono" title="${esc(r.stopRaw)}">${clock(r.stop)}</td><td class="mono" title="${esc(r.startRaw)}">${clock(r.start)}</td>
      <td class="num">${r.dt != null ? fmt(r.dt) : '<span class="pill error">missing</span>'}</td><td>${esc(r.dtSource)}</td>
      <td>${esc(r.equipment)}</td><td>${esc(r.reason)}</td>
      <td>${esc(r.group)}${r.via === 'mapping' ? ' <span class="pill info" title="From saved mapping">mapped</span>' : ''}${r.fixed ? ' <span class="pill fixed" title="Edited in browser">fixed</span>' : ''}</td>
      <td>${r.excluded ? '<span class="pill excluded">Excluded</span>' : `<span class="pill ${r.category.toLowerCase()}">${esc(r.category)}</span>`}</td>
      <td>${esc(r.cause)}</td><td>${esc(r.remarks)}</td>
      <td class="nowrap">${r.excluded || r.fixed
        ? `<button type="button" class="btn btn-sm btn-ghost" data-restore-rec="${r.id}">${r.excluded ? 'Restore' : 'Reset'}</button>`
        : `<button type="button" class="btn btn-sm btn-ghost" data-exclude-rec="${r.id}" title="Exclude row from report">Exclude</button>`}</td>
    </tr>`).join('')}
    </tbody></table>${list.length > 2000 ? `<p class="help">Showing first 2000 of ${list.length}.</p>` : ''}${!list.length ? '<p class="nodata" style="padding:12px">No matching records.</p>' : ''}`;
}

// ---------------------------------------------------------------- render: rules
function renderRules() {
  const el = $('#tab-rules');
  const overrides = Object.entries(state.overrides).sort((a, b) => a[0].localeCompare(b[0]));
  const eqMaps = Object.entries(state.eqMap).sort((a, b) => a[0].localeCompare(b[0]));
  el.innerHTML = `
    <div class="page-head">
      <div class="eyebrow">Settings · saved in this browser</div>
      <h1>Classification rules</h1>
      <p class="lede">Changes apply at once and are kept in this browser's local storage. Nothing is uploaded.</p>
    </div>

    <div class="card">
      <div class="card-head"><h2>Reason keyword rules</h2><span class="sub">Regular expressions, case-insensitive. Checked top to bottom — the first match wins.</span></div>
      <div class="tester"><input type="text" id="ruleTest" placeholder="Type a reason to test, e.g. “Bag burst at diverter”"><span class="result" id="ruleTestResult"></span></div>
      <div class="table-wrap"><table class="rules-table"><thead><tr><th class="num">#</th><th style="width:55%">Pattern (regex)</th><th>Reason Group</th><th>Category</th><th></th></tr></thead><tbody>
        ${state.rules.map((r, i) => `<tr>
          <td class="num rank">${i + 1}</td>
          <td><input type="text" data-rule="${i}" data-field="pattern" value="${esc(r.pattern)}" spellcheck="false" aria-label="Pattern for rule ${i + 1}"></td>
          <td><select data-rule="${i}" data-field="group" aria-label="Group for rule ${i + 1}">${groupOptions(r.group, false)}</select></td>
          <td><span class="pill ${categoryOf(r.group).toLowerCase()}">${categoryOf(r.group)}</span></td>
          <td class="rule-actions"><button class="btn btn-sm btn-icon" data-move="${i}" data-dir="-1" title="Move up" ${i === 0 ? 'disabled' : ''}>↑</button>
            <button class="btn btn-sm btn-icon" data-move="${i}" data-dir="1" title="Move down" ${i === state.rules.length - 1 ? 'disabled' : ''}>↓</button>
            <button class="btn btn-sm btn-icon" data-del-rule="${i}" title="Delete rule">✕</button></td></tr>`).join('')}
      </tbody></table></div>
      <div class="row-actions"><button class="btn" id="addRule">+ Add rule</button><button class="btn btn-ghost" id="resetRules">Reset to defaults</button></div>
    </div>

    <div class="card">
      <div class="card-head"><h2>Saved reason mappings</h2><span class="sub">Made on the Data Quality tab. These are checked before the keyword rules.</span></div>
      ${overrides.length ? `<div class="table-wrap scroll-y"><table><thead><tr><th>Reason text</th><th>Reason Group</th><th></th></tr></thead><tbody>
        ${overrides.map(([k, g]) => `<tr><td>${esc(k)}</td><td><select data-ovr="${esc(k)}">${groupOptions(g, false)}</select></td><td><button class="btn btn-sm btn-icon" data-del-ovr="${esc(k)}" title="Remove mapping">✕</button></td></tr>`).join('')}
      </tbody></table></div>` : '<p class="nodata">No saved mappings yet.</p>'}
    </div>

    <div class="card">
      <div class="card-head"><h2>Saved equipment mappings</h2><span class="sub">Unknown equipment names mapped on the Data Quality tab.</span></div>
      ${eqMaps.length ? `<div class="table-wrap scroll-y"><table><thead><tr><th>Text in file</th><th>Machine</th><th></th></tr></thead><tbody>
        ${eqMaps.map(([k, v]) => `<tr><td>${esc(k)}</td><td><select data-eq-ovr="${esc(k)}">${equipOptions(v)}</select></td><td><button class="btn btn-sm btn-icon" data-del-eq="${esc(k)}" title="Remove equipment mapping">✕</button></td></tr>`).join('')}
      </tbody></table></div>` : '<p class="nodata">No saved equipment mappings yet.</p>'}
    </div>

    <div class="card">
      <div class="card-head"><h2>Burst Bag Cause aliases</h2><span class="sub">Matched case-insensitively. Names without an alias are written in sentence case (“bag destroyer” → “Bag destroyer”).</span></div>
      <div class="table-wrap"><table class="rules-table"><thead><tr><th>Name in file</th><th>Show as</th><th></th></tr></thead><tbody>
        ${state.aliases.map((a, i) => `<tr><td><input type="text" data-alias="${i}" data-field="from" value="${esc(a.from)}" aria-label="Alias from"></td>
          <td><input type="text" data-alias="${i}" data-field="to" value="${esc(a.to)}" aria-label="Alias to"></td>
          <td><button class="btn btn-sm btn-icon" data-del-alias="${i}" title="Delete alias">✕</button></td></tr>`).join('')}
      </tbody></table></div>
      <div class="row-actions"><button class="btn" id="addAlias">+ Add alias</button><button class="btn btn-ghost" id="resetAliases">Reset to defaults</button></div>
    </div>

    <div class="card">
      <div class="card-head"><h2>Backup</h2><span class="sub">Move your rules, mappings and aliases to another computer or browser.</span></div>
      <div class="row-actions"><button class="btn" id="exportSettings">Download settings (.json)</button>
        <label class="btn">Import settings… <input type="file" id="importSettings" accept=".json,application/json" hidden></label></div>
    </div>`;

  const persistRules = () => { saveLS(LS.rules, state.rules); compileRules(); refresh({ keepRules: true }); };
  const testRule = () => {
    const v = $('#ruleTest').value, out = $('#ruleTestResult');
    if (!v.trim()) { out.textContent = ''; return; }
    const c = classify(v);
    out.innerHTML = `→ <b>${esc(c.group)}</b> <span class="pill ${c.category.toLowerCase()}">${esc(c.category)}</span>${c.via === 'mapping' ? ' (saved mapping)' : ''}`;
  };
  $('#ruleTest').oninput = testRule;

  $$('input[data-rule]', el).forEach(inp => inp.oninput = () => {
    const i = +inp.dataset.rule;
    try { new RegExp(inp.value, 'i'); inp.classList.remove('invalid'); inp.title = ''; }
    catch (e) { inp.classList.add('invalid'); inp.title = 'Invalid regular expression — rule is skipped until fixed'; }
    state.rules[i].pattern = inp.value; saveLS(LS.rules, state.rules); compileRules();
    clearTimeout(renderRules.t); renderRules.t = setTimeout(() => { refresh({ keepRules: true }); testRule(); }, 400);
  });
  $$('select[data-rule]', el).forEach(s => s.onchange = () => { state.rules[+s.dataset.rule].group = s.value; persistRules(); renderRules(); });
  $$('[data-move]', el).forEach(b => b.onclick = () => {
    const i = +b.dataset.move, j = i + +b.dataset.dir;
    [state.rules[i], state.rules[j]] = [state.rules[j], state.rules[i]]; persistRules(); renderRules();
  });
  $$('[data-del-rule]', el).forEach(b => b.onclick = () => { state.rules.splice(+b.dataset.delRule, 1); persistRules(); renderRules(); });
  $('#addRule').onclick = () => { state.rules.push({ pattern: '', group: 'Other' }); saveLS(LS.rules, state.rules); renderRules(); const ins = $$('input[data-rule]'); ins[ins.length - 1].focus(); };
  $('#resetRules').onclick = () => { if (confirm('Replace all keyword rules with the defaults?')) { state.rules = JSON.parse(JSON.stringify(DEFAULT_RULES)); persistRules(); renderRules(); } };

  $$('select[data-ovr]', el).forEach(s => s.onchange = () => { state.overrides[s.dataset.ovr] = s.value; saveLS(LS.overrides, state.overrides); refresh({ keepRules: true }); });
  $$('[data-del-ovr]', el).forEach(b => b.onclick = () => { delete state.overrides[b.dataset.delOvr]; saveLS(LS.overrides, state.overrides); refresh(); });

  $$('select[data-eq-ovr]', el).forEach(s => s.onchange = () => { if (!s.value) return; state.eqMap[s.dataset.eqOvr] = s.value; saveLS(LS.eqMap, state.eqMap); refresh({ keepRules: true }); });
  $$('[data-del-eq]', el).forEach(b => b.onclick = () => { delete state.eqMap[b.dataset.delEq]; saveLS(LS.eqMap, state.eqMap); refresh(); });

  $$('input[data-alias]', el).forEach(inp => inp.oninput = () => {
    state.aliases[+inp.dataset.alias][inp.dataset.field] = inp.value; saveLS(LS.aliases, state.aliases);
    clearTimeout(renderRules.a); renderRules.a = setTimeout(() => refresh({ keepRules: true }), 400);
  });
  $$('[data-del-alias]', el).forEach(b => b.onclick = () => { state.aliases.splice(+b.dataset.delAlias, 1); saveLS(LS.aliases, state.aliases); refresh(); });
  $('#addAlias').onclick = () => { state.aliases.push({ from: '', to: '' }); saveLS(LS.aliases, state.aliases); renderRules(); };
  $('#resetAliases').onclick = () => { if (confirm('Replace the alias table with the defaults?')) { state.aliases = JSON.parse(JSON.stringify(DEFAULT_ALIASES)); saveLS(LS.aliases, state.aliases); refresh(); } };

  $('#exportSettings').onclick = () => {
    const blob = new Blob([JSON.stringify({ app: 'start-stop-analyzer', version: 2, rules: state.rules, aliases: state.aliases, reasonMap: state.overrides, eqMap: state.eqMap }, null, 2)], { type: 'application/json' });
    downloadBlob(blob, 'start-stop-analyzer-settings.json');
  };
  $('#importSettings').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (Array.isArray(d.rules)) state.rules = d.rules.filter(r => r && typeof r.pattern === 'string' && typeof r.group === 'string');
      if (Array.isArray(d.aliases)) state.aliases = d.aliases.filter(a => a && typeof a.from === 'string');
      if (d.reasonMap && typeof d.reasonMap === 'object') state.overrides = Object.fromEntries(Object.entries(d.reasonMap).filter(([, v]) => typeof v === 'string'));
      if (d.eqMap && typeof d.eqMap === 'object') state.eqMap = Object.fromEntries(Object.entries(d.eqMap).filter(([, v]) => typeof v === 'string'));
      saveLS(LS.rules, state.rules); saveLS(LS.aliases, state.aliases); saveLS(LS.overrides, state.overrides); saveLS(LS.eqMap, state.eqMap);
      compileRules(); refresh(); toast('Settings imported.');
    } catch (err) { toast('Could not read that settings file.'); }
  };
}

// ---------------------------------------------------------------- shell & theme
function applyTheme(t) {
  const root = document.documentElement;
  const effective = t || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  if (t) root.setAttribute('data-theme', t); else root.removeAttribute('data-theme');
  const btn = $('#themeBtn');
  if (btn) btn.innerHTML = icon(effective === 'dark' ? 'sun' : 'moon');
}

function renderToolbar() {
  const has = state.months.size > 0;
  $('#loader').hidden = has;
  $('#toolbar').hidden = !has;
  if (!has) return;
  const sel = $('#monthSelect');
  const months = [...state.months.values()].sort((a, b) => (a.year || 0) - (b.year || 0) || (a.month || 0) - (b.month || 0));
  sel.innerHTML = months.map(m => `<option value="${esc(m.key)}"${m.key === state.current ? ' selected' : ''}>${esc(m.label)}</option>`).join('');
  const m = state.months.get(state.current);
  $('#fileInfo').innerHTML = `<b>${esc(m.fileName)}</b><br>${m.sheetsRead.length} day sheets${esc(dateRangeLabel(m))} · ${m.blocksFound.length} blocks · ${fmt(m.records.length)} records
    <details><summary>Sheets</summary><div class="sheetlist">Read: ${m.sheetsRead.map(esc).join(', ') || '—'}${m.ignored.length ? `<br>Ignored: ${m.ignored.map(esc).join(', ')}` : ''}</div></details>`;
}

function refresh(opts = {}) {
  state.analysis = analyze(state.months.get(state.current));
  renderToolbar();
  renderReport(state.analysis);
  renderBurst(state.analysis);
  renderQuality(state.analysis);
  if (!opts.keepRules) renderRules();
  const b = $('#qualityBadge');
  if (state.analysis && state.analysis.needsReview) { b.hidden = false; b.textContent = state.analysis.needsReview; } else b.hidden = true;
}

function setTab(tab) {
  if (!['report', 'burst', 'quality', 'rules'].includes(tab)) tab = 'report';
  state.tab = tab;
  $$('.tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  $$('.panel').forEach(p => (p.hidden = p.dataset.panel !== tab));
  $('#loader').classList.toggle('dimmed', tab === 'rules');
  if (location.hash.slice(1) !== tab) history.replaceState(null, '', '#' + tab);
}

async function readFile(name, buf) {
  if (typeof XLSX === 'undefined') throw new Error('The Excel reader (SheetJS) did not load. Check your internet connection and reload.');
  const wb = XLSX.read(buf, { type: 'array', cellDates: false, cellNF: false, cellStyles: false });
  const m = parseWorkbook(wb, name);
  if (!m.daySheets.length) throw new Error(`${name}: no day sheets named 1–31 were found.`);
  state.months.set(m.key, m);
  state.current = m.key;
  return m;
}

async function handleFiles(files) {
  let ok = 0;
  for (const f of files) {
    if (!/\.xls[xm]?$/i.test(f.name)) { toast(`${f.name} is not an Excel file.`); continue; }
    try { const m = await readFile(f.name, await f.arrayBuffer()); ok++; toast(`Read ${m.records.length} records from ${f.name}`); }
    catch (e) { console.error(e); toast(e.message || `Could not read ${f.name}`); }
  }
  if (ok) { refresh(); if (state.tab === 'rules') setTab('report'); }
}

function init() {
  compileRules();
  applyTheme(loadLS(LS.theme, null));
  const themeBtn = $('#themeBtn');
  if (themeBtn) {
    themeBtn.onclick = () => {
      const cur = document.documentElement.getAttribute('data-theme')
        || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      const next = cur === 'dark' ? 'light' : 'dark';
      saveLS(LS.theme, next);
      applyTheme(next);
    };
  }

  const dlg = $('#drillDialog');
  if (dlg) {
    $('#drillClose').onclick = () => dlg.close();
    dlg.onclick = e => { if (e.target === dlg) dlg.close(); };
  }

  const input = $('#fileInput');
  input.onchange = () => { handleFiles([...input.files]); input.value = ''; };
  $('#changeBtn').onclick = () => input.click();
  $('#pdfBtn').onclick = () => {
    const m = state.analysis && state.analysis.month;
    const old = document.title;
    if (m) document.title = `Start Stop Report - ${m.label}`;
    window.print();
    setTimeout(() => (document.title = old), 500);
  };
  $('#monthSelect').onchange = e => { state.current = e.target.value; refresh(); };
  $('#sampleBtn').onclick = async () => {
    try {
      const res = await fetch('sample/START_STOP_PACKER_SAMPLE.xlsx');
      if (!res.ok) throw new Error('Sample file not found.');
      await readFile('START_STOP_PACKER_SAMPLE.xlsx', await res.arrayBuffer());
      refresh(); toast('Loaded sample data (made-up numbers).');
    } catch (e) { toast(e.message || 'Could not load the sample.'); }
  };

  const dz = $('#dropzone');
  ['dragenter', 'dragover'].forEach(ev => document.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach(ev => document.addEventListener(ev, e => { e.preventDefault(); if (ev === 'drop' || e.target === dz) dz.classList.remove('drag'); }));
  document.addEventListener('drop', e => { dz.classList.remove('drag'); if (e.dataTransfer && e.dataTransfer.files.length) handleFiles([...e.dataTransfer.files]); });

  $$('.tabs button').forEach(b => (b.onclick = () => setTab(b.dataset.tab)));
  document.addEventListener('click', e => { const g = e.target.closest('[data-goto]'); if (g) { setTab(g.dataset.goto); window.scrollTo(0, 0); } });
  window.addEventListener('hashchange', () => setTab(location.hash.slice(1)));

  refresh();
  setTab(location.hash.slice(1) || 'report');
}

// Expose the parser for tests (no data leaves the page).
compileRules();
window.StartStopAnalyzer = {
  parseTime, parseDT, normEquipment, findColumns, parseWorkbook, analyze, classify, normCause,
  suggestGroup, findSimilarCauses, compileRules,
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
