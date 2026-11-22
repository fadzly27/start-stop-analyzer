/* Start Stop Analyzer — all processing happens in the browser. No data is sent anywhere. */
'use strict';
(() => {

// ---------------------------------------------------------------- constants
const PALLETIZERS = ['Palletizer 1', 'Palletizer 2'];
const PACKERS = ['Packer 1', 'Packer 2', 'Packer 3', 'Packer 4'];
const MACHINES = [...PALLETIZERS, ...PACKERS];
const SHARED = 'All / Shared';

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
  ['\\b(break|rehat|lunch|dinner|supper|tea ?break|meal|prayer|solat)\\b', 'Break'],
  ['house ?keeping|\\bcleaning\\b|clean ?up|\\b5s\\b', 'Housekeeping'],
  ['shift ?change|change ?over|hand ?over', 'Shift Changeover'],
  ['greas|lubric', 'Mechanical PM (Greasing)'],
  ['\\bpm\\b|planned maint|preventive|scheduled maint', 'Planned Maintenance'],
  ['calibrat|compliance|audit|weight verification', 'Compliance/Calibration'],
  ['burst|stuck bag|bag stuck|bag jam|jammed bag|bag koyak|bag pecah', 'Burst/Stuck Bag'],
  ['mis-? ?shoot', 'Mis-shooting Bag'],
  ['stretch ?hood|hood (film|plastic)', 'Stretch Hood Plastic'],
  ['flat ?film', 'Flat Film Plastic'],
  ['compressor', 'Compressor Trip'],
  ['air ?hose|hose leak|air leak', 'Air Hose Leaking (General)'],
  ['destroyer', 'Destroyer Belt Issue'],
  ['auto ?placer|bag placer', 'Auto Placer Issue'],
  ['check ?weigh', 'Check Weigher Issue'],
  ['silo|dust|bag ?filter', 'Silo/Dust Plant Issue'],
  ['spout|filling|nozzle', 'Spout/Cement Filling Issue'],
  ['packer bin|\\bbin\\b|hopper', 'Packer Bin Issue'],
  ['layer ?pusher|pusher|conveyor|roller|chain', 'Layer Pusher/Conveyor Mech'],
  ['sensor|electric|photo ?(cell|eye)|proximity|\\bplc\\b|motor|inverter|\\bvsd\\b|fuse|\\btrip', 'Sensor/Electrical Issue'],
].map(([pattern, group]) => ({ pattern, group }));

const DEFAULT_ALIASES = [{ from: 'Long conveyor', to: 'Diverter belt' }];

const LS = { rules: 'ssa.rules.v1', aliases: 'ssa.aliases.v1', overrides: 'ssa.reasonMap.v1' };
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
const cellText = v => (v == null ? '' : String(v).replace(/ /g, ' ').trim());
const normKey = s => cellText(s).toLowerCase().replace(/\s+/g, ' ');
const sentenceCase = s => { s = cellText(s).replace(/\s+/g, ' '); return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s; };
const titleCase = s => cellText(s).toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
const clock = min => {
  if (min == null) return '';
  const m = Math.round(min) % 1440, h = Math.floor(m / 60);
  return String(h).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
};
const sum = (arr, f = x => x) => arr.reduce((a, x) => a + f(x), 0);

function loadLS(key, def) {
  try { const v = localStorage.getItem(key); if (v) return JSON.parse(v); } catch (e) { /* ignore */ }
  return JSON.parse(JSON.stringify(def));
}
function saveLS(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); return true; } catch (e) { return false; }
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 4000);
}

// ---------------------------------------------------------------- state
const state = {
  months: new Map(),       // key -> parsed month
  current: null,
  tab: 'report',
  rules: loadLS(LS.rules, DEFAULT_RULES),
  aliases: loadLS(LS.aliases, DEFAULT_ALIASES),
  overrides: loadLS(LS.overrides, {}),  // normalized reason text -> group
  compiled: [],
  analysis: null,
  qFilter: { sev: '', text: '' },
  recFilter: '',
};

