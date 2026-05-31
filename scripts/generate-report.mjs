import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const targetDateArg = process.argv.find((arg) => arg.startsWith("--date="))?.split("=")[1];

const etfs = [
  ["SPY", "etf"], ["QQQ", "etf"], ["DIA", "etf"], ["IWM", "etf"], ["XLK", "etf"],
  ["XLC", "etf"], ["XLY", "etf"], ["XLF", "etf"], ["XLI", "etf"], ["XLV", "etf"],
  ["XLP", "etf"], ["XLE", "etf"], ["XLU", "etf"], ["XLB", "etf"], ["XLRE", "etf"],
  ["SMH", "etf"], ["SOXX", "etf"], ["IGV", "etf"], ["CIBR", "etf"], ["HACK", "etf"],
  ["CLOU", "etf"], ["WCLD", "etf"], ["BOTZ", "etf"], ["AIQ", "etf"], ["IWO", "etf"],
  ["IWN", "etf"], ["RSP", "etf"], ["SCHG", "etf"], ["VTV", "etf"], ["GLD", "etf"],
  ["UUP", "etf"], ["IBIT", "etf"], ["ETHA", "etf"], ["USO", "etf"], ["BNO", "etf"]
];

const stockSymbols = [
  "DELL", "MSFT", "AVGO", "AMZN", "COST", "NVDA", "AMD", "MRVL", "VRT", "ANET",
  "SMCI", "GOOGL", "AAPL", "META", "TSLA", "CRM", "NOW", "SNOW", "ORCL", "ADBE",
  "PANW", "CRWD", "PLTR", "DDOG", "NET", "CEG", "VST", "ETN", "PWR", "GEV",
  "FLNC", "OKLO", "APLD", "IREN"
];
const stocks = stockSymbols.map((symbol) => [symbol, "stocks"]);

const sectors = [
  ["信息技术", "XLK", "科技/AI"], ["通信服务", "XLC", "互联网/媒体"], ["可选消费", "XLY", "消费权重"],
  ["金融", "XLF", "顺周期"], ["工业", "XLI", "工业链"], ["医疗保健", "XLV", "防御"],
  ["必需消费", "XLP", "防御消费"], ["能源", "XLE", "油价"], ["公用事业", "XLU", "利率敏感"],
  ["材料", "XLB", "周期"], ["房地产", "XLRE", "利率敏感"]
];

const themes = [
  ["半导体", "SMH"], ["软件", "IGV"], ["网络安全", "CIBR"], ["云计算", "WCLD"],
  ["AI/自动化", "AIQ"], ["机器人", "BOTZ"], ["小盘成长", "IWO"], ["小盘价值", "IWN"],
  ["等权标普", "RSP"], ["大盘成长", "SCHG"], ["大盘价值", "VTV"]
];

const watchGroups = [
  ["核心科技 / AI", ["NVDA", "AMD", "AVGO", "MRVL", "GOOGL", "MSFT", "META", "AMZN", "ORCL"]],
  ["软件 / SaaS / AI 应用", ["CRM", "NOW", "SNOW", "ADBE", "PANW", "CRWD", "PLTR", "DDOG", "NET"]],
  ["AI 电力 / 数据中心", ["FLNC", "OKLO", "VST", "CEG", "ETN", "VRT", "PWR", "GEV", "APLD", "IREN"]]
];

function fmtPct(value) {
  if (!Number.isFinite(value)) return "暂无可靠数据";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function fmtNum(value, digits = 2) {
  if (!Number.isFinite(value)) return "暂无可靠数据";
  return value.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function fmtVol(value) {
  if (!Number.isFinite(value)) return "暂无可靠数据";
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(2)}K`;
  return String(value);
}

function classFor(value) {
  if (!Number.isFinite(value)) return "";
  if (value > 0) return "good";
  if (value < 0) return "bad";
  return "";
}

function parseStockRow(text) {
  const row = {};
  for (const key of ["a", "c", "h", "l", "o", "v", "ch"]) {
    const m = text.match(new RegExp(`${key}:([-0-9.]+)`));
    if (m) row[key] = Number(m[1]);
  }
  const t = text.match(/t:"([^"]+)"/);
  if (t) row.t = t[1];
  return row;
}

async function fetchStockAnalysis(symbol, kind) {
  const url = `https://stockanalysis.com/${kind}/${symbol.toLowerCase()}/history/`;
  const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`${symbol} ${res.status}`);
  const html = await res.text();
  const matches = [...html.matchAll(/\{a:[^{}]*?t:"\d{4}-\d{2}-\d{2}"[^{}]*?\}/g)];
  const rows = matches.map((match) => parseStockRow(match[0])).filter((row) => row.t);
  if (!rows.length) throw new Error(`${symbol} no rows`);
  const row = targetDateArg ? rows.find((candidate) => candidate.t === targetDateArg) : rows[0];
  if (!row) throw new Error(`${symbol} no row for ${targetDateArg}`);
  return [symbol, { symbol, kind, url, row, rows }];
}

