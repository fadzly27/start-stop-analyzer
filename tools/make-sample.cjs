/*
 * Generates sample/START_STOP_PACKER_SAMPLE.xlsx with MADE-UP data for the demo.
 * Nothing here comes from a real plant.
 *
 *   npm install https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
 *   node tools/make-sample.cjs
 */
'use strict';
const path = require('path');
const XLSX = require('xlsx');

// Deterministic pseudo-random numbers so the sample is the same every run.
let seed = 20251001;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = arr => arr[Math.floor(rnd() * arr.length)];
const wpick = list => { const t = list.reduce((a, x) => a + x[1], 0); let r = rnd() * t; for (const [v, w] of list) { if ((r -= w) <= 0) return v; } return list[0][0]; };
const between = (a, b) => a + Math.floor(rnd() * (b - a + 1));

const YEAR = 2025, MONTH = 10, DAYS = 31; // October 2025 (fictional)

const PAL_REASONS = [
  [['Bag burst at diverter', 'burst'], 14], [['Stuck bag at layer pusher', 'burst'], 8], [['Bag stuck at turning device', 'burst'], 5],
  [['Stretch hood plastic torn', null], 7], [['Flat film plastic roll change', null], 4], [['Layer pusher jammed', null], 5],
  [['Conveyor chain loose', null], 3], [['Photo eye sensor fault', null], 4], [['Compressor trip', null], 2],
  [['Air hose leaking at gripper', null], 2], [['Waiting for pallet supply', null], 3], [['Forklift not available', null], 1],
];
const PAK_REASONS = [
  [['Bag burst at spout', 'burst'], 9], [['Mis-shooting bag', null], 7], [['Spout blocked, cement filling slow', null], 5],
  [['Destroyer belt slip', null], 3], [['Auto placer missed bag', null], 5], [['Packer bin low level', null], 3],
  [['Silo aeration problem / dust plant trip', null], 2], [['Check weigher reject high', null], 3],
  [['Motor overload trip', null], 2], [['Empty bag magazine', null], 2],
];
const PLANNED = [['Break', 30], ['Housekeeping', 20], ['Shift changeover', 15], ['Greasing (mechanical PM)', 25],
  ['Planned maintenance', 120], ['Check weigher calibration', 30]];
const PAL_CAUSES = [['Long conveyor', 10], ['Diverter belt', 4], ['bag destroyer', 3], ['BAG QUALITY', 3], ['Turning device', 2], ['long conveyor', 2]];
const PAK_CAUSES = [['Spout', 6], ['bag quality', 4], ['Auto placer', 3], ['Bag Destroyer', 1]];

const EQ_STYLE = name => wpick([[name, 6], [name.toUpperCase(), 3], [name.toLowerCase(), 1]]);

function timeCell(min, style) {
  min = ((min % 1440) + 1440) % 1440;
  const h = Math.floor(min / 60), m = min % 60, h12 = ((h + 11) % 12) + 1, ap = h < 12 ? 'AM' : 'PM';
  const pad = n => String(n).padStart(2, '0');
  if (style === 'num') return { t: 'n', v: min / 1440, z: 'h:mm AM/PM' };
  if (style === 'typo') return { t: 's', v: `${h12};${pad(m)}:00${ap}` };
  return { t: 's', v: `${pad(h12)}:${pad(m)}:00${ap}` };
}

function makeEvents(day, kind) {
  const ev = [];
  const machines = kind === 'pal' ? [['Palletizer 1', 1], ['Palletizer 2', 1.6]] : [['Packer 1', 1], ['Packer 2', 1.2], ['Packer 3', 0.8], ['Packer 4', 0]];
  // Packer 4 is idle this month (shows "No data")
  for (const [name, weight] of machines) {
    if (!weight) continue;
    const n = Math.round(between(1, 3) * weight);
    for (let i = 0; i < n; i++) {
      const [reason, isBurst] = wpick(kind === 'pal' ? PAL_REASONS : PAK_REASONS);
      const dur = isBurst ? between(5, 35) : between(5, 60);
      ev.push({ eq: name, reason, dur, cause: isBurst ? wpick(kind === 'pal' ? PAL_CAUSES : PAK_CAUSES) : '', stop: between(0, 1439) });
    }
    if (rnd() < 0.55) { const [r, d] = pick(PLANNED); ev.push({ eq: name, reason: r, dur: d, cause: '', stop: between(360, 1300) }); }
  }
  if (rnd() < 0.12) ev.push({ eq: kind === 'pal' ? 'All Equipment Stopped' : 'Packer and Palletizer', reason: 'Power dip from supply', dur: between(10, 40), cause: '', stop: between(0, 1439) });
  if (day === 5 && kind === 'pak') ev.push({ eq: 'Packer 2', reason: 'Lorry queue', dur: 25, cause: '', stop: 600 });
  if (day === 17 && kind === 'pal') ev.push({ eq: 'Palletizer 1', reason: 'Night shift', dur: 20, cause: '', stop: 1430 }); // past midnight
  return ev.sort((a, b) => a.stop - b.stop);
}