function compileRules() {
  state.compiled = [];
  for (const r of state.rules) {
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

function normCause(raw) {
  const key = normKey(raw);
  if (!key) return '';
  const a = state.aliases.find(x => normKey(x.from) === key && cellText(x.to));
  return a ? cellText(a.to) : sentenceCase(raw);
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
  if (!orig) return { empty: true };
  let s = orig.toUpperCase().replace(/\s+/g, ' ');
  const fixes = [];
  if (s.includes(';')) { s = s.replace(/;/g, ':'); fixes.push('";" → ":"'); }
  if (/\d\.\d/.test(s)) { s = s.replace(/(\d)\.(?=\d)/g, '$1:'); fixes.push('"." → ":"'); }
  if (/\d,\d/.test(s)) { s = s.replace(/(\d),(?=\d)/g, '$1:'); fixes.push('"," → ":"'); }
  if (/::/.test(s)) { s = s.replace(/:+/g, ':'); fixes.push('double ":"'); }
  s = s.replace(/\bA\.?M\.?$/, 'AM').replace(/\bP\.?M\.?$/, 'PM');
  const m = s.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?\s*(AM|PM)?$/);
  if (!m) {
    // a pure number typed as text, e.g. "0.2951" (Excel fraction)
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
    if (!isFinite(v) || v < 0) return { error: true, raw: String(v) };
    if (v < 1) return { min: Math.round(v * 1440 * 60) / 60 };
    return { min: v, note: 'DT was a plain number; read as minutes' };
  }
  if (v instanceof Date) return { min: v.getHours() * 60 + v.getMinutes() };
  const orig = cellText(v);
  if (!orig || /^[-–—]+$/.test(orig)) return { empty: true };
  if (/^#/.test(orig)) return { error: true, raw: orig };
  let s = orig, fixes = [];
  if (s.includes(';')) { s = s.replace(/;/g, ':'); fixes.push('";" → ":"'); }
  let m = s.match(/^(\d{1,3}):(\d{1,2})(?::(\d{1,2}))?$/);
  if (m) return { min: +m[1] * 60 + +m[2] + (+(m[3] || 0)) / 60, fixes };
  m = s.match(/^(\d+(?:\.\d+)?)\s*(min|mins|minutes|m)?$/i);
  if (m) return { min: +m[1], note: m[2] ? undefined : 'DT was a plain number; read as minutes' };
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
  const s = cellText(raw).toLowerCase().replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  const m = s.match(/^(packer|palleti[sz]er)\s*-?\s*(?:no\.?\s*)?(\d)$/);
  if (m) {
    const name = (m[1] === 'packer' ? 'Packer ' : 'Palletizer ') + m[2];
    if (MACHINES.includes(name)) return { name, type: name.startsWith('Packer') ? 'Packer' : 'Palletizer' };
  }
  if (/all equipment|^all$|^all stop|packer\s*(and|&|\/)\s*palleti[sz]er|palleti[sz]er\s*(and|&|\/)\s*packer/.test(s)) {
    return { name: SHARED, type: 'Shared' };
  }
  return { name: titleCase(s), type: 'Unknown' };
}

const TITLE_RE = /DAILY\s+START\s+STOP\s+PACKER\s*\/\s*PALLETI[SZ]ER\s+RECORD/i;
const HEADER_MATCH = {
  stop: /^stop\s*time/i, start: /^start\s*time/i, dt: /^d\.?\s*t\b|^downtime/i, equipment: /^equip/i,
  reason: /^reason/i, cause: /burst/i, remarks: /^remark/i,
};

function findColumns(row) {
  const col = {};
  const fallback = { stop: 0, start: 1, dt: 2, equipment: 3, reason: 4, cause: 5, remarks: 6 };
  for (const k of Object.keys(HEADER_MATCH)) {
    const i = row.findIndex(c => HEADER_MATCH[k].test(cellText(c)));
    col[k] = i >= 0 ? i : fallback[k];
  }
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
  const records = [], issues = [], sheetsRead = [], blocksFound = [];
  const daySheets = wb.SheetNames.filter(n => /^\s*\d{1,2}\s*$/.test(n) && +n >= 1 && +n <= 31);
  const ignored = wb.SheetNames.filter(n => !daySheets.includes(n));
  const dateVotes = new Map();
  const issue = (sev, type, sheet, row, block, detail) => issues.push({ sev, type, sheet, row, block, detail });

  for (const sn of daySheets) {
    const day = +sn.trim();
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, defval: null, blankrows: true });
    const headers = [];
    rows.forEach((r, i) => { if (r && r.some(c => /^stop\s*time$/i.test(cellText(c)))) headers.push(i); });
    if (!headers.length) { issue('warn', 'No block found', sn, null, '', 'No "Stop Time" header row on this sheet'); continue; }
    sheetsRead.push(sn);

    headers.forEach((h, bi) => {
      const col = findColumns(rows[h]);
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
      if (!block) block = `Block ${bi + 1}`;
      blocksFound.push({ sheet: sn, block, headerRow: h + 1 });

      const date = parseDateCell(dateCell);
      if (date) {
        const k = date.y + '-' + date.m; dateVotes.set(k, (dateVotes.get(k) || 0) + 1);
        if (date.d !== day) issue('info', 'Date differs from sheet', sn, null, block, `Block date is ${date.d}/${date.m}/${date.y} but sheet is "${sn}"`);
      } else {
        issue('info', 'Block date missing', sn, null, block, dateCell == null ? 'No date next to "Date:"' : `Could not read date "${cellText(dateCell)}"`);
      }
      const blockMachine = normEquipment(block);

      const end = bi + 1 < headers.length ? headers[bi + 1] : rows.length;
      for (let i = h + 1; i < end; i++) {
        const r = rows[i] || [];
        if (r.some(c => TITLE_RE.test(cellText(c)))) break;
        const get = k => (col[k] != null ? r[col[k]] : null);
        const vals = ['stop', 'start', 'dt', 'equipment', 'reason', 'cause', 'remarks'].map(k => cellText(get(k)));
        if (vals.every(v => !v)) continue;
        if (/^(total|jumlah|prepared|checked|verified)/i.test(vals[0]) || /^(total|jumlah)/i.test(vals[3])) continue;
        if (/^date\s*:?$/i.test(vals[3])) continue;

        const excelRow = i + 1;
        const rec = {
          id: records.length, day, sheet: sn, row: excelRow, block,
          date: date ? `${String(date.d).padStart(2, '0')}/${String(date.m).padStart(2, '0')}/${date.y}` : '',
          stopRaw: vals[0], startRaw: vals[1], dtRaw: vals[2],
          equipmentRaw: vals[3], reason: vals[4].replace(/\s+/g, ' '), causeRaw: vals[5], remarks: vals[6],
          stop: null, start: null, dt: null, dtSource: '', equipment: '', type: '', flags: [],
        };

        const st = parseTime(get('stop')), sa = parseTime(get('start'));
        for (const [t, label] of [[st, 'Stop Time'], [sa, 'Start Time']]) {
          if (t.fixes && t.fixes.length) {
            issue('info', 'Time typo auto-fixed', sn, excelRow, block, `${label} "${t.raw}" → ${clock(t.min)} (${t.fixes.join(', ')})`);
            rec.flags.push('typo-fixed');
          }
          if (t.error) { issue('warn', 'Unreadable time', sn, excelRow, block, `${label} "${t.raw}" could not be read`); rec.flags.push('bad-time'); }
        }
        rec.stop = st.min ?? null; rec.start = sa.min ?? null;
        const calc = rec.stop != null && rec.start != null ? ((rec.start - rec.stop + 1440) % 1440) : null;

        const dt = parseDT(get('dt'));
        if (dt.min != null) {
          rec.dt = dt.min; rec.dtSource = 'DT column';
          if (dt.fixes && dt.fixes.length) issue('info', 'Time typo auto-fixed', sn, excelRow, block, `DT "${rec.dtRaw}" → ${fmt(dt.min)} min (${dt.fixes.join(', ')})`);
          if (dt.note) issue('info', 'DT format', sn, excelRow, block, `${dt.note}: "${rec.dtRaw}"`);
          if (calc != null && Math.abs(calc - dt.min) > 1.01 && Math.abs(calc - dt.min) < 1439) {
            issue('info', 'DT differs from Start − Stop', sn, excelRow, block, `DT column ${fmt(dt.min)} min, Start − Stop = ${fmt(calc)} min (DT column used)`);
          }
        } else if (calc != null) {
          rec.dt = calc; rec.dtSource = 'Start − Stop';
          if (dt.error) issue('info', 'DT unreadable — calculated', sn, excelRow, block, `DT "${dt.raw}" unreadable; used Start − Stop = ${fmt(calc)} min`);
        } else {
          rec.dtSource = 'Missing';
          issue('error', 'Downtime missing', sn, excelRow, block, 'No DT value and Stop/Start times are incomplete — row excluded from totals');
          rec.flags.push('no-dt');
        }
        if (rec.dt != null && rec.dt > 720) issue('warn', 'Very long stop', sn, excelRow, block, `${fmt(rec.dt)} min (over 12 h) — please check`);

        let eq = normEquipment(rec.equipmentRaw);
        if (!eq) {
          if (blockMachine && blockMachine.type !== 'Unknown') {
            eq = blockMachine;
            issue('warn', 'Equipment missing', sn, excelRow, block, `No equipment — used block name "${block}"`);
          } else {
            eq = { name: '(Missing)', type: 'Unknown' };
            issue('warn', 'Equipment missing', sn, excelRow, block, 'No equipment — not counted in per-machine charts');
          }
        } else if (eq.type === 'Unknown') {
          issue('warn', 'Unknown equipment', sn, excelRow, block, `"${rec.equipmentRaw}" is not Packer 1–4, Palletizer 1–2 or All / Shared`);
        }
        rec.equipment = eq.name; rec.type = eq.type;
        if (!rec.reason) issue('warn', 'Reason missing', sn, excelRow, block, 'Reason column is empty');
        records.push(rec);
      }
    });
  }

  // month / year
  let y = null, m = null, best = 0;
  for (const [k, n] of dateVotes) if (n > best) { best = n; [y, m] = k.split('-').map(Number); }
  const fileMonth = monthFromFileName(fileName);
  if (fileMonth && m && fileMonth !== m) {
    issues.push({ sev: 'info', type: 'Month mismatch', sheet: '', row: null, block: '', detail: `File name says ${MONTHS[fileMonth - 1]} but sheet dates say ${MONTHS[m - 1]} ${y}; used the sheet dates` });
  }
  if (!m) m = fileMonth;
  const label = m ? `${MONTHS[m - 1]}${y ? ' ' + y : ''}` : fileName.replace(/\.[^.]+$/, '');
  const daysInMonth = m && y ? new Date(y, m, 0).getDate() : 31;

  return {
    key: label, label, monthName: m ? MONTHS[m - 1] : label, year: y, month: m, daysInMonth,
    fileName, daySheets, sheetsRead, ignored, blocksFound, records, issues,
  };
}

