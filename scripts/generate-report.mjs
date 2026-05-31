import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const targetDateArg = process.argv.find((arg) => arg.startsWith("--date="))?.split("=")[1];

const etfs = [
  ["SPY", "etf"], ["QQQ", "etf"], ["IWM", "etf"], ["XLK", "etf"], ["XLC", "etf"],
  ["XLY", "etf"], ["XLF", "etf"], ["XLI", "etf"], ["XLV", "etf"], ["XLP", "etf"],
  ["XLE", "etf"], ["XLU", "etf"], ["XLB", "etf"], ["XLRE", "etf"], ["SMH", "etf"],
  ["SOXX", "etf"], ["IGV", "etf"], ["CIBR", "etf"], ["HACK", "etf"], ["CLOU", "etf"],
  ["WCLD", "etf"], ["BOTZ", "etf"], ["AIQ", "etf"], ["IWO", "etf"], ["IWN", "etf"],
  ["RSP", "etf"], ["SCHG", "etf"], ["VTV", "etf"], ["GLD", "etf"], ["UUP", "etf"],
  ["IBIT", "etf"], ["ETHA", "etf"], ["USO", "etf"], ["BNO", "etf"]
];

const stocks = [
  "DELL", "MSFT", "AVGO", "AMZN", "COST", "NVDA", "AMD", "MRVL", "VRT", "ANET",
  "SMCI", "GOOGL", "AAPL", "META", "TSLA", "CRM", "NOW", "SNOW", "ORCL", "ADBE",
  "PANW", "CRWD", "PLTR", "DDOG", "NET", "CEG", "VST", "ETN", "PWR", "GEV",
  "FLNC", "OKLO", "APLD", "IREN"
].map((symbol) => [symbol, "stocks"]);

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
  const xml = await (await fetch(url)).text();
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
  const current = entries.at(-1);
  const previous = entries.at(-2);
  return { url, current, previous };
}

async function fetchVix(reportDate) {
  const url = "https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv";
  const csv = await (await fetch(url)).text();
  const rows = csv.trim().split(/\r?\n/).slice(1).map((line) => {
    const [date, open, high, low, close] = line.split(",");
    const [mm, dd, yyyy] = date.split("/");
    return {
      date: `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`,
      open: Number(open), high: Number(high), low: Number(low), close: Number(close)
    };
  }).filter((row) => row.date <= reportDate);
  const current = rows.at(-1);
  const previous = rows.at(-2);
  return { url, current, previous };
}