function blockRows(day, kind, rowsOut, cellFmt) {
  const r0 = rowsOut.length;
  rowsOut.push(['DAILY START STOP PACKER/PALLETIZER RECORD', null, null, null, null, kind === 'pal' ? 'PALLETIZER' : 'PACKER']);
  rowsOut.push([null, null, null, null, 'Date:', { t: 'n', v: dateSerial(YEAR, MONTH, day), z: 'dd/mm/yyyy' }]);
  rowsOut.push(['Stop Time', 'Start Time', 'DT (hh:mm)', 'Equipment', 'Reason', 'Burst Bag Cause', 'Remarks']);
  const ev = makeEvents(day, kind);
  ev.forEach((e, i) => {
    const style = wpick([['num', 6], ['text', 3], ['typo', 0.35]]);
    let stop = timeCell(e.stop, style), start = timeCell(e.stop + e.dur, style === 'typo' ? 'text' : style);
    let dt = rnd() < 0.8 ? { t: 'n', v: e.dur / 1440, z: '[h]:mm' } : null;
    // one row per month with nothing to compute from
    if (day === 12 && kind === 'pak' && i === 0) { start = null; dt = null; }
    const remarks = rnd() < 0.15 ? pick(['Informed technician', 'Monitor', 'Done by mechanical', 'Reset OK']) : null;
    rowsOut.push([stop, start, dt, EQ_STYLE(e.eq), e.reason, e.cause || null, remarks]);
  });
  // leave the empty pre-printed rows that the real forms have
  for (let i = 0; i < 4; i++) rowsOut.push([]);
  return r0;
}

function dateSerial(y, m, d) { return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000; }

function toSheet(rows) {
  const ws = {};
  let maxC = 0;
  rows.forEach((r, R) => r.forEach((v, C) => {
    if (v == null) return;
    ws[XLSX.utils.encode_cell({ r: R, c: C })] = typeof v === 'object' ? v : { t: typeof v === 'number' ? 'n' : 's', v };
    maxC = Math.max(maxC, C);
  }));
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(rows.length - 1, 0), c: Math.max(maxC, 6) } });
  ws['!cols'] = [{ wch: 13 }, { wch: 13 }, { wch: 11 }, { wch: 22 }, { wch: 36 }, { wch: 18 }, { wch: 22 }];
  return ws;
}

const wb = XLSX.utils.book_new();
for (let day = 1; day <= DAYS; day++) {
  const rows = [];
  for (let i = 0; i < day % 3; i++) rows.push([]); // blocks start on different rows on each sheet
  if (day % 4 === 0) rows.push(['SAMPLE PLANT — FICTIONAL DATA']);
  blockRows(day, 'pal', rows);
  rows.push([]);
  blockRows(day, 'pak', rows);
  XLSX.utils.book_append_sheet(wb, toSheet(rows), String(day));
}
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Equipment'], ['Packer 1'], ['Packer 2'], ['Packer 3'], ['Packer 4'], ['Palletizer 1'], ['Palletizer 2']]), 'DDL');
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Scratch sheet — ignored by the analyzer']]), 'Sheet1');

const out = path.join(__dirname, '..', 'sample', 'START_STOP_PACKER_SAMPLE.xlsx');
require('fs').mkdirSync(path.dirname(out), { recursive: true });
XLSX.writeFile(wb, out);
console.log('Wrote', out);