// ---------------------------------------------------------------- analysis
function analyze(month) {
  if (!month) return null;
  const recs = month.records.map(r => {
    const c = classify(r.reason);
    return { ...r, group: c.group, category: c.category, via: c.via, cause: normCause(r.causeRaw) };
  });
  const valid = recs.filter(r => r.dt != null);
  const unpl = valid.filter(r => r.category === 'Unplanned');
  const total = sum(unpl, r => r.dt);
  const planned = sum(valid.filter(r => r.category === 'Planned'), r => r.dt);
  const unclassMin = sum(valid.filter(r => r.category === UNCLASSIFIED), r => r.dt);

  const machine = {};
  for (const name of MACHINES) {
    const all = recs.filter(r => r.equipment === name);
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
  const pareto = (list) => {
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
  for (const r of recs.filter(r => r.category === UNCLASSIFIED)) {
    const k = normKey(r.reason) || '(empty)';
    const o = unclassified.get(k) || { key: k, text: r.reason || '(empty reason)', count: 0, min: 0, empty: !r.reason };
    o.count++; o.min += r.dt || 0; unclassified.set(k, o);
  }
  const unclassList = [...unclassified.values()].sort((a, b) => b.min - a.min);
  const unclassRows = recs.filter(r => r.category === UNCLASSIFIED && r.reason).length;
  const parseReview = month.issues.filter(i => i.sev !== 'info').length;
  const autoFixed = month.issues.filter(i => i.type === 'Time typo auto-fixed').length;

  const ranked = MACHINES.map(n => machine[n]).filter(x => x.min > 0).sort((a, b) => b.min - a.min);
  return {
    month, recs, valid, unpl, total, planned, unclassMin, machine, palTotal, pakTotal, sharedMin, unknownMin,
    topPal: topReasons('Palletizer'), topPak: topReasons('Packer'),
    burst, burstTotal, burstPareto, burstPalPareto, burstPakPareto, weeks, causeByMachine,
    unclassList, unclassRows, needsReview: parseReview + unclassRows, autoFixed, top: ranked[0] || null,
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
};
const icon = n => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n]}</svg>`;

function hbarRow(name, min, total, isTop, hasData, extra = '') {
  if (!hasData) {
    return `<div class="bar-row nodata-row"><span class="name">${esc(name)}</span><div class="bar-track"></div><span class="val nodata">No data</span></div>`;
  }
  const p = pct(min, total);
  return `<div class="bar-row${isTop ? ' is-top' : ''}" title="${esc(name)}: ${fmt(min)} min (${fmtPct(p)})${extra}">
    <span class="name">${esc(name)}</span>
    <div class="bar-track"><div class="bar-fill${isTop ? ' top' : ''}" style="width:${p.toFixed(2)}%"></div></div>
    <span class="val">${fmt(min)} min<span class="p">${fmtPct(p)}</span></span></div>`;
}

// ---------------------------------------------------------------- render: report
function emptyState() {
  return `<div class="empty"><h2>No file loaded</h2><p>Drop a monthly START_STOP_PACKER file above, or try the sample data.</p></div>`;
}

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

  const topTable = (t, cls) => {
    if (!t.rows.length) return '<p class="nodata">No unplanned downtime.</p>';
    return `<div class="bars reasons">${t.rows.map((r, i) => {
      const examples = [...r.texts.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3).map(x => x[0]).join(' · ');
      return hbarRow(`${i + 1}. ${r.group}`, r.min, t.total, i === 0, true, `\n${r.count} stops\nExamples: ${examples}`)
        ;
    }).join('')}</div>`;
  };

  el.innerHTML = `
    <div class="page-head">
      <div class="eyebrow">Monthly report · ${esc(m.label)}</div>
      <h1>${esc(headline)}</h1>
      <p class="lede">${machineMax} Charts and top reasons use unplanned downtime only.</p>
    </div>
    <div class="grid kpis">
      <div class="card kpi total"><div class="label">${icon("clock")}Total unplanned downtime</div>
        <div class="value">${fmt(a.total)}<small>min</small></div>
        <div class="note">${fmtH(a.total)} h${a.sharedMin ? ` · incl. ${fmt(a.sharedMin)} min All / Shared` : ''}<br>Planned ${fmt(a.planned)} min${a.unclassMin ? ` · Unclassified ${fmt(a.unclassMin)} min (not counted)` : ''}</div></div>
      <div class="card kpi pal"><div class="label">${icon("pallet")}Palletizers total</div>
        <div class="value">${fmt(a.palTotal)}<small>min</small></div>
        <div class="note">${fmtH(a.palTotal)} h · ${fmtPct(pct(a.palTotal, a.total))} of total</div></div>
      <div class="card kpi pak"><div class="label">${icon("bag")}Packers total</div>
        <div class="value">${fmt(a.pakTotal)}<small>min</small></div>
        <div class="note">${fmtH(a.pakTotal)} h · ${fmtPct(pct(a.pakTotal, a.total))} of total</div></div>
      <button class="card kpi review${reviewCls}" type="button" data-goto="quality"><div class="label">${icon(a.needsReview ? "alert" : "check")}Needs review</div>
        <div class="value">${fmt(a.needsReview)}<small>issues</small></div>
        <div class="note">${a.needsReview ? 'Open Data Quality →' : 'All rows look fine'}${a.autoFixed ? ` · ${a.autoFixed} typos auto-fixed` : ''}</div></button>
    </div>

    <div class="card">
      <div class="card-head"><h2>Unplanned downtime by machine</h2><span class="sub">Palletizers and packers each add up to 100%</span></div>
      <div class="bar-group">
        <div class="bar-group-title"><span>Palletizers</span><span>${fmt(a.palTotal)} min</span></div>
        <div class="bars">${PALLETIZERS.map(n => hbarRow(n, a.machine[n].min, a.palTotal, isTopOf(PALLETIZERS, n), a.machine[n].records > 0)).join('')}</div>
      </div>
      <div class="bar-group">
        <div class="bar-group-title"><span>Packers</span><span>${fmt(a.pakTotal)} min</span></div>
        <div class="bars">${PACKERS.map(n => hbarRow(n, a.machine[n].min, a.pakTotal, isTopOf(PACKERS, n), a.machine[n].records > 0)).join('')}</div>
      </div>
      ${a.sharedMin || a.unknownMin ? `<div class="note-box">Not in this chart: ${a.sharedMin ? `${fmt(a.sharedMin)} min All / Shared (all equipment stopped, packer and palletizer)` : ''}${a.sharedMin && a.unknownMin ? ' · ' : ''}${a.unknownMin ? `${fmt(a.unknownMin)} min with unknown equipment` : ''}.</div>` : ''}
    </div>

    <div class="grid two" style="margin-top:14px">
      <div class="card"><div class="card-head"><h2>Top 5 unplanned reasons — Palletizers</h2><span class="sub">% of ${fmt(a.topPal.total)} min</span></div>${topTable(a.topPal, 'pal')}</div>
      <div class="card"><div class="card-head"><h2>Top 5 unplanned reasons — Packers</h2><span class="sub">% of ${fmt(a.topPak.total)} min</span></div>${topTable(a.topPak, 'pak')}</div>
    </div>
    <p class="print-only fineprint">Source: ${esc(m.fileName)} · ${m.sheetsRead.length} day sheets · ${m.records.length} records · generated ${new Date().toLocaleString('en-GB')}</p>`;
}

// ---------------------------------------------------------------- render: burst bag
function renderBurst(a) {
  const el = $('#tab-burst');
  if (!a) { el.innerHTML = emptyState(); return; }
  const m = a.month, p = a.burstPareto;
  const top = p.rows[0], topPal = a.burstPalPareto.rows[0];
  const vital = p.rows.filter(r => r.vital);
  const w5 = a.weeks[4];
  el.innerHTML = `
    <div class="page-head">
      <div class="eyebrow">Burst / stuck bag · ${esc(m.label)}</div>
      <h1>${top ? `${esc(top.cause)} is the No. 1 burst bag cause in ${esc(m.monthName)}` : `No burst bag stops in ${esc(m.monthName)}`}</h1>
      ${vital.length ? `<p class="lede">${vital.length} of ${p.rows.length} causes make up the first 80% of burst/stuck bag downtime.</p>` : ''}
    </div>
    <div class="grid kpis">
      <div class="card kpi hi"><div class="label">${icon("burst")}Burst / stuck bag downtime</div>
        <div class="value">${fmt(a.burstTotal)}<small>min</small></div>
        <div class="note">${fmtH(a.burstTotal)} h · ${a.burst.length} stops · ${fmtPct(pct(a.burstTotal, a.total))} of unplanned</div></div>
      <div class="card kpi"><div class="label">${icon("trophy")}No. 1 cause</div>
        <div class="value text">${top ? esc(top.cause) : '—'}</div>
        <div class="note">${top ? `${fmt(top.min)} min · ${top.count} times · ${fmtPct(top.pct)}` : 'No data'}</div></div>
      <div class="card kpi pal"><div class="label">${icon("pallet")}No. 1 cause at palletizers</div>
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

// ---------------------------------------------------------------- render: data quality
function groupOptions(selected, withLeave = true) {
  const opt = g => `<option value="${esc(g)}"${g === selected ? ' selected' : ''}>${esc(g)}</option>`;
  return (withLeave ? `<option value="">— leave unclassified —</option>` : '') +
    `<optgroup label="Planned">${PLANNED_GROUPS.map(opt).join('')}</optgroup>` +
    `<optgroup label="Unplanned">${UNPLANNED_GROUPS.map(opt).join('')}</optgroup>`;
}

function renderQuality(a) {
  const el = $('#tab-quality');
  if (!a) { el.innerHTML = emptyState(); return; }
  const m = a.month;
  const issues = m.issues;
  const nErr = issues.filter(i => i.sev === 'error').length;
  const nWarn = issues.filter(i => i.sev === 'warn').length;
  const types = [...new Set([...issues.map(i => i.type), ...(a.unclassRows ? ['Unclassified reason'] : [])])].sort();
  const issueTotal = issues.length + a.unclassRows;
  const nInfo = issues.filter(i => i.sev === 'info').length;
  const mapped = Object.keys(state.overrides).length;

  el.innerHTML = `
    <div class="page-head">
      <div class="eyebrow">Data quality · ${esc(m.label)}</div>
      <h1>${issueTotal ? `${fmt(issueTotal)} issues found` : 'No issues found'}</h1>
      <p class="lede">${issueTotal ? `${fmt(a.needsReview)} need action · ${fmt(nInfo)} for information only. Each group says what to do.` : `All ${fmt(m.records.length)} records were read cleanly.`}</p>
    </div>
    <div class="sev-filter" role="group" aria-label="Filter by severity">
      ${[['', 'All', issueTotal], ['error', 'Errors', nErr], ['warn', 'Warnings', nWarn + a.unclassRows], ['info', 'Info', nInfo]].map(([v, l, n]) =>
        `<button type="button" class="sev-btn ${v || 'all'}" data-sev="${v}" aria-pressed="${(state.qFilter.sev || '') === v}"><b>${n}</b> ${l}</button>`).join('')}
      <input type="search" id="qText" placeholder="Search sheet, block, reason…" value="${esc(state.qFilter.text)}" aria-label="Search issues">
    </div>
    <div id="issueGroups"></div>

    <details class="card">
      <summary><h2 style="display:inline">All records</h2> <span class="sub">(${m.records.length}) — check how each row was read and classified</span></summary>
      <div class="filters" style="margin-top:12px"><input type="search" id="recText" placeholder="Filter records…" value="${esc(state.recFilter)}"></div>
      <div class="table-wrap scroll-y" id="recTable"></div>
    </details>

    <div class="card">
      <div class="card-head"><h2>File</h2></div>
      <p class="help">${esc(m.fileName)} — read ${m.sheetsRead.length} of ${m.daySheets.length} day sheets, ${m.blocksFound.length} blocks, ${m.records.length} records.
      ${m.ignored.length ? `Ignored sheets: ${m.ignored.map(esc).join(', ')}.` : ''}</p>
    </div>`;

  renderIssueGroups(a); renderRecTable(a);
  $$('.sev-btn', el).forEach(b => b.onclick = () => {
    state.qFilter.sev = b.dataset.sev;
    $$('.sev-btn', el).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    renderIssueGroups(a);
  });
  $('#qText').oninput = e => { state.qFilter.text = e.target.value; renderIssueGroups(a); };
  $('#recText').oninput = e => { state.recFilter = e.target.value; renderRecTable(a); };
  el.onchange = e => {
    const sel = e.target.closest('select[data-map]');
    if (!sel || !sel.value) return;
    state.overrides[sel.dataset.map] = sel.value; saveLS(LS.overrides, state.overrides);
    toast(`Mapped to ${sel.value}. Saved for later months.`);
    refresh();
  };
}

const ISSUE_HELP = {
  'Downtime missing': 'Fill in DT, or both Stop Time and Start Time, in Excel and load the file again. Until then these rows are left out of all totals.',
  'Unclassified reason': 'Pick a Reason Group for each text below. One choice fixes every row with that text, and it is remembered for later months.',
  'Unreadable time': 'The time cell could not be read. Correct the format in Excel (for example 07:05:00 AM).',
  'Equipment missing': 'Fill in the Equipment column: Packer 1–4, Palletizer 1–2, All Equipment Stopped, or Packer and Palletizer.',
  'Unknown equipment': 'Use one of: Packer 1–4, Palletizer 1–2, All Equipment Stopped, or Packer and Palletizer. Capital letters do not matter.',
  'Reason missing': 'Fill in the Reason column in Excel so the stop can be classified.',
  'Very long stop': 'A single stop over 12 hours. Check the times or DT in Excel.',
  'No block found': 'This day sheet has no "Stop Time" header row, so nothing was read from it.',
  'Time typo auto-fixed': 'Already corrected by the app. Fix the cell in Excel to keep the source clean.',
  'DT differs from Start − Stop': 'The DT column was used. Check which value is right.',
  'DT unreadable — calculated': 'DT could not be read, so Start − Stop was used instead.',
  'DT format': 'DT was a plain number and was read as minutes. Check that is correct.',
  'Block date missing': 'No date next to "Date:" for this block. The sheet name is used as the day.',
  'Date differs from sheet': 'The block date does not match the sheet name. The sheet name is used as the day.',
  'Month mismatch': 'The file name and the sheet dates disagree about the month.',
};
const SEV_LABEL = { error: 'Error', warn: 'Warning', info: 'Info' };
const SEV_ORDER = { error: 0, warn: 1, info: 2 };

function renderIssueGroups(a) {
  const q = state.qFilter.text.toLowerCase();
  const sev = state.qFilter.sev || '';
  const unclassIssues = a.recs.filter(r => r.category === UNCLASSIFIED && r.reason).map(r => ({
    sev: 'warn', type: 'Unclassified reason', sheet: r.sheet, row: r.row, block: r.block,
    detail: `"${r.reason}" (${r.equipment}, ${fmt(r.dt || 0)} min)`, key: normKey(r.reason),
  }));
  const list = [...a.month.issues, ...unclassIssues]
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
    return `<div class="table-wrap"><table><thead><tr><th>Reason text</th><th class="num">Rows</th><th class="num">Min</th><th>Map to Reason Group</th></tr></thead><tbody>
      ${uniq.map(u => `<tr><td><b>${esc(u.text)}</b></td><td class="num">${u.count}</td><td class="num">${fmt(u.min)}</td>
        <td><select data-map="${esc(u.key)}" aria-label="Reason group for ${esc(u.text)}">${groupOptions('')}</select></td></tr>`).join('')}
      </tbody></table></div>
      <details class="sub-details"><summary>Show all ${items.length} rows</summary>${rowsTable(items)}</details>`;
  };

  $('#issueGroups').innerHTML = ordered.length ? ordered.map(([type, items]) => {
    const sv = items[0].sev;
    return `<details class="card issue-group ${sv}" open>
      <summary>
        <span class="pill ${sv}">${SEV_LABEL[sv]}</span>
        <span class="ig-title">${esc(type)}</span>
        <span class="ig-count">${items.length} ${items.length === 1 ? 'row' : 'rows'}</span>
      </summary>
      <p class="ig-help">${esc(ISSUE_HELP[type] || '')}</p>
      ${type === 'Unclassified reason' ? unclassBody(items) : rowsTable(items)}
    </details>`;
  }).join('') : `<div class="card"><p class="nodata">${q || sev ? 'No issues match this filter.' : 'No issues. Every row was read cleanly.'}</p></div>`;
}