async function mapLimit(items, limit, worker) {
  const result = [];
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        result[index] = await worker(items[index]);
      } catch (error) {
        result[index] = [items[index][0], { symbol: items[index][0], error: error.message }];
      }
    }
  }
  await Promise.all(Array.from({ length: limit }, run));
  return Object.fromEntries(result);
}

async function fetchTreasury(reportDate) {
  const month = reportDate.slice(0, 7).replace("-", "");
  const url = `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value_month=${month}`;
  let xml = "";
  try {
    xml = await (await fetch(url)).text();
  } catch (error) {
    console.warn(`Treasury fetch failed: ${error.message}`);
    return { url, current: undefined, previous: undefined };
  }
  const entries = [...xml.matchAll(/<m:properties>([\s\S]*?)<\/m:properties>/g)].map((entry) => {
    const body = entry[1];
    const get = (name) => {
      const m = body.match(new RegExp(`<d:${name}[^>]*>([^<]+)</d:${name}>`));
      return m ? m[1] : "";
    };
    return {
      date: get("NEW_DATE").slice(0, 10),
      y2: Number(get("BC_2YEAR")),
      y10: Number(get("BC_10YEAR")),
      y30: Number(get("BC_30YEAR"))
    };
  }).filter((row) => row.date <= reportDate);
  return { url, current: entries.at(-1), previous: entries.at(-2) };
}

async function fetchVix(reportDate) {
  const url = "https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv";
  let csv = "";
  try {
    csv = await (await fetch(url)).text();
  } catch (error) {
    console.warn(`VIX fetch failed: ${error.message}`);
    return { url, current: undefined, previous: undefined };
  }
  const rows = csv.trim().split(/\r?\n/).slice(1).map((line) => {
    const [date, open, high, low, close] = line.split(",");
    const [mm, dd, yyyy] = date.split("/");
    return {
      date: `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`,
      open: Number(open), high: Number(high), low: Number(low), close: Number(close)
    };
  }).filter((row) => row.date <= reportDate);
  return { url, current: rows.at(-1), previous: rows.at(-2) };
}

async function archiveCurrent(reportDate) {
  const indexPath = path.join(root, "index.html");
  if (!existsSync(indexPath)) return;
  const current = await readFile(indexPath, "utf8");
  const date = current.match(/美股收盘日报[｜-](\d{4}-\d{2}-\d{2})/)?.[1] || current.match(/(\d{4}-\d{2}-\d{2})/)?.[1];
  if (!date || date === reportDate) return;
  const archiveDir = path.join(root, "archive");
  await mkdir(archiveDir, { recursive: true });
  const archivePath = path.join(archiveDir, `${date}.html`);
  if (!existsSync(archivePath)) await copyFile(indexPath, archivePath);
}

