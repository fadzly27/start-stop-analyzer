# Start Stop Analyzer

A single-page web app that turns the monthly **START_STOP_PACKER_&lt;MONTH&gt;.xlsx** records of a cement packing plant into a downtime report.

**Live app:** https://fadzly27.github.io/start-stop-analyzer/

## Privacy

- Excel files are read **in your browser** with [SheetJS](https://sheetjs.com/). Nothing is uploaded to any server.
- Your rules, reason mappings and aliases are saved in your browser's `localStorage` only.
- This repository contains **no real company data**. `sample/START_STOP_PACKER_SAMPLE.xlsx` is made up (see `tools/make-sample.cjs`).

## How to use

1. Open the app and drop a monthly file onto the upload box (or click **Try with sample data**).
2. **Report** – main finding, KPI cards, unplanned downtime by machine, top 5 unplanned reasons.
3. **Burst Bag** – burst/stuck bag KPIs, Pareto of causes (first 80% highlighted), weekly trend.
4. **Data Quality** – map unclassified reasons to a Reason Group (saved for later months), see auto-fixed typos and row problems.
5. **Rules** – edit the keyword rules (regex, first match wins), saved mappings and the Burst Bag Cause alias table. Download/import settings as JSON.
6. **Export PDF** prints the Report and Burst Bag pages (choose "Save as PDF" in the print dialog).

Load more than one file to switch months with the month selector.

## Input format

- One sheet per day, named `1`–`31`. Other sheets (DDL, Sheet1, …) are ignored.
- Each sheet has blocks found by their **Stop Time** header row (no fixed row numbers). Above it: the title row containing `DAILY START STOP PACKER/PALLETIZER RECORD` with the block name in column F, and a `Date:` row (date in column F).
- Columns: Stop Time | Start Time | DT (hh:mm) | Equipment | Reason | Burst Bag Cause | Remarks.
- Times can be Excel time numbers or text such as `07:05:00AM`; typos like `4;53:00PM` are fixed and listed on the Data Quality tab.
- DT: column C if filled, otherwise Start − Stop (wrapping past midnight). Rows with neither are flagged and left out of totals.
- Equipment is matched case-insensitively to Packer 1–4 and Palletizer 1–2. "All Equipment Stopped" and "Packer and Palletizer" are grouped as **All / Shared** and left out of the per-machine charts.

## Run locally

It is a static site, so any web server works, for example:

```
npx http-server .
```

Then open http://localhost:8080. (Opening `index.html` directly also works, but **Try with sample data** needs a server.)

## Regenerate the sample file

```
npm install https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
node tools/make-sample.cjs
```