function renderRecTable(a) {
  const q = state.recFilter.toLowerCase();
  const list = a.recs.filter(r => !q || `${r.sheet} ${r.block} ${r.equipment} ${r.reason} ${r.group} ${r.cause} ${r.remarks}`.toLowerCase().includes(q));
  $('#recTable').innerHTML = `<table><thead><tr><th class="num">Day</th><th class="num">Row</th><th>Block</th><th>Stop</th><th>Start</th><th class="num">DT min</th><th>DT from</th><th>Equipment</th><th>Reason</th><th>Group</th><th>Category</th><th>Burst cause</th><th>Remarks</th></tr></thead><tbody>
    ${list.slice(0, 2000).map(r => `<tr><td class="num">${r.day}</td><td class="num">${r.row}</td><td>${esc(r.block)}</td>
      <td class="mono" title="${esc(r.stopRaw)}">${clock(r.stop)}</td><td class="mono" title="${esc(r.startRaw)}">${clock(r.start)}</td>
      <td class="num">${r.dt != null ? fmt(r.dt) : '<span class="pill error">missing</span>'}</td><td>${esc(r.dtSource)}</td>
      <td>${esc(r.equipment)}</td><td>${esc(r.reason)}</td><td>${esc(r.group)}${r.via === 'mapping' ? ' <span class="pill info" title="From your saved mapping">mapped</span>' : ''}</td>
      <td><span class="pill ${r.category.toLowerCase()}">${esc(r.category)}</span></td><td>${esc(r.cause)}</td><td>${esc(r.remarks)}</td></tr>`).join('')}
    </tbody></table>${list.length > 2000 ? `<p class="help">Showing first 2000 of ${list.length}.</p>` : ''}`;
}