async function writeArchiveIndex(reportDate) {
  const archiveDir = path.join(root, "archive");
  await mkdir(archiveDir, { recursive: true });
  const index = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>美股日报归档</title><style>body{font-family:Arial,"Microsoft YaHei",sans-serif;margin:40px;background:#eef3f6;color:#16202a}main{max-width:760px;margin:auto;background:white;border:1px solid #d8e1e7;border-radius:10px;padding:28px;box-shadow:0 20px 50px rgba(15,32,44,.12)}a{color:#057d8d;font-weight:700}</style></head><body><main><h1>美股日报归档</h1><p>最新日报：<a href="../index.html">${reportDate}</a></p><p>历史文件会按日期保存在本目录。</p></main></body></html>`;
  await writeFile(path.join(archiveDir, "index.html"), index, "utf8");
}

function row(data, symbol) {
  return data[symbol]?.row;
}

function rows(data, symbol) {
  return data[symbol]?.rows || [];
}

function average(values) {
  const clean = values.filter(Number.isFinite);
  if (!clean.length) return NaN;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

function ma(data, symbol, length) {
  return average(rows(data, symbol).slice(0, length).map((item) => item.c));
}

function avgVol(data, symbol, length = 20) {
  return average(rows(data, symbol).slice(0, length).map((item) => item.v));
}

function volumeRatio(data, symbol) {
  const r = row(data, symbol);
  const avg = avgVol(data, symbol);
  return Number.isFinite(r?.v) && Number.isFinite(avg) && avg > 0 ? r.v / avg : NaN;
}

function rangePosition(r) {
  if (!r || !Number.isFinite(r.h) || !Number.isFinite(r.l) || r.h === r.l) return "暂无可靠数据";
  const pos = (r.c - r.l) / (r.h - r.l);
  if (pos >= 0.72) return "收在日内高位";
  if (pos <= 0.28) return "收在日内低位";
  return "收在日内中段";
}

function trendLabel(data, symbol) {
  const r = row(data, symbol);
  const ma20 = ma(data, symbol, 20);
  const ma50 = ma(data, symbol, 50);
  if (!r || !Number.isFinite(ma20) || !Number.isFinite(ma50)) return "暂无可靠数据";
  if (r.c > ma20 && ma20 > ma50) return "短中期多头";
  if (r.c > ma20) return "站上20日线";
  if (r.c < ma20 && ma20 < ma50) return "短中期偏弱";
  return "震荡观察";
}

function support(data, symbol) {
  const history = rows(data, symbol).slice(0, 20);
  return history.length ? Math.min(...history.map((item) => item.l)) : NaN;
}

function resistance(data, symbol) {
  const history = rows(data, symbol).slice(0, 20);
  return history.length ? Math.max(...history.map((item) => item.h)) : NaN;
}

function safeText(value) {
  return value || "暂无可靠数据";
}

function tableRow(symbol, label, data, note = "") {
  const r = row(data, symbol);
  if (!r) return `<tr><td>${label}</td><td colspan="6">暂无可靠数据</td></tr>`;
  return `<tr><td>${label}</td><td>${fmtNum(r.c)}</td><td class="${classFor(r.ch)}">${fmtPct(r.ch)}</td><td>${fmtNum(r.l)} - ${fmtNum(r.h)}</td><td>${fmtVol(r.v)}</td><td>${rangePosition(r)}</td><td>${note}</td></tr>`;
}

function sectorRow(item, index, data) {
  const [name, symbol, driver] = item;
  const r = row(data, symbol);
  const spy = row(data, "SPY");
  return `<tr><td>${index + 1}</td><td>${name}</td><td>${symbol}</td><td class="${classFor(r?.ch)}">${fmtPct(r?.ch)}</td><td>${fmtNum(r?.c)}</td><td>${fmtNum(r?.l)} - ${fmtNum(r?.h)}</td><td>${r?.ch > spy?.ch ? "跑赢" : "跑输"}</td><td>${driver}</td></tr>`;
}

function assetRow(name, symbol, data, note) {
  const r = row(data, symbol);
  return `<tr><td>${name}</td><td>${symbol}</td><td>${fmtNum(r?.c)}</td><td class="${classFor(r?.ch)}">${fmtPct(r?.ch)}</td><td>${note}</td></tr>`;
}

function themeRow(item, data) {
  const [name, symbol] = item;
  const r = row(data, symbol);
  const spy = row(data, "SPY");
  return `<tr><td>${name}</td><td>${symbol}</td><td class="${classFor(r?.ch)}">${fmtPct(r?.ch)}</td><td>${fmtNum(r?.c)}</td><td>${fmtNum(r?.l)} - ${fmtNum(r?.h)}</td><td>${r?.ch > spy?.ch ? "跑赢大盘" : "跑输大盘"}</td></tr>`;
}

function technicalRow(symbol, name, data) {
  const r = row(data, symbol);
  return `<tr><td>${name}</td><td>${symbol}</td><td>${fmtNum(r?.c)}</td><td>${fmtNum(ma(data, symbol, 20))}</td><td>${fmtNum(ma(data, symbol, 50))}</td><td>${fmtNum(ma(data, symbol, 100))}</td><td>${fmtNum(ma(data, symbol, 200))}</td><td>${fmtNum(support(data, symbol))}</td><td>${fmtNum(resistance(data, symbol))}</td><td>${trendLabel(data, symbol)}</td></tr>`;
}

function stockTag(data, symbol) {
  const r = row(data, symbol);
  const vr = volumeRatio(data, symbol);
  if (!r) return "暂无可靠数据";
  if (r.ch > 8 && vr > 1.2) return "放量强势";
  if (r.ch > 5) return "继续强势";
  if (r.ch < -5 && vr > 1.2) return "放量破位风险";
  if (r.ch < -3) return "破位风险";
  if (r.c > ma(data, symbol, 20)) return "趋势观察";
  return "需要观察";
}

function stockRow(symbol, group, data, note = "") {
  const r = row(data, symbol);
  return `<tr><td>${symbol}</td><td>${group}</td><td>${fmtNum(r?.c)}</td><td class="${classFor(r?.ch)}">${fmtPct(r?.ch)}</td><td>${fmtNum(r?.l)} - ${fmtNum(r?.h)}</td><td>${fmtVol(r?.v)}</td><td>${fmtNum(volumeRatio(data, symbol), 2)}x</td><td>${safeText(note)}</td><td>${stockTag(data, symbol)}</td></tr>`;
}

function topMovers(data, symbols, count = 8) {
  return symbols
    .map((symbol) => [symbol, row(data, symbol)])
    .filter(([, r]) => r)
    .sort((a, b) => Math.abs(b[1].ch) - Math.abs(a[1].ch))
    .slice(0, count);
}

function renderHtml({ reportDate, data, treasury, vix }) {
  const spy = row(data, "SPY");
  const qqq = row(data, "QQQ");
  const iwm = row(data, "IWM");
  const rsp = row(data, "RSP");
  const igv = row(data, "IGV");
  const cibr = row(data, "CIBR");
  const wcld = row(data, "WCLD");
  const smh = row(data, "SMH");
  const nvda = row(data, "NVDA");
  const treasuryCurrent = treasury.current;
  const treasuryPrev = treasury.previous;
  const vixCurrent = vix.current;
  const vixPrev = vix.previous;
  const vixChange = vixCurrent && vixPrev ? ((vixCurrent.close / vixPrev.close - 1) * 100) : NaN;
  const y210 = treasuryCurrent ? Math.round((treasuryCurrent.y10 - treasuryCurrent.y2) * 100) : NaN;
  const y1030 = treasuryCurrent ? Math.round((treasuryCurrent.y30 - treasuryCurrent.y10) * 100) : NaN;
  const sectorStats = sectors.map((sector, index) => ({ sector, index, ch: row(data, sector[1])?.ch })).sort((a, b) => (b.ch ?? -999) - (a.ch ?? -999));
  const positiveSectors = sectorStats.filter((item) => item.ch > 0).length;
  const strongestSector = sectorStats[0];
  const weakestSector = sectorStats.at(-1);
  const movers = topMovers(data, stockSymbols, 10);
  const breadthTone = positiveSectors >= 7 && rsp?.ch > 0 ? "宽度较健康" : positiveSectors >= 5 ? "宽度中性" : "宽度偏弱";
  const marketPhase = igv?.ch > spy?.ch && smh?.ch < spy?.ch ? "软件补涨 / 成长内部轮动" : smh?.ch > spy?.ch ? "AI硬件主线仍强" : iwm?.ch > spy?.ch ? "小盘参与改善" : "指数主导，内部仍需确认";

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>美股收盘日报｜${reportDate}</title>
  <style>
    :root{--page:#eef3f6;--ink:#16202a;--muted:#667789;--line:#d8e1e7;--side:#101922;--side2:#162535;--accent:#00a7b5;--accent2:#d89b36;--good:#11845b;--bad:#c43d32;--warn:#a56a00;--shadow:0 24px 70px rgba(15,32,44,.14)}
    *{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;color:var(--ink);background:linear-gradient(rgba(18,39,54,.045) 1px,transparent 1px),linear-gradient(90deg,rgba(18,39,54,.045) 1px,transparent 1px),radial-gradient(circle at 72% 8%,rgba(0,167,181,.16),transparent 30%),linear-gradient(135deg,#f8fbfc 0%,var(--page) 52%,#e9eff2 100%);background-size:28px 28px,28px 28px,auto,auto;font-family:"Microsoft YaHei","PingFang SC","Noto Sans SC",Arial,sans-serif;line-height:1.65}.app-shell{display:grid;grid-template-columns:292px minmax(0,1fr);min-height:100vh}aside{position:sticky;top:0;height:100vh;padding:28px 20px;background:linear-gradient(180deg,rgba(0,167,181,.16),transparent 28%),linear-gradient(180deg,var(--side2),var(--side));color:#dce8ee;overflow-y:auto}.brand{padding-bottom:22px;border-bottom:1px solid rgba(255,255,255,.12);margin-bottom:18px}.eyebrow{margin:0 0 7px;color:var(--accent2);font-size:12px;font-weight:800;text-transform:uppercase}.brand h1{margin:0 0 8px;color:white;font-size:23px}.brand p{margin:0;color:#9fb3c1;font-size:13px}nav{display:grid;gap:5px}nav a{display:block;padding:8px 10px;border-radius:7px;color:#b8c7d1;font-size:13px;text-decoration:none}nav a:hover{background:rgba(255,255,255,.07);color:white}button{width:100%;min-height:40px;margin-top:18px;border:1px solid rgba(0,167,181,.75);border-radius:7px;background:linear-gradient(135deg,#00a7b5,#087f92);color:#fff;font:inherit;font-weight:700}main{padding:42px min(5vw,68px) 84px}.report{max-width:1160px;margin:auto;padding:54px;border:1px solid var(--line);border-radius:10px;background:rgba(255,255,255,.9);box-shadow:var(--shadow)}.cover{display:grid;grid-template-columns:minmax(0,1fr) 310px;gap:28px;align-items:end;padding:28px;border:1px solid rgba(0,167,181,.22);border-radius:10px;margin:-18px -18px 34px;background:linear-gradient(135deg,rgba(0,167,181,.1),rgba(216,155,54,.08)),linear-gradient(180deg,#fff,#f6fbfc)}.cover h2{margin:0 0 14px;font-size:40px;line-height:1.16}.subtitle{margin:0;color:#516476;font-size:15px}.meta-card{display:grid;gap:10px;padding:18px;border:1px solid rgba(0,167,181,.24);border-radius:8px;background:rgba(255,255,255,.78);font-size:13px}.meta-row{display:flex;justify-content:space-between;gap:14px;border-bottom:1px solid var(--line);padding-bottom:8px}.meta-row:last-child{border:0;padding:0}.section{padding:30px 0;border-bottom:1px solid var(--line)}.section:last-child{border:0}.section-head{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:16px}h3{margin:0;font-size:22px}h4{margin:22px 0 10px}.section-num{padding:2px 8px;border:1px solid rgba(0,167,181,.22);border-radius:999px;color:#087f92;background:#effbfc;font-size:12px;font-weight:800}.callout{padding:18px 20px;border:1px solid rgba(0,167,181,.22);border-left:4px solid var(--accent);border-radius:8px;background:linear-gradient(135deg,#f1fbfc,#fffaf0)}.grid-2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.grid-3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.mini-panel{min-height:116px;padding:16px;border:1px solid var(--line);border-radius:8px;background:linear-gradient(180deg,#fff,#f8fbfc)}.mini-panel strong{display:block;margin-bottom:8px;color:#057d8d}.mini-panel p{margin:0;color:var(--muted);font-size:14px}.table-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:8px;background:white;box-shadow:0 12px 28px rgba(16,32,44,.07)}table{width:100%;min-width:760px;border-collapse:collapse;font-size:13px}th,td{padding:10px 11px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}th{background:#eaf4f7;color:#273746;font-weight:800;white-space:nowrap}tbody tr:hover{background:#f7fbfc}.good{color:var(--good);font-weight:800}.bad{color:var(--bad);font-weight:800}.warn{color:var(--warn);font-weight:800}.list{margin:10px 0 0;padding-left:20px;color:var(--muted);font-size:14px}.source-box{margin-top:16px;padding:14px 16px;border:1px dashed rgba(0,167,181,.5);border-radius:8px;background:linear-gradient(135deg,rgba(0,167,181,.06),rgba(216,155,54,.06));color:var(--muted);font-size:13px}.source-box a{color:#057d8d;font-weight:700}@media(max-width:980px){.app-shell{display:block}aside{position:static;height:auto}nav{grid-template-columns:repeat(2,minmax(0,1fr))}main{padding:24px 16px 48px}.report{padding:28px 20px}.cover,.grid-2,.grid-3{grid-template-columns:1fr}.cover{margin:0 0 28px;padding:20px}.cover h2{font-size:30px}}@media print{body{background:#fff}aside{display:none}.app-shell{display:block}main{padding:0}.report{max-width:none;padding:0;border:0;box-shadow:none}.section{break-inside:avoid}}
  </style>
</head>
<body><div class="app-shell"><aside><div class="brand"><p class="eyebrow">US Market Daily</p><h1>美股收盘日报</h1><p>自动生成：行情来自 StockAnalysis/Tiingo，美债来自美国财政部，VIX 来自 Cboe。</p></div><nav><a href="#summary">0. 一句话总结</a><a href="#index">1. 大盘表现</a><a href="#intraday">2. 盘中走势</a><a href="#macro">3. 宏观环境</a><a href="#sector">4. 板块表现</a><a href="#theme">5. 主题风格</a><a href="#breadth">6. 市场宽度</a><a href="#technical">7. 技术面</a><a href="#movers">8. 个股异动</a><a href="#earnings">9. 财报日历</a><a href="#flow">10. 机构资金</a><a href="#rotation">11. 板块轮动</a><a href="#watchlist">12. 关注股</a><a href="#plan">13. 交易计划</a><a href="#risk">14. 风险提示</a><a href="#conclusion">15. 最终结论</a><a href="#archive">归档</a></nav><button onclick="window.print()">打印 / 导出 PDF</button></aside><main><article class="report">
<header class="cover"><div><p class="eyebrow">自动收盘复盘</p><h2>美股收盘日报｜${reportDate}</h2><p class="subtitle">本版恢复完整报告结构，并用可自动获取的数据填充大盘、宏观、美债、VIX、板块、主题、技术面、成交量和重点个股观察。无法稳定公开抓取的新闻/财报/机构观点会明确标注为待接入 API。</p></div><div class="meta-card"><div class="meta-row"><span>交易日</span><strong>${reportDate}</strong></div><div class="meta-row"><span>SPY</span><strong>${fmtPct(spy?.ch)}</strong></div><div class="meta-row"><span>QQQ</span><strong>${fmtPct(qqq?.ch)}</strong></div><div class="meta-row"><span>VIX</span><strong>${fmtNum(vixCurrent?.close)}</strong></div></div></header>
<section class="section" id="summary"><div class="section-head"><h3>今日一句话总结</h3><span class="section-num">00</span></div><div class="callout"><p>SPY ${fmtPct(spy?.ch)}，QQQ ${fmtPct(qqq?.ch)}，IWM ${fmtPct(iwm?.ch)}。软件 IGV ${fmtPct(igv?.ch)}，网络安全 CIBR ${fmtPct(cibr?.ch)}，云计算 WCLD ${fmtPct(wcld?.ch)}；半导体 SMH ${fmtPct(smh?.ch)}，NVDA ${fmtPct(nvda?.ch)}。</p><p><strong>今日市场状态：</strong>${marketPhase}；${breadthTone}；VIX ${fmtPct(vixChange)}，10Y 美债 ${fmtNum(treasuryCurrent?.y10)}%。</p></div></section>
<section class="section" id="index"><div class="section-head"><h3>大盘表现总览</h3><span class="section-num">01</span></div><div class="table-wrap"><table><thead><tr><th>指数 / ETF</th><th>收盘</th><th>涨跌幅</th><th>日内高低点</th><th>成交量</th><th>收盘位置</th><th>技术状态</th></tr></thead><tbody>${tableRow("DIA", "DIA / Dow Jones 代理", data, "道指代理")}${tableRow("SPY", "SPY / S&P 500 代理", data, "标普代理")}${tableRow("QQQ", "QQQ / Nasdaq 100 代理", data, "成长权重代理")}${tableRow("IWM", "IWM / Russell 2000 代理", data, "小盘代理")}${tableRow("SMH", "SMH 半导体 ETF", data, "AI 硬件链代理")}${tableRow("SOXX", "SOXX 半导体 ETF", data, "半导体宽口径代理")}<tr><td>VIX</td><td>${fmtNum(vixCurrent?.close)}</td><td class="${classFor(vixChange)}">${fmtPct(vixChange)}</td><td>${fmtNum(vixCurrent?.low)} - ${fmtNum(vixCurrent?.high)}</td><td>指数无成交量</td><td>${rangePosition(vixCurrent)}</td><td>波动率指标</td></tr></tbody></table></div></section>
<section class="section" id="intraday"><div class="section-head"><h3>盘中走势复盘</h3><span class="section-num">02</span></div><div class="grid-3"><div class="mini-panel"><strong>开盘</strong><p>SPY 开盘 ${fmtNum(spy?.o)}，相对收盘 ${spy?.c > spy?.o ? "低开后走高或震荡抬升" : "高开后回落或震荡"}。</p></div><div class="mini-panel"><strong>盘中</strong><p>SPY 日内区间 ${fmtNum(spy?.l)} - ${fmtNum(spy?.h)}，${rangePosition(spy)}。</p></div><div class="mini-panel"><strong>尾盘</strong><p>QQQ ${rangePosition(qqq)}，IWM ${rangePosition(iwm)}，可观察成长与小盘尾盘是否同步。</p></div></div><div class="source-box">说明：公开免费源通常不提供分钟级完整复盘。本节使用开盘、最高、最低、收盘位置推断日内结构；如接入 Polygon/IEX/Alpha Vantage 分钟线 API，可升级为真实时间线。</div></section>
<section class="section" id="macro"><div class="section-head"><h3>宏观环境</h3><span class="section-num">03</span></div><div class="table-wrap"><table><thead><tr><th>项目</th><th>最新水平</th><th>日变化</th><th>市场含义</th></tr></thead><tbody><tr><td>2Y 美债收益率</td><td>${fmtNum(treasuryCurrent?.y2)}%</td><td>${fmtNum((treasuryCurrent?.y2 - treasuryPrev?.y2) * 100, 0)} bps</td><td>短端反映 Fed 路径</td></tr><tr><td>10Y 美债收益率</td><td>${fmtNum(treasuryCurrent?.y10)}%</td><td>${fmtNum((treasuryCurrent?.y10 - treasuryPrev?.y10) * 100, 0)} bps</td><td>成长股估值关键利率</td></tr><tr><td>30Y 美债收益率</td><td>${fmtNum(treasuryCurrent?.y30)}%</td><td>${fmtNum((treasuryCurrent?.y30 - treasuryPrev?.y30) * 100, 0)} bps</td><td>超长端期限溢价</td></tr><tr><td>2Y-10Y 利差</td><td>${y210} bps</td><td>自动计算</td><td>收益率曲线斜率</td></tr><tr><td>10Y-30Y 利差</td><td>${y1030} bps</td><td>自动计算</td><td>长端曲线斜率</td></tr></tbody></table></div><h4>美元、黄金、原油、加密资产</h4><div class="table-wrap"><table><thead><tr><th>资产</th><th>代理</th><th>收盘</th><th>涨跌幅</th><th>解读</th></tr></thead><tbody>${assetRow("美元", "UUP", data, "美元指数代理")}${assetRow("黄金", "GLD", data, "黄金代理")}${assetRow("WTI 原油", "USO", data, "WTI 原油代理")}${assetRow("Brent 原油", "BNO", data, "Brent 原油代理")}${assetRow("比特币", "IBIT", data, "比特币现货 ETF 代理")}${assetRow("以太坊", "ETHA", data, "以太坊现货 ETF 代理")}</tbody></table></div><h4>当日重要经济数据</h4><div class="table-wrap"><table><thead><tr><th>数据</th><th>实际值</th><th>预期值</th><th>前值</th><th>市场解读</th></tr></thead><tbody><tr><td>美国经济日历</td><td>暂无可靠数据</td><td>暂无可靠数据</td><td>暂无可靠数据</td><td>需接入 Trading Economics、FMP、Finnhub 或 Nasdaq API key 后自动填充。</td></tr></tbody></table></div></section>
<section class="section" id="sector"><div class="section-head"><h3>板块表现</h3><span class="section-num">04</span></div><div class="table-wrap"><table><thead><tr><th>排名</th><th>板块</th><th>ETF</th><th>涨跌幅</th><th>收盘</th><th>日内高低</th><th>相对 SPY</th><th>驱动</th></tr></thead><tbody>${sectorStats.map((item) => sectorRow(item.sector, item.index, data)).join("")}</tbody></table></div></section>
<section class="section" id="theme"><div class="section-head"><h3>主题与风格表现</h3><span class="section-num">05</span></div><div class="table-wrap"><table><thead><tr><th>主题</th><th>代表</th><th>涨跌幅</th><th>收盘</th><th>日内高低</th><th>解读</th></tr></thead><tbody>${themes.map((item) => themeRow(item, data)).join("")}</tbody></table></div></section>
<section class="section" id="breadth"><div class="section-head"><h3>市场宽度与参与度</h3><span class="section-num">06</span></div><div class="grid-3"><div class="mini-panel"><strong>板块广度</strong><p>11 个板块中 ${positiveSectors} 个上涨，最强为 ${strongestSector?.sector?.[0]} ${fmtPct(strongestSector?.ch)}。</p></div><div class="mini-panel"><strong>等权表现</strong><p>RSP ${fmtPct(rsp?.ch)}，SPY ${fmtPct(spy?.ch)}，用于观察是否只有权重股拉指数。</p></div><div class="mini-panel"><strong>小盘参与</strong><p>IWM ${fmtPct(iwm?.ch)}，相对 SPY ${iwm?.ch > spy?.ch ? "跑赢" : "跑输"}。</p></div></div><div class="source-box">20/50/100/200 日市场成分股参与度、新高新低、Advance/Decline、Put/Call、信用利差等需要额外数据源。当前自动版用板块上涨数量、RSP/SPY、IWM/SPY 作为可验证代理。</div></section>
<section class="section" id="technical"><div class="section-head"><h3>技术面分析</h3><span class="section-num">07</span></div><div class="table-wrap"><table><thead><tr><th>标的</th><th>代码</th><th>收盘</th><th>20日线</th><th>50日线</th><th>100日线</th><th>200日线</th><th>20日支撑</th><th>20日压力</th><th>趋势</th></tr></thead><tbody>${technicalRow("SPY", "S&P 500 代理", data)}${technicalRow("QQQ", "Nasdaq 100 代理", data)}${technicalRow("IWM", "Russell 2000 代理", data)}${technicalRow("SMH", "半导体", data)}${technicalRow("IGV", "软件", data)}${technicalRow("XLK", "科技板块", data)}${technicalRow("XLC", "通信服务", data)}${technicalRow("XLY", "可选消费", data)}</tbody></table></div></section>
<section class="section" id="movers"><div class="section-head"><h3>重点个股新闻与异动</h3><span class="section-num">08</span></div><div class="table-wrap"><table><thead><tr><th>股票</th><th>收盘</th><th>涨跌幅</th><th>成交量</th><th>成交量/20日均量</th><th>推断</th></tr></thead><tbody>${movers.map(([symbol, r]) => `<tr><td>${symbol}</td><td>${fmtNum(r.c)}</td><td class="${classFor(r.ch)}">${fmtPct(r.ch)}</td><td>${fmtVol(r.v)}</td><td>${fmtNum(volumeRatio(data, symbol), 2)}x</td><td>${stockTag(data, symbol)}</td></tr>`).join("")}</tbody></table></div><div class="source-box">新闻原因、评级调整、并购、SEC 文件和盘后财报需要接入新闻/财报 API 后自动标注；当前表格先用涨跌幅、成交量和趋势筛出重点异动。</div></section>
<section class="section" id="earnings"><div class="section-head"><h3>财报日历与财报解读</h3><span class="section-num">09</span></div><div class="table-wrap"><table><thead><tr><th>公司</th><th>收入</th><th>EPS</th><th>指引</th><th>盘后反应</th><th>核心解读</th></tr></thead><tbody><tr><td>当日财报</td><td>暂无可靠数据</td><td>暂无可靠数据</td><td>暂无可靠数据</td><td>暂无可靠数据</td><td>需接入 Nasdaq/FMP/Finnhub 财报日历 API 后填充。</td></tr></tbody></table></div><p class="subtitle">下一步重点关注：NVDA、AVGO、AMD、MRVL、MU、CRM、NOW、SNOW、ORCL、ADBE、PANW、CRWD、VRT、DELL、SMCI、CEG、VST、FLNC、OKLO。</p></section>
<section class="section" id="flow"><div class="section-head"><h3>机构观点与资金流</h3><span class="section-num">10</span></div><div class="table-wrap"><table><thead><tr><th>来源 / 代理</th><th>观察</th><th>涉及资产</th><th>市场影响</th></tr></thead><tbody><tr><td>板块 ETF 代理</td><td>最强板块 ${strongestSector?.sector?.[0]}，最弱板块 ${weakestSector?.sector?.[0]}</td><td>SPDR Select Sector ETFs</td><td>反映当日资金偏好</td></tr><tr><td>成长 / 价值</td><td>SCHG ${fmtPct(row(data, "SCHG")?.ch)}，VTV ${fmtPct(row(data, "VTV")?.ch)}</td><td>SCHG / VTV</td><td>观察成长和价值风格轮动</td></tr><tr><td>风险偏好</td><td>VIX ${fmtPct(vixChange)}，IWM ${fmtPct(iwm?.ch)}</td><td>VIX / IWM</td><td>观察避险与小盘参与度</td></tr></tbody></table></div><div class="source-box">真实 ETF 资金净流入、机构策略报告、大宗交易、期权异动需要额外数据源；当前使用 ETF 价格表现作为资金流代理。</div></section>
<section class="section" id="rotation"><div class="section-head"><h3>板块轮动判断</h3><span class="section-num">11</span></div><div class="grid-2"><div class="mini-panel"><strong>当前市场阶段</strong><p>${marketPhase}</p></div><div class="mini-panel"><strong>资金流向推断</strong><p>流入：${strongestSector?.sector?.[0]}；流出：${weakestSector?.sector?.[0]}。软件相对 SPY ${igv?.ch > spy?.ch ? "走强" : "未明显走强"}，小盘 ${iwm?.ch > spy?.ch ? "参与改善" : "仍偏弱"}。</p></div></div></section>
<section class="section" id="watchlist"><div class="section-head"><h3>我的重点关注股观察</h3><span class="section-num">12</span></div>${watchGroups.map(([group, symbols]) => `<h4>${group}</h4><div class="table-wrap"><table><thead><tr><th>股票</th><th>分组</th><th>收盘</th><th>涨跌幅</th><th>日内高低</th><th>成交量</th><th>量比</th><th>观察</th><th>标签</th></tr></thead><tbody>${symbols.map((symbol) => stockRow(symbol, group, data, "自动行情观察")).join("")}</tbody></table></div>`).join("")}</section>
<section class="section" id="plan"><div class="section-head"><h3>明日交易计划 / 观察清单</h3><span class="section-num">13</span></div><div class="grid-3"><div class="mini-panel"><strong>宏观</strong><p>观察 10Y 美债是否突破 4.50% / 4.60%，美元、黄金、原油和 VIX 是否同步走强。</p></div><div class="mini-panel"><strong>大盘</strong><p>SPY 支撑 ${fmtNum(support(data, "SPY"))}，压力 ${fmtNum(resistance(data, "SPY"))}；QQQ 支撑 ${fmtNum(support(data, "QQQ"))}，压力 ${fmtNum(resistance(data, "QQQ"))}。</p></div><div class="mini-panel"><strong>主线</strong><p>观察 SMH、IGV、IWM 是否继续确认扩散；重点跟踪异动榜和放量个股。</p></div></div></section>
<section class="section" id="risk"><div class="section-head"><h3>风险提示</h3><span class="section-num">14</span></div><div class="table-wrap"><table><thead><tr><th>风险维度</th><th>当前状态</th><th>风险等级</th></tr></thead><tbody><tr><td>宏观利率</td><td>10Y ${fmtNum(treasuryCurrent?.y10)}%，若继续上行会压制成长估值。</td><td>${treasuryCurrent?.y10 >= 4.6 ? "中高" : "中"}</td></tr><tr><td>市场宽度</td><td>${positiveSectors}/11 个板块上涨，RSP ${fmtPct(rsp?.ch)}。</td><td>${positiveSectors >= 7 ? "低" : positiveSectors >= 5 ? "中" : "中高"}</td></tr><tr><td>AI 拥挤度</td><td>SMH ${fmtPct(smh?.ch)}，NVDA ${fmtPct(nvda?.ch)}。</td><td>${smh?.ch > 3 || nvda?.ch > 3 ? "中高" : "中"}</td></tr><tr><td>波动率</td><td>VIX ${fmtNum(vixCurrent?.close)}，日变动 ${fmtPct(vixChange)}。</td><td>${vixCurrent?.close > 20 ? "中高" : "低/中"}</td></tr></tbody></table></div></section>
<section class="section" id="conclusion"><div class="section-head"><h3>最终结论</h3><span class="section-num">15</span></div><div class="callout"><p><strong>今日市场结论：</strong>${marketPhase}。SPY ${fmtPct(spy?.ch)}，QQQ ${fmtPct(qqq?.ch)}，IWM ${fmtPct(iwm?.ch)}，显示大盘、成长和小盘之间仍需要交叉验证。</p><p><strong>操作倾向：</strong>不构成投资建议。若指数继续上涨，优先看能否由 RSP、IWM 和更多板块共同确认；若回调，关注 SPY/QQQ 20 日支撑和 VIX 是否放大。</p><p><strong>明日 5 个信号：</strong>10Y 美债、VIX、RSP/SPY、IWM/SPY、SMH/IGV 相对强弱。</p></div></section>
<section class="section" id="archive"><div class="section-head"><h3>归档</h3><span class="section-num">ARCHIVE</span></div><p class="subtitle">历史版本会自动保存到 <a href="archive/">archive/</a>。GitHub Actions 每次生成新日报前，会把上一版按日期复制为归档文件。</p><div class="source-box">来源：<a href="https://stockanalysis.com/">StockAnalysis/Tiingo</a>；<a href="${treasury.url}">美国财政部收益率曲线</a>；<a href="${vix.url}">Cboe VIX</a>。自动报告交易日：${reportDate}。</div></section>
</article></main></div></body></html>`;
}

const data = await mapLimit([...etfs, ...stocks], 8, ([symbol, kind]) => fetchStockAnalysis(symbol, kind));
const reportDate = targetDateArg || row(data, "SPY")?.t;
if (!reportDate) throw new Error("Unable to determine report date from SPY.");
const [treasury, vix] = await Promise.all([fetchTreasury(reportDate), fetchVix(reportDate)]);

await archiveCurrent(reportDate);
await writeArchiveIndex(reportDate);
await writeFile(path.join(root, "index.html"), renderHtml({ reportDate, data, treasury, vix }), "utf8");
console.log(`Generated report for ${reportDate}`);