async function archiveCurrent(reportDate) {
  const indexPath = path.join(root, "index.html");
  if (!existsSync(indexPath)) return;
  const current = await readFile(indexPath, "utf8");
  const date = current.match(/美股收盘日报｜(\d{4}-\d{2}-\d{2})/)?.[1] || current.match(/(\d{4}-\d{2}-\d{2})/)?.[1];
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

function tableRow(symbol, label, data, note = "") {
  const r = row(data, symbol);
  if (!r) return `<tr><td>${label}</td><td colspan="5">暂无可靠数据</td></tr>`;
  return `<tr><td>${label}</td><td>${fmtNum(r.c)}</td><td class="${classFor(r.ch)}">${fmtPct(r.ch)}</td><td>${fmtNum(r.l)} - ${fmtNum(r.h)}</td><td>${fmtVol(r.v)}</td><td>${note}</td></tr>`;
}

function sectorRow(rank, name, symbol, data, driver) {
  const r = row(data, symbol);
  return `<tr><td>${rank}</td><td>${name}</td><td>${symbol}</td><td class="${classFor(r?.ch)}">${fmtPct(r?.ch)}</td><td>${fmtNum(r?.c)}</td><td>${fmtNum(r?.l)} - ${fmtNum(r?.h)}</td><td>${r?.ch > row(data, "SPY")?.ch ? "跑赢" : "跑输"}</td><td>${driver}</td></tr>`;
}

function stockRow(symbol, group, data, note, tag = "需要观察") {
  const r = row(data, symbol);
  return `<tr><td>${symbol}</td><td>${group}</td><td>${fmtNum(r?.c)}</td><td class="${classFor(r?.ch)}">${fmtPct(r?.ch)}</td><td>${note}</td><td>${tag}</td></tr>`;
}

function renderHtml({ reportDate, data, treasury, vix }) {
  const spy = row(data, "SPY");
  const qqq = row(data, "QQQ");
  const iwm = row(data, "IWM");
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

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>美股收盘日报｜${reportDate}</title>
  <style>
    :root{--page:#eef3f6;--ink:#16202a;--muted:#667789;--line:#d8e1e7;--side:#101922;--side2:#162535;--accent:#00a7b5;--accent2:#d89b36;--good:#11845b;--bad:#c43d32;--warn:#a56a00;--shadow:0 24px 70px rgba(15,32,44,.14)}
    *{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;color:var(--ink);background:linear-gradient(rgba(18,39,54,.045) 1px,transparent 1px),linear-gradient(90deg,rgba(18,39,54,.045) 1px,transparent 1px),radial-gradient(circle at 72% 8%,rgba(0,167,181,.16),transparent 30%),linear-gradient(135deg,#f8fbfc 0%,var(--page) 52%,#e9eff2 100%);background-size:28px 28px,28px 28px,auto,auto;font-family:"Microsoft YaHei","PingFang SC","Noto Sans SC",Arial,sans-serif;line-height:1.65}.app-shell{display:grid;grid-template-columns:292px minmax(0,1fr);min-height:100vh}aside{position:sticky;top:0;height:100vh;padding:28px 20px;background:linear-gradient(180deg,rgba(0,167,181,.16),transparent 28%),linear-gradient(180deg,var(--side2),var(--side));color:#dce8ee;overflow-y:auto}.brand{padding-bottom:22px;border-bottom:1px solid rgba(255,255,255,.12);margin-bottom:18px}.eyebrow{margin:0 0 7px;color:var(--accent2);font-size:12px;font-weight:800;text-transform:uppercase}.brand h1{margin:0 0 8px;color:white;font-size:23px}.brand p{margin:0;color:#9fb3c1;font-size:13px}nav{display:grid;gap:5px}nav a{display:block;padding:8px 10px;border-radius:7px;color:#b8c7d1;font-size:13px;text-decoration:none}nav a:hover{background:rgba(255,255,255,.07);color:white}button{width:100%;min-height:40px;margin-top:18px;border:1px solid rgba(0,167,181,.75);border-radius:7px;background:linear-gradient(135deg,#00a7b5,#087f92);color:#fff;font:inherit;font-weight:700}main{padding:42px min(5vw,68px) 84px}.report{max-width:1160px;margin:auto;padding:54px;border:1px solid var(--line);border-radius:10px;background:rgba(255,255,255,.9);box-shadow:var(--shadow)}.cover{display:grid;grid-template-columns:minmax(0,1fr) 310px;gap:28px;align-items:end;padding:28px;border:1px solid rgba(0,167,181,.22);border-radius:10px;margin:-18px -18px 34px;background:linear-gradient(135deg,rgba(0,167,181,.1),rgba(216,155,54,.08)),linear-gradient(180deg,#fff,#f6fbfc)}.cover h2{margin:0 0 14px;font-size:40px;line-height:1.16}.subtitle{margin:0;color:#516476;font-size:15px}.meta-card{display:grid;gap:10px;padding:18px;border:1px solid rgba(0,167,181,.24);border-radius:8px;background:rgba(255,255,255,.78);font-size:13px}.meta-row{display:flex;justify-content:space-between;gap:14px;border-bottom:1px solid var(--line);padding-bottom:8px}.meta-row:last-child{border:0;padding:0}.section{padding:30px 0;border-bottom:1px solid var(--line)}.section:last-child{border:0}.section-head{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:16px}h3{margin:0;font-size:22px}.section-num{padding:2px 8px;border:1px solid rgba(0,167,181,.22);border-radius:999px;color:#087f92;background:#effbfc;font-size:12px;font-weight:800}.callout{padding:18px 20px;border:1px solid rgba(0,167,181,.22);border-left:4px solid var(--accent);border-radius:8px;background:linear-gradient(135deg,#f1fbfc,#fffaf0)}.grid-2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.grid-3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.mini-panel{min-height:116px;padding:16px;border:1px solid var(--line);border-radius:8px;background:linear-gradient(180deg,#fff,#f8fbfc)}.mini-panel strong{display:block;margin-bottom:8px;color:#057d8d}.mini-panel p{margin:0;color:var(--muted);font-size:14px}.table-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:8px;background:white;box-shadow:0 12px 28px rgba(16,32,44,.07)}table{width:100%;min-width:760px;border-collapse:collapse;font-size:13px}th,td{padding:10px 11px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}th{background:#eaf4f7;color:#273746;font-weight:800;white-space:nowrap}tbody tr:hover{background:#f7fbfc}.good{color:var(--good);font-weight:800}.bad{color:var(--bad);font-weight:800}.warn{color:var(--warn);font-weight:800}.list{margin:10px 0 0;padding-left:20px;color:var(--muted);font-size:14px}.tag-row{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}.tag{display:inline-flex;align-items:center;min-height:29px;padding:4px 10px;border:1px solid rgba(0,167,181,.24);border-radius:999px;background:#f0fbfc;color:#46606d;font-size:12px;font-weight:700}.source-box{margin-top:16px;padding:14px 16px;border:1px dashed rgba(0,167,181,.5);border-radius:8px;background:linear-gradient(135deg,rgba(0,167,181,.06),rgba(216,155,54,.06));color:var(--muted);font-size:13px}.source-box a{color:#057d8d;font-weight:700}@media(max-width:980px){.app-shell{display:block}aside{position:static;height:auto}nav{grid-template-columns:repeat(2,minmax(0,1fr))}main{padding:24px 16px 48px}.report{padding:28px 20px}.cover,.grid-2,.grid-3{grid-template-columns:1fr}.cover{margin:0 0 28px;padding:20px}.cover h2{font-size:30px}}@media print{body{background:#fff}aside{display:none}.app-shell{display:block}main{padding:0}.report{max-width:none;padding:0;border:0;box-shadow:none}.section{break-inside:avoid}}
  </style>
</head>
<body><div class="app-shell"><aside><div class="brand"><p class="eyebrow">US Market Daily</p><h1>美股收盘日报</h1><p>自动生成：行情来自 StockAnalysis/Tiingo，美债来自美国财政部，VIX 来自 Cboe。</p></div><nav><a href="#summary">0. 一句话总结</a><a href="#index">1. 大盘表现</a><a href="#macro">2. 宏观环境</a><a href="#sector">3. 板块表现</a><a href="#theme">4. 主题风格</a><a href="#stocks">5. 个股异动</a><a href="#risk">6. 风险提示</a><a href="#archive">7. 归档</a></nav><button onclick="window.print()">打印 / 导出 PDF</button></aside><main><article class="report">
<header class="cover"><div><p class="eyebrow">自动收盘复盘</p><h2>美股收盘日报｜${reportDate}</h2><p class="subtitle">最新自动版已抓取主要 ETF、主题 ETF、重点个股、美债曲线和 VIX。报告会在每个美股交易日收盘后由 GitHub Actions 自动更新，并把上一版归档。</p></div><div class="meta-card"><div class="meta-row"><span>交易日</span><strong>${reportDate}</strong></div><div class="meta-row"><span>SPY</span><strong>${fmtPct(spy?.ch)}</strong></div><div class="meta-row"><span>QQQ</span><strong>${fmtPct(qqq?.ch)}</strong></div><div class="meta-row"><span>VIX</span><strong>${fmtNum(vixCurrent?.close)}</strong></div></div></header>
<section class="section" id="summary"><div class="section-head"><h3>今日一句话总结</h3><span class="section-num">00</span></div><div class="callout"><p>SPY ${fmtPct(spy?.ch)}，QQQ ${fmtPct(qqq?.ch)}，IWM ${fmtPct(iwm?.ch)}。软件 IGV ${fmtPct(igv?.ch)}，网络安全 CIBR ${fmtPct(cibr?.ch)}，云计算 WCLD ${fmtPct(wcld?.ch)}；半导体 SMH ${fmtPct(smh?.ch)}，NVDA ${fmtPct(nvda?.ch)}。</p><p><strong>市场状态：</strong>${igv?.ch > spy?.ch ? "软件/成长扩散明显" : "指数主导，扩散一般"}；${iwm?.ch < spy?.ch ? "小盘跑输，宽度仍需观察。" : "小盘参与度改善。"}</p></div></section>
<section class="section" id="index"><div class="section-head"><h3>大盘表现总览</h3><span class="section-num">01</span></div><div class="table-wrap"><table><thead><tr><th>指数 / ETF</th><th>收盘</th><th>涨跌幅</th><th>日内高低点</th><th>成交量</th><th>技术状态</th></tr></thead><tbody>${tableRow("SPY", "SPY / S&P 500 代理", data, "指数本身无成交量，使用 SPY 代理")}${tableRow("QQQ", "QQQ / Nasdaq 100 代理", data, "成长权重代理")}${tableRow("IWM", "IWM / Russell 2000 代理", data, "小盘代理")}${tableRow("SMH", "SMH 半导体 ETF", data, "AI 硬件链代理")}${tableRow("SOXX", "SOXX 半导体 ETF", data, "半导体宽口径代理")}<tr><td>VIX</td><td>${fmtNum(vixCurrent?.close)}</td><td class="${classFor(vixChange)}">${fmtPct(vixChange)}</td><td>${fmtNum(vixCurrent?.low)} - ${fmtNum(vixCurrent?.high)}</td><td>指数无成交量</td><td>波动率指标</td></tr></tbody></table></div></section>
<section class="section" id="macro"><div class="section-head"><h3>宏观环境</h3><span class="section-num">02</span></div><div class="table-wrap"><table><thead><tr><th>项目</th><th>最新水平</th><th>日变化</th><th>市场含义</th></tr></thead><tbody><tr><td>2Y 美债收益率</td><td>${fmtNum(treasuryCurrent?.y2)}%</td><td>${fmtNum((treasuryCurrent?.y2 - treasuryPrev?.y2) * 100, 0)} bps</td><td>短端反映 Fed 路径</td></tr><tr><td>10Y 美债收益率</td><td>${fmtNum(treasuryCurrent?.y10)}%</td><td>${fmtNum((treasuryCurrent?.y10 - treasuryPrev?.y10) * 100, 0)} bps</td><td>成长股估值关键利率</td></tr><tr><td>30Y 美债收益率</td><td>${fmtNum(treasuryCurrent?.y30)}%</td><td>${fmtNum((treasuryCurrent?.y30 - treasuryPrev?.y30) * 100, 0)} bps</td><td>超长端期限溢价</td></tr><tr><td>2Y-10Y 利差</td><td>${y210} bps</td><td>自动计算</td><td>收益率曲线斜率</td></tr><tr><td>10Y-30Y 利差</td><td>${y1030} bps</td><td>自动计算</td><td>长端曲线斜率</td></tr></tbody></table></div><h4>资产代理</h4><div class="table-wrap"><table><thead><tr><th>资产</th><th>代理</th><th>收盘</th><th>涨跌幅</th><th>解读</th></tr></thead><tbody>${assetRow("美元", "UUP", data)}${assetRow("黄金", "GLD", data)}${assetRow("WTI 原油", "USO", data)}${assetRow("Brent 原油", "BNO", data)}${assetRow("比特币", "IBIT", data)}${assetRow("以太坊", "ETHA", data)}</tbody></table></div><div class="source-box">经济日历自动全量抓取需要 Trading Economics/Finnhub/FMP 等 API key。当前自动版保留行情、美债、VIX 等无需密钥数据；如配置 API key，可扩展 CPI/PPI/PCE/非农/PMI/初请等完整日历。</div></section>
<section class="section" id="sector"><div class="section-head"><h3>板块表现</h3><span class="section-num">03</span></div><div class="table-wrap"><table><thead><tr><th>排名</th><th>板块</th><th>ETF</th><th>涨跌幅</th><th>收盘</th><th>日内高低</th><th>相对 SPY</th><th>驱动</th></tr></thead><tbody>${[
  ["信息技术","XLK","科技/AI"],["通信服务","XLC","互联网/媒体"],["可选消费","XLY","消费权重"],["金融","XLF","顺周期"],["工业","XLI","工业链"],["医疗保健","XLV","防御"],["必需消费","XLP","防御消费"],["能源","XLE","油价"],["公用事业","XLU","利率敏感"],["材料","XLB","周期"],["房地产","XLRE","利率敏感"]
].map(([name, symbol, driver], index) => sectorRow(index + 1, name, symbol, data, driver)).join("")}</tbody></table></div></section>
<section class="section" id="theme"><div class="section-head"><h3>主题与风格表现</h3><span class="section-num">04</span></div><div class="table-wrap"><table><thead><tr><th>主题</th><th>代表</th><th>涨跌幅</th><th>收盘</th><th>解读</th></tr></thead><tbody>${themeRow("软件", "IGV", data)}${themeRow("网络安全", "CIBR", data)}${themeRow("云计算", "WCLD", data)}${themeRow("半导体", "SMH", data)}${themeRow("小盘成长", "IWO", data)}${themeRow("小盘价值", "IWN", data)}${themeRow("等权标普", "RSP", data)}${themeRow("大盘成长", "SCHG", data)}${themeRow("大盘价值", "VTV", data)}</tbody></table></div></section>
<section class="section" id="stocks"><div class="section-head"><h3>重点个股观察</h3><span class="section-num">05</span></div><div class="table-wrap"><table><thead><tr><th>股票</th><th>分组</th><th>收盘</th><th>涨跌幅</th><th>观察</th><th>标签</th></tr></thead><tbody>${[
  ["NVDA","GPU","AI 硬件核心"],["MSFT","核心科技","大型科技权重"],["AAPL","核心科技","消费科技"],["GOOGL","通信服务","互联网权重"],["AMZN","可选消费/云","消费与云"],["META","通信服务","社交/广告"],["TSLA","可选消费","高 beta"],["DELL","AI 服务器","服务器链"],["AVGO","半导体/互连","AI 互连"],["SMCI","AI 服务器","服务器链"],["CRM","软件","SaaS"],["NOW","软件","SaaS"],["ORCL","云/数据库","AI 云"],["PANW","网络安全","安全软件"],["CRWD","网络安全","安全软件"],["PLTR","AI 应用","高 beta AI"],["FLNC","储能","电力链"]
].map(([symbol, group, note]) => stockRow(symbol, group, data, note, row(data, symbol)?.ch > 5 ? "继续强势" : row(data, symbol)?.ch < -3 ? "破位风险" : "需要观察")).join("")}</tbody></table></div></section>
<section class="section" id="risk"><div class="section-head"><h3>风险提示</h3><span class="section-num">06</span></div><div class="grid-3"><div class="mini-panel"><strong>利率</strong><p>10Y ${fmtNum(treasuryCurrent?.y10)}%，若重新上行会压制成长估值。</p></div><div class="mini-panel"><strong>宽度</strong><p>IWM ${fmtPct(iwm?.ch)}，小盘是否参与仍是关键。</p></div><div class="mini-panel"><strong>拥挤度</strong><p>若软件/AI 单日大涨后放量回落，需警惕利好兑现。</p></div></div></section>
<section class="section" id="archive"><div class="section-head"><h3>归档</h3><span class="section-num">07</span></div><p class="subtitle">历史版本会自动保存到 <a href="archive/">archive/</a>。GitHub Actions 每次生成新日报前，会把上一版按日期复制为归档文件。</p><div class="source-box">来源：<a href="https://stockanalysis.com/etf/spy/history/">StockAnalysis/Tiingo</a>；<a href="${treasury.url}">美国财政部收益率曲线</a>；<a href="${vix.url}">Cboe VIX</a>。自动报告交易日：${reportDate}。</div></section>
</article></main></div></body></html>`;
}

function assetRow(name, symbol, data) {
  const r = row(data, symbol);
  return `<tr><td>${name}</td><td>${symbol}</td><td>${fmtNum(r?.c)}</td><td class="${classFor(r?.ch)}">${fmtPct(r?.ch)}</td><td>${name}代理数据</td></tr>`;
}

function themeRow(name, symbol, data) {
  const r = row(data, symbol);
  return `<tr><td>${name}</td><td>${symbol}</td><td class="${classFor(r?.ch)}">${fmtPct(r?.ch)}</td><td>${fmtNum(r?.c)}</td><td>${r?.ch > row(data, "SPY")?.ch ? "跑赢大盘" : "跑输大盘"}</td></tr>`;
}

const data = await mapLimit([...etfs, ...stocks], 8, ([symbol, kind]) => fetchStockAnalysis(symbol, kind));
const reportDate = targetDateArg || row(data, "SPY")?.t;
if (!reportDate) throw new Error("Unable to determine report date from SPY.");
const [treasury, vix] = await Promise.all([fetchTreasury(reportDate), fetchVix(reportDate)]);

await archiveCurrent(reportDate);
await writeArchiveIndex(reportDate);
await writeFile(path.join(root, "index.html"), renderHtml({ reportDate, data, treasury, vix }), "utf8");
console.log(`Generated report for ${reportDate}`);