// ---------------------------------------------------------------- render: rules
function renderRules() {
  const el = $('#tab-rules');
  const overrides = Object.entries(state.overrides).sort((a, b) => a[0].localeCompare(b[0]));
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

  $$('input[data-alias]', el).forEach(inp => inp.oninput = () => {
    state.aliases[+inp.dataset.alias][inp.dataset.field] = inp.value; saveLS(LS.aliases, state.aliases);
    clearTimeout(renderRules.a); renderRules.a = setTimeout(() => refresh({ keepRules: true }), 400);
  });
  $$('[data-del-alias]', el).forEach(b => b.onclick = () => { state.aliases.splice(+b.dataset.delAlias, 1); saveLS(LS.aliases, state.aliases); refresh(); });
  $('#addAlias').onclick = () => { state.aliases.push({ from: '', to: '' }); saveLS(LS.aliases, state.aliases); renderRules(); };
  $('#resetAliases').onclick = () => { if (confirm('Replace the alias table with the defaults?')) { state.aliases = JSON.parse(JSON.stringify(DEFAULT_ALIASES)); saveLS(LS.aliases, state.aliases); refresh(); } };

  $('#exportSettings').onclick = () => {
    const blob = new Blob([JSON.stringify({ app: 'start-stop-analyzer', version: 1, rules: state.rules, aliases: state.aliases, reasonMap: state.overrides }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'start-stop-analyzer-settings.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $('#importSettings').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (Array.isArray(d.rules)) state.rules = d.rules.filter(r => r && typeof r.pattern === 'string' && typeof r.group === 'string');
      if (Array.isArray(d.aliases)) state.aliases = d.aliases.filter(a => a && typeof a.from === 'string');
      if (d.reasonMap && typeof d.reasonMap === 'object') state.overrides = Object.fromEntries(Object.entries(d.reasonMap).filter(([, v]) => typeof v === 'string'));
      saveLS(LS.rules, state.rules); saveLS(LS.aliases, state.aliases); saveLS(LS.overrides, state.overrides);
      compileRules(); refresh(); toast('Settings imported.');
    } catch (err) { toast('Could not read that settings file.'); }
  };
}

// ---------------------------------------------------------------- shell
function renderToolbar() {
  const has = state.months.size > 0;
  $('#loader').hidden = has;
  $('#toolbar').hidden = !has;
  if (!has) return;
  const sel = $('#monthSelect');
  const months = [...state.months.values()].sort((a, b) => (a.year || 0) - (b.year || 0) || (a.month || 0) - (b.month || 0));
  sel.innerHTML = months.map(m => `<option value="${esc(m.key)}"${m.key === state.current ? ' selected' : ''}>${esc(m.label)}</option>`).join('');
  const m = state.months.get(state.current);
  $('#fileInfo').innerHTML = `<b>${esc(m.fileName)}</b><br>${m.sheetsRead.length} day sheets · ${m.blocksFound.length} blocks · ${fmt(m.records.length)} records read
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
  if (!state.analysis) $('#tab-report').innerHTML = '';
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
window.StartStopAnalyzer = { parseTime, parseDT, normEquipment, parseWorkbook, analyze, classify, normCause };

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
