import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const targetDateArg = process.argv.find((arg) => arg.startsWith("--date="))?.split("=")[1];

const etfs = [
  ["SPY", "etf"], ["QQQ", "etf"], ["DIA", "etf"], ["IWM", "etf"],
  ["XLK", "etf"], ["XLC", "etf"], ["XLY", "etf"], ["XLF", "etf"], ["XLI", "etf"],
  ["XLV", "etf"], ["XLP", "etf"], ["XLE", "etf"], ["XLU", "etf"], ["XLB", "etf"], ["XLRE", "etf"],
  ["SMH", "etf"], ["SOXX", "etf"], ["IGV", "etf"], ["CIBR", "etf"], ["HACK", "etf"],
  ["CLOU", "etf"], ["WCLD", "etf"], ["BOTZ", "etf"], ["AIQ", "etf"], ["IWO", "etf"], ["IWN", "etf"],
  ["RSP", "etf"], ["SCHG", "etf"], ["VTV", "etf"], ["GLD", "etf"], ["UUP", "etf"],
  ["IBIT", "etf"], ["ETHA", "etf"], ["USO", "etf"], ["BNO", "etf"]
];

const stockSymbols = [
  "DELL", "MSFT", "AVGO", "AMZN", "COST", "NVDA", "AMD", "MRVL", "VRT", "ANET",
  "SMCI", "GOOGL", "AAPL", "META", "TSLA", "CRM", "NOW", "SNOW", "ORCL", "ADBE",
  "PANW", "CRWD", "PLTR", "DDOG", "NET", "CEG", "VST", "ETN", "PWR", "GEV",
  "FLNC", "OKLO", "APLD", "IREN"
];
const stocks = stockSymbols.map((symbol) => [symbol, "stocks"]);

const sectors = [
  ["信息技术", "XLK", "MSFT、AVGO、DELL 和软件链"], ["金融", "XLF", "顺周期温和参与"],
  ["材料", "XLB", "风险偏好未扩散至材料"], ["工业", "XLI", "AI 电力链内部走弱拖累"],
  ["公用事业", "XLU", "防御板块未被追捧"], ["通信服务", "XLC", "GOOGL/META 偏弱"],
  ["医疗保健", "XLV", "防御板块回落"], ["房地产", "XLRE", "利率敏感板块偏弱"],
  ["可选消费", "XLY", "AMZN/TSLA 拖累"], ["能源", "XLE", "油价回落"],
  ["必需消费", "XLP", "COST 走弱拖累"]
];

const watchRows = [
  ["DELL", "AI 服务器", "AI 订单和 AI 服务器指引大幅上修", "继续强势 / 短线过热"],
  ["MSFT", "核心科技", "大型科技权重领涨", "继续强势"],
  ["AVGO", "半导体 / AI 互连", "AI 服务器链联动", "继续强势"],
  ["NVDA", "GPU", "硬件龙头回落", "高位震荡"],
  ["SMCI", "AI 服务器", "服务器链情绪带动", "低位修复 / 高波动"],
  ["CRM", "软件", "软件链补涨", "继续观察补涨持续"],
  ["NOW", "软件", "SaaS 强势补涨", "继续强势 / 短线过热"],
  ["ORCL", "云 / 数据库", "AI 云叙事受追捧", "继续强势"],
  ["PLTR", "AI 应用", "AI 应用高 beta 走强", "短线过热"],
  ["FLNC", "储能 / 电力", "电力链分化中显著走弱", "破位风险"]
];

const megaCapRows = [
  ["NVDA", "AI 硬件并未全线延续，GPU 方向短线钝化"],
  ["MSFT", "大型科技权重领涨，支撑 Nasdaq"],
  ["AAPL", "基本持平，未贡献主升"],
  ["GOOGL", "通信服务走弱的主要拖累之一"],
  ["AMZN", "消费权重跑输"],
  ["META", "小幅回落"],
  ["TSLA", "可选消费拖累之一"]
];

const sectorExtraStocks = {
  "AI 硬件 / 半导体": ["DELL", "AVGO", "ANET", "SMCI", "NVDA", "AMD", "SMH"],
  "软件 / SaaS / AI 应用": ["CRM", "NOW", "SNOW", "ORCL", "ADBE", "PANW", "CRWD", "PLTR", "DDOG", "NET"],
  "AI 电力 / 数据中心": ["CEG", "VST", "ETN", "PWR", "GEV", "FLNC", "OKLO", "APLD", "IREN"]
};

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
    const get = (name) => body.match(new RegExp(`<d:${name}[^>]*>([^<]+)</d:${name}>`))?.[1] || "";
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
  const index = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>历史报告</title><style>body{font-family:Arial,"Microsoft YaHei",sans-serif;margin:40px;background:#eef3f6;color:#16202a}main{max-width:760px;margin:auto;background:white;border:1px solid #d8e1e7;border-radius:10px;padding:28px;box-shadow:0 20px 50px rgba(15,32,44,.12)}a{color:#057d8d;font-weight:700}</style></head><body><main><h1>历史报告</h1><p>最新日报：<a href="../index.html">${reportDate}</a></p><p>历史文件会按日期保存在本目录。</p></main></body></html>`;
  await writeFile(path.join(archiveDir, "index.html"), index, "utf8");
}

function row(data, symbol) {
  return data[symbol]?.row;
}

function rows(data, symbol) {
  return data[symbol]?.rows || [];
}

function avg(values) {
  const clean = values.filter(Number.isFinite);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : NaN;
}

function ma(data, symbol, length) {
  return avg(rows(data, symbol).slice(0, length).map((item) => item.c));
}

function support(data, symbol) {
  const history = rows(data, symbol).slice(0, 20);
  return history.length ? Math.min(...history.map((item) => item.l)) : NaN;
}

function resistance(data, symbol) {
  const history = rows(data, symbol).slice(0, 20);
  return history.length ? Math.max(...history.map((item) => item.h)) : NaN;
}

function volumeRatio(data, symbol) {
  const r = row(data, symbol);
  const base = avg(rows(data, symbol).slice(0, 20).map((item) => item.v));
  return Number.isFinite(r?.v) && Number.isFinite(base) && base > 0 ? r.v / base : NaN;
}

function rangeText(r) {
  if (!r) return "暂无可靠数据";
  return `${fmtNum(r.l)} - ${fmtNum(r.h)}`;
}

function phraseList(data, symbols) {
  return symbols.map((symbol) => `${symbol} ${fmtPct(row(data, symbol)?.ch)}`).join("、");
}

function stockJudgment(data, symbol) {
  const r = row(data, symbol);
  if (!r) return "暂无可靠数据";
  if (r.ch > 10) return "继续强势 / 短线过热";
  if (r.ch > 5) return "继续强势";
  if (r.ch < -8) return "破位风险";
  if (r.ch < -2) return "偏弱观察";
  return "需要观察";
}

function indexRow(label, close, change, range, volume, status) {
  return `<tr><td>${label}</td><td>${close}</td><td class="${classFor(change)}">${fmtPct(change)}</td><td>${range}</td><td>${volume}</td><td>${status}</td></tr>`;
}

function etfIndexRow(symbol, label, data, status) {
  const r = row(data, symbol);
  return indexRow(label, fmtNum(r?.c), r?.ch, rangeText(r), fmtVol(r?.v), status);
}

function sectorRow(item, rank, data, spy) {
  const [name, symbol, driver] = item;
  const r = row(data, symbol);
  return `<tr><td>${rank}</td><td>${name}</td><td>${symbol}</td><td class="${classFor(r?.ch)}">${fmtPct(r?.ch)}</td><td>${fmtNum(r?.c)}</td><td>${rangeText(r)}</td><td>${r?.ch > spy?.ch ? "跑赢" : "跑输"}</td><td>${driver}</td></tr>`;
}

function technicalRow(symbol, data, trend, observation) {
  const r = row(data, symbol);
  return `<tr><td>${symbol}</td><td>${fmtNum(r?.c)}</td><td class="${classFor(r?.ch)}">${fmtPct(r?.ch)}</td><td>${rangeText(r)}</td><td>${fmtVol(r?.v)}</td><td>${trend}</td><td>${observation}</td></tr>`;
}

function megaRow([symbol, note], data) {
  const r = row(data, symbol);
  return `<tr><td>${symbol}</td><td>${fmtNum(r?.c)}</td><td class="${classFor(r?.ch)}">${fmtPct(r?.ch)}</td><td>${rangeText(r)}</td><td>${note}</td></tr>`;
}

function watchRow([symbol, group, trend, judgment], data) {
  const r = row(data, symbol);
  return `<tr><td>${symbol}</td><td>${group}</td><td>${fmtNum(r?.c)}</td><td class="${classFor(r?.ch)}">${fmtPct(r?.ch)}</td><td>${trend}</td><td>${judgment}</td></tr>`;
}

function economicRows(reportDate) {
  if (reportDate !== "2026-05-29") {
    return `<tr><td>美国经济日历</td><td>暂无可靠数据</td><td>暂无可靠数据</td><td>暂无可靠数据</td><td>需接入 Trading Economics、FMP、Finnhub 或 Nasdaq API key 后自动填充。</td></tr>`;
  }
  return [
    ["4月 PCE 价格指数", "环比 +0.4%，同比 +3.8%", "同比 +3.8%（Reuters 调查）", "3月环比 +0.7%，同比 +3.5%", "整体通胀仍偏高，限制 Fed 降息空间"],
    ["4月核心 PCE", "环比 +0.2%，同比 +3.3%", "环比 +0.3%（市场日历/经济学家预期）", "3月环比 +0.3%，同比 +3.2%", "核心环比低于预期，支持风险偏好"],
    ["4月个人收入", "约持平，少于 -$0.1B；环比 0.0%", "+0.4%（市场日历预期）", "3月 +0.5%", "收入动能弱于预期，消费需求需继续验证"],
    ["4月名义 PCE 消费支出", "+$111.1B，环比 +0.5%", "暂无可靠数据", "3月 +1.0%", "消费仍增长，但动能较 3 月放缓"],
    ["4月实际 PCE", "环比 +0.1%", "暂无可靠数据", "3月 +0.3%", "扣除通胀后消费增速偏温和"],
    ["Chicago PMI（5月）", "62.7", "50.5", "49.2", "大幅重回扩张区间，制造区域活动好于预期"]
  ].map((cells) => `<tr>${cells.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("");
}

function sourceText(reportDate, treasuryUrl, vixUrl) {
  const base = `主要来源：<a href="https://stockanalysis.com/">StockAnalysis/Tiingo 历史行情</a>；<a href="${treasuryUrl}">美国财政部 Daily Treasury Yield Curve Rates</a>；<a href="${vixUrl}">Cboe VIX Historical Data</a>`;
  if (reportDate !== "2026-05-29") return `${base}。自动报告交易日：${reportDate}。`;
  return `${base}；Trading Economics：美国经济日历；AP：US stocks gain ground, adding to their records, as Dell soars；AP：How major US stock indexes fared Friday 5/29/2026；BEA：Personal Income and Outlays, April 2026；SEC / Dell 8-K Exhibit 99.1；Reuters via MarketScreener。`;
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
  const sectorStats = sectors.map((sector) => ({ sector, ch: row(data, sector[1])?.ch })).sort((a, b) => (b.ch ?? -999) - (a.ch ?? -999));
  const positiveSectors = sectorStats.filter((item) => item.ch > 0).length;
  const strongestSector = sectorStats[0];
  const weakestSector = sectorStats.at(-1);
  const marketPhase = igv?.ch > spy?.ch && smh?.ch < spy?.ch ? "软件补涨 / 成长内部轮动" : smh?.ch > spy?.ch ? "AI 硬件主线仍强" : iwm?.ch > spy?.ch ? "小盘参与改善" : "指数高位延续，内部仍需确认";

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>美股收盘日报｜${reportDate}</title>
  <style>
    :root{--page:#f7fafb;--ink:#142033;--muted:#5f7184;--line:#d9e4ea;--accent:#008996;--good:#108567;--bad:#c83a31;--warn:#a56a00}
    *{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--page);color:var(--ink);font-family:"Microsoft YaHei","PingFang SC","Noto Sans SC",Arial,sans-serif;line-height:1.68}.app-shell{display:grid;grid-template-columns:292px minmax(0,1fr);min-height:100vh}aside{position:sticky;top:0;height:100vh;overflow:auto;padding:28px 20px;background:#111c27;color:#dce8ee}.brand{padding-bottom:20px;border-bottom:1px solid rgba(255,255,255,.12);margin-bottom:16px}.eyebrow{margin:0 0 7px;color:#c39136;font-size:12px;font-weight:800;text-transform:uppercase}.brand h1{margin:0 0 8px;color:white;font-size:23px}.brand p{margin:0;color:#aab9c5;font-size:13px}nav{display:grid;gap:5px}nav a{padding:8px 10px;border-radius:7px;color:#b8c7d1;font-size:13px;text-decoration:none}nav a:hover{background:rgba(255,255,255,.08);color:white}button{width:100%;min-height:40px;margin-top:18px;border:1px solid rgba(0,137,150,.75);border-radius:7px;background:linear-gradient(135deg,#00a7b5,#087f92);color:#fff;font:inherit;font-weight:800;cursor:pointer}main{padding:40px min(5vw,68px) 84px}.report{max-width:1160px;margin:auto;padding:54px;border:1px solid var(--line);border-radius:10px;background:white;box-shadow:0 24px 70px rgba(15,32,44,.12)}.cover{padding:28px;border:1px solid #bfe8ec;border-radius:10px;margin:-18px -18px 34px;background:#fff}.cover h2{margin:0 0 12px;font-size:40px;line-height:1.16}.subtitle{margin:0;color:#516476}.meta-card{margin-top:26px;border:1px solid #bfe8ec;border-radius:10px;padding:18px 28px}.meta-row{display:flex;justify-content:space-between;border-bottom:1px solid var(--line);padding:10px 0}.meta-row:last-child{border:0}.section{padding:30px 0;border-bottom:1px solid var(--line)}.section:last-child{border:0}.section-head{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:16px}h3{margin:0;font-size:26px}h4{margin:22px 0 10px;color:var(--accent);font-size:19px}.section-num{padding:2px 10px;border:1px solid #bfe8ec;border-radius:999px;color:var(--accent);font-size:13px;font-weight:900}.callout,.note-card{padding:18px 22px;border:1px solid #bfe8ec;border-left:4px solid var(--accent);border-radius:8px;background:#fff}.grid-2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.grid-3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.mini-panel{padding:18px;border:1px solid var(--line);border-radius:8px;background:#fff}.mini-panel strong{display:block;margin-bottom:10px;color:var(--accent)}.mini-panel p{margin:0}.table-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:8px;background:white}table{width:100%;min-width:780px;border-collapse:collapse;font-size:14px}th,td{padding:12px 14px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}th{background:#f3f8fa;font-weight:900;white-space:nowrap}tbody tr:last-child td{border-bottom:0}.good{color:var(--good);font-weight:900}.bad{color:var(--bad);font-weight:900}.warn{color:var(--warn);font-weight:900}.chips{display:flex;flex-wrap:wrap;gap:10px;margin:14px 0}.chip{padding:6px 12px;border:1px solid #bfe8ec;border-radius:999px;color:#45636e;background:#f7feff;font-weight:800}.source-box{margin-top:16px;padding:14px 16px;border:1px dashed #66c6ce;border-radius:8px;background:#fbffff;color:var(--muted);font-size:13px}.source-box a{color:#057d8d;font-weight:800}.download-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}.pdf-button{width:auto;margin-top:0;padding:0 16px}.history-link{display:inline-flex;align-items:center;min-height:40px;padding:0 14px;border:1px solid var(--line);border-radius:7px;color:#057d8d;font-weight:800;text-decoration:none}@media(max-width:980px){.app-shell{display:block}aside{position:static;height:auto}nav{grid-template-columns:repeat(2,minmax(0,1fr))}main{padding:24px 16px 48px}.report{padding:28px 18px}.cover h2{font-size:30px}.grid-2,.grid-3{grid-template-columns:1fr}}@media print{body{background:#fff}aside,.download-actions{display:none}.app-shell{display:block}main{padding:0}.report{max-width:none;padding:0;border:0;box-shadow:none}.section{break-inside:avoid}}
  </style>
</head>
<body data-report-date="${reportDate}"><div class="app-shell"><aside><div class="brand"><p class="eyebrow">US Market Daily</p><h1>美股收盘日报</h1><p>自动生成：行情来自 StockAnalysis/Tiingo，美债来自美国财政部，VIX 来自 Cboe。</p></div><nav><a href="#summary">0. 一句话总结</a><a href="#index">1. 大盘表现</a><a href="#intraday">2. 盘中走势</a><a href="#macro">3. 宏观环境</a><a href="#sector">4. 板块表现</a><a href="#theme">5. 主题风格</a><a href="#breadth">6. 市场宽度</a><a href="#technical">7. 技术面</a><a href="#movers">8. 个股异动</a><a href="#earnings">9. 财报日历</a><a href="#flow">10. 机构资金</a><a href="#rotation">11. 板块轮动</a><a href="#watchlist">12. 关注股</a><a href="#plan">13. 交易计划</a><a href="#risk">14. 风险提示</a><a href="#conclusion">15. 最终结论</a><a href="#archive">历史报告</a></nav><button onclick="downloadPdf()">下载 PDF</button></aside><main><article class="report">
<header class="cover"><p class="eyebrow">收盘复盘</p><h2>美股收盘日报｜${reportDate}</h2><p class="subtitle">美股延续纪录高位，科技与 AI 链仍是主线，但细分结构出现明显切换：软件、网络安全、云计算大幅补涨，AI 服务器和部分硬件股强势，小盘和能源链偏弱。</p><div class="meta-card"><div class="meta-row"><span>交易日</span><strong>${reportDate}</strong></div><div class="meta-row"><span>报告日期</span><strong>2026-05-31</strong></div><div class="meta-row"><span>数据状态</span><strong>已批量补行情</strong></div><div class="meta-row"><span>仍缺项目</span><strong>宽度 / 均线参与度</strong></div></div></header>
<section class="section" id="summary"><div class="section-head"><h3>今日一句话总结</h3><span class="section-num">00</span></div><div class="callout"><p>美股继续走强，S&P 500、Dow、Nasdaq 均创纪录收盘。表面是 AI 硬件和 Dell 财报驱动，但 ${reportDate} 更值得注意的是软件、网络安全和云计算明显补涨：IGV ${fmtPct(igv?.ch)}、CIBR ${fmtPct(cibr?.ch)}、WCLD ${fmtPct(wcld?.ch)}。与此同时，NVDA ${fmtPct(nvda?.ch)}、SMH ${fmtPct(smh?.ch)}、SOXX ${fmtPct(row(data, "SOXX")?.ch)}，说明资金从 GPU/半导体硬件向软件和应用层扩散。</p><p><strong>今日市场状态：</strong>指数强、成长强，宽度较前一版判断更好；主线从 AI 硬件单点领涨，扩展到软件/SaaS/网络安全，但小盘和能源仍偏弱。</p></div></section>
<section class="section" id="index"><div class="section-head"><h3>大盘表现总览</h3><span class="section-num">01</span></div><div class="table-wrap"><table><thead><tr><th>指数 / ETF</th><th>收盘点位</th><th>涨跌幅</th><th>日内高低点</th><th>成交量</th><th>技术状态</th></tr></thead><tbody>${indexRow("Dow Jones", "51,032.46", 0.70, "暂无可靠日内高低点", "暂无可靠数据", "纪录收盘")}${indexRow("S&P 500", "7,580.06", 0.20, "暂无可靠日内高低点", "全美交易所约 23.9B 股", "连续第 4 日历史新高，连续日上涨")}${etfIndexRow("SPY", "SPY", data, "S&P 500 ETF 再创新高区间")}${indexRow("Nasdaq Composite", "26,972.62", 0.20, "暂无可靠日内高低点", "暂无可靠数据", "纪录收盘")}${etfIndexRow("QQQ", "Nasdaq 100 / QQQ", data, "跑赢 SPY，成长权重仍强")}${etfIndexRow("IWM", "Russell 2000 / IWM", data, "小盘跑输，risk-on 不全面")}${etfIndexRow("SMH", "SMH 半导体 ETF", data, "半导体高位震荡，利好有所钝化")}${etfIndexRow("SOXX", "SOXX 半导体 ETF", data, "半导体整体未跟随软件补涨")}<tr><td>VIX</td><td>${fmtNum(vixCurrent?.close)}</td><td class="${classFor(vixChange)}">${fmtPct(vixChange)}</td><td>${fmtNum(vixCurrent?.low)} - ${fmtNum(vixCurrent?.high)}</td><td>指数无成交量</td><td>低位回落，避险需求下降</td></tr></tbody></table></div><ul><li>QQQ ${fmtPct(qqq?.ch)} 跑赢 SPY ${fmtPct(spy?.ch)}，但半导体 ETF 小跌，说明 Nasdaq 内部并非全线硬件领涨。</li><li>IWM ${fmtPct(iwm?.ch)}，小盘没有参与，是当天风险偏好不足的一处瑕疵。</li><li>软件/网络安全/云计算明显补涨，是比“AI 硬件单线”更重要的新变化。</li></ul></section>
<section class="section" id="intraday"><div class="section-head"><h3>盘中走势复盘</h3><span class="section-num">02</span></div><div class="grid-2"><div class="mini-panel"><strong>盘前</strong><p>Dell 财报和 AI 服务器展望成为核心催化，市场同时消化 4 月 PCE 通胀数据和油价回落。</p></div><div class="mini-panel"><strong>开盘后</strong><p>指数小幅高开，科技与成长风格占优。Reuters 盘初显示 S&P 500 约 +0.21%、Nasdaq 约 +0.16%。</p></div><div class="mini-panel"><strong>午盘</strong><p>软件、网络安全、云计算继续扩大涨幅，CRM、NOW、ORCL、PANW、CRWD、PLTR、DDOG 等集体大涨。</p></div><div class="mini-panel"><strong>尾盘 / 盘后</strong><p>三大指数收于纪录高位；半导体 ETF 未能同步走强，小盘收跌。</p></div></div><div class="source-box">核心解释：AI 服务器财报验证需求，但资金从硬件向软件/SaaS/安全/云计算扩散。当日更像“成长内部轮动”，不是单纯 AI 硬件主升。</div></section>
<section class="section" id="macro"><div class="section-head"><h3>宏观环境</h3><span class="section-num">03</span></div><h4>3.1 美债收益率</h4><div class="table-wrap"><table><thead><tr><th>项目</th><th>最新水平</th><th>日变化</th><th>市场含义</th></tr></thead><tbody><tr><td>2Y 美债收益率</td><td>${fmtNum(treasuryCurrent?.y2)}%</td><td>${fmtNum((treasuryCurrent?.y2 - treasuryPrev?.y2) * 100, 0)} bp，前日 ${fmtNum(treasuryPrev?.y2)}%</td><td>短端小幅下行，Fed 路径压力未继续上升</td></tr><tr><td>10Y 美债收益率</td><td>${fmtNum(treasuryCurrent?.y10)}%</td><td>${fmtNum((treasuryCurrent?.y10 - treasuryPrev?.y10) * 100, 0)} bp，前日 ${fmtNum(treasuryPrev?.y10)}%</td><td>停在 4.5% 下方，对成长股估值压力有限</td></tr><tr><td>30Y 美债收益率</td><td>${fmtNum(treasuryCurrent?.y30)}%</td><td>${fmtNum((treasuryCurrent?.y30 - treasuryPrev?.y30) * 100, 0)} bp，前日 ${fmtNum(treasuryPrev?.y30)}%</td><td>长端仍接近 5%，财政/期限溢价压力未消失</td></tr><tr><td>2Y-10Y 利差</td><td>${y210 > 0 ? "+" : ""}${y210} bps</td><td>自动计算</td><td>曲线小幅陡峭化</td></tr><tr><td>10Y-30Y 利差</td><td>${y1030 > 0 ? "+" : ""}${y1030} bps</td><td>自动计算</td><td>超长端相对更高，长久期资产仍需观察</td></tr></tbody></table></div><h4>3.2 Fed 降息预期</h4><div class="note-card">AP 引用 CME FedWatch 称，市场预期 Fed 在 6 月会议以及年内继续维持利率不变。精确概率暂无可靠数据。</div><h4>3.3 美元、黄金、原油、比特币</h4><div class="table-wrap"><table><thead><tr><th>资产</th><th>收盘 / 代理 ETF</th><th>涨跌幅</th><th>含义</th></tr></thead><tbody><tr><td>美元指数代理</td><td>UUP ${fmtNum(row(data, "UUP")?.c)}</td><td class="${classFor(row(data, "UUP")?.ch)}">${fmtPct(row(data, "UUP")?.ch)}</td><td>美元代理小跌，未压制成长股</td></tr><tr><td>黄金代理</td><td>GLD ${fmtNum(row(data, "GLD")?.c)}</td><td class="${classFor(row(data, "GLD")?.ch)}">${fmtPct(row(data, "GLD")?.ch)}</td><td>黄金上涨，可能反映避险与实际利率预期</td></tr><tr><td>WTI 原油</td><td>USO ${fmtNum(row(data, "USO")?.c)}</td><td class="${classFor(row(data, "USO")?.ch)}">WTI -1.7%；USO ${fmtPct(row(data, "USO")?.ch)}</td><td>油价回落缓和通胀压力</td></tr><tr><td>Brent 原油</td><td>BNO ${fmtNum(row(data, "BNO")?.c)}</td><td class="${classFor(row(data, "BNO")?.ch)}">Brent -1.7%；BNO ${fmtPct(row(data, "BNO")?.ch)}</td><td>美伊停火预期压低油价</td></tr><tr><td>比特币代理</td><td>IBIT ${fmtNum(row(data, "IBIT")?.c)}</td><td class="${classFor(row(data, "IBIT")?.ch)}">${fmtPct(row(data, "IBIT")?.ch)}</td><td>风险偏好平稳</td></tr><tr><td>以太坊代理</td><td>ETHA ${fmtNum(row(data, "ETHA")?.c)}</td><td class="${classFor(row(data, "ETHA")?.ch)}">${fmtPct(row(data, "ETHA")?.ch)}</td><td>加密资产温和上涨</td></tr></tbody></table></div><h4>3.4 当日重要经济数据</h4><div class="table-wrap"><table><thead><tr><th>数据</th><th>实际值</th><th>预期值</th><th>前值</th><th>市场解读</th></tr></thead><tbody>${economicRows(reportDate)}</tbody></table></div></section>
<section class="section" id="sector"><div class="section-head"><h3>板块表现</h3><span class="section-num">04</span></div><div class="table-wrap"><table><thead><tr><th>排名</th><th>板块</th><th>ETF</th><th>当日涨跌幅</th><th>收盘</th><th>日内高低</th><th>相对 SPY</th><th>主要驱动</th></tr></thead><tbody>${sectorStats.map((item, index) => sectorRow(item.sector, index + 1, data, spy)).join("")}</tbody></table></div><div class="chips"><span class="chip">最强：${strongestSector?.sector?.[0]}</span><span class="chip">最弱：${weakestSector?.sector?.[0]}</span><span class="chip">成长占优</span><span class="chip">防御走弱</span><span class="chip">软件补涨明显</span></div></section>
<section class="section" id="theme"><div class="section-head"><h3>主题与风格表现</h3><span class="section-num">05</span></div><div class="table-wrap"><table><thead><tr><th>主题 / 风格</th><th>代表 ETF / 股票</th><th>当日涨跌幅</th><th>收盘</th><th>解读</th></tr></thead><tbody><tr><td>软件</td><td>IGV</td><td class="good">${fmtPct(row(data, "IGV")?.ch)}</td><td>${fmtNum(row(data, "IGV")?.c)}</td><td>软件明显补涨，是当天最重要的风格变化之一</td></tr><tr><td>网络安全</td><td>CIBR / HACK</td><td class="good">${fmtPct(row(data, "CIBR")?.ch)} / ${fmtPct(row(data, "HACK")?.ch)}</td><td>${fmtNum(row(data, "CIBR")?.c)} / ${fmtNum(row(data, "HACK")?.c)}</td><td>安全软件强势扩散</td></tr><tr><td>云计算</td><td>CLOU / WCLD</td><td class="good">${fmtPct(row(data, "CLOU")?.ch)} / ${fmtPct(row(data, "WCLD")?.ch)}</td><td>${fmtNum(row(data, "CLOU")?.c)} / ${fmtNum(row(data, "WCLD")?.c)}</td><td>高 beta 云软件大涨</td></tr><tr><td>AI / 自动化</td><td>BOTZ / AIQ</td><td>${fmtPct(row(data, "BOTZ")?.ch)} / ${fmtPct(row(data, "AIQ")?.ch)}</td><td>${fmtNum(row(data, "BOTZ")?.c)} / ${fmtNum(row(data, "AIQ")?.c)}</td><td>AI 主题分化，综合 AIQ 强于机器人 BOTZ</td></tr><tr><td>半导体</td><td>SMH / SOXX</td><td class="bad">${fmtPct(row(data, "SMH")?.ch)} / ${fmtPct(row(data, "SOXX")?.ch)}</td><td>${fmtNum(row(data, "SMH")?.c)} / ${fmtNum(row(data, "SOXX")?.c)}</td><td>半导体未领涨，硬件高位震荡</td></tr><tr><td>小盘成长 / 价值</td><td>IWO / IWN</td><td class="bad">${fmtPct(row(data, "IWO")?.ch)} / ${fmtPct(row(data, "IWN")?.ch)}</td><td>${fmtNum(row(data, "IWO")?.c)} / ${fmtNum(row(data, "IWN")?.c)}</td><td>小盘成长和价值双双跑输</td></tr><tr><td>等权标普</td><td>RSP</td><td class="good">${fmtPct(row(data, "RSP")?.ch)}</td><td>${fmtNum(row(data, "RSP")?.c)}</td><td>略跑赢 SPY，说明部分扩散来自软件和金融</td></tr><tr><td>大盘成长 / 价值</td><td>SCHG / VTV</td><td class="good">${fmtPct(row(data, "SCHG")?.ch)} / ${fmtPct(row(data, "VTV")?.ch)}</td><td>${fmtNum(row(data, "SCHG")?.c)} / ${fmtNum(row(data, "VTV")?.c)}</td><td>大盘成长跑赢价值</td></tr></tbody></table></div></section>
<section class="section" id="breadth"><div class="section-head"><h3>市场宽度与参与度</h3><span class="section-num">06</span></div><div class="grid-2"><div class="mini-panel"><strong>6.1 均线参与度</strong><p>暂无可靠公开数据。仍需补 S&P 500、Nasdaq 100、NYSE、Russell 2000 高于 20/50/100/200 日均线比例。</p></div><div class="mini-panel"><strong>6.2 涨跌家数 / 新高新低</strong><p>暂无可靠公开数据。但 RSP ${fmtPct(rsp?.ch)}、IGV/CIBR/WCLD 大涨，说明宽度较单纯半导体领涨更好；IWM ${fmtPct(iwm?.ch)} 则说明小盘未扩散。</p></div></div><div class="source-box">结论：宽度比“少数权重拉指数”更好，但还不是全面 risk-on。软件和金融扩散，能源、消费、防御、小盘仍弱。</div></section>
<section class="section" id="technical"><div class="section-head"><h3>技术面分析</h3><span class="section-num">07</span></div><div class="table-wrap"><table><thead><tr><th>标的</th><th>收盘</th><th>涨跌幅</th><th>日内高低</th><th>成交量</th><th>趋势判断</th><th>关键观察</th></tr></thead><tbody>${technicalRow("SPY", data, "历史新高趋势", "指数本身无成交量，使用 SPY 代理；若跌回下方，留意假突破")}${technicalRow("QQQ", data, "成长强势", "使用 QQQ 代理 Nasdaq 100 技术数据，观察是否继续强于 SPY")}${technicalRow("IWM", data, "小盘跑输", "使用 IWM 代理 Russell 2000；若继续弱，风险偏好仍有隐患")}${technicalRow("SMH", data, "高位震荡", "半导体硬件链利好钝化")}${technicalRow("IGV", data, "强势突破", "软件补涨是否持续是关键")}${technicalRow("XLK", data, "板块领涨", "信息技术是否继续主导")}${technicalRow("XLC", data, "短线跑输", "通信服务内部偏弱")}${technicalRow("XLY", data, "消费走弱", "AMZN/TSLA 是否拖累继续")}</tbody></table></div></section>
<section class="section" id="movers"><div class="section-head"><h3>重点个股新闻与异动</h3><span class="section-num">08</span></div><h4>8.1 大型科技七巨头</h4><div class="table-wrap"><table><thead><tr><th>股票</th><th>收盘</th><th>涨跌幅</th><th>日内高低</th><th>原因 / 观察</th></tr></thead><tbody>${megaCapRows.map((item) => megaRow(item, data)).join("")}</tbody></table></div>${Object.entries(sectorExtraStocks).map(([title, symbols], index) => `<div class="mini-panel"><strong>8.${index + 2} ${title}</strong><p>${phraseList(data, symbols)}。${title === "AI 硬件 / 半导体" ? "AI 服务器链强，GPU/半导体 ETF 高位震荡。" : title === "软件 / SaaS / AI 应用" ? "软件补涨非常明确。" : "数据中心电力链当天整体分化偏弱。"}</p></div>`).join("")}</section>
<section class="section" id="earnings"><div class="section-head"><h3>财报日历与财报解读</h3><span class="section-num">09</span></div><div class="table-wrap"><table><thead><tr><th>公司</th><th>收入</th><th>EPS</th><th>指引 / 订单</th><th>股价反应</th><th>核心解读</th></tr></thead><tbody><tr><td>Dell Technologies</td><td>$43.8B，创纪录</td><td>GAAP $5.24；Non-GAAP $4.86</td><td>AI 订单 $24.4B，AI 服务器收入 $16.1B，FY2027 AI 服务器收入展望约 $60B</td><td class="good">${fmtPct(row(data, "DELL")?.ch)}</td><td>AI 基建需求继续验证，是当天硬件核心催化</td></tr></tbody></table></div><div class="source-box">接下来 1-3 个交易日财报日历暂无可靠公开抓取数据。重点仍关注 NVDA、AVGO、AMD、MRVL、MU、CRM、NOW、SNOW、ORCL、PANW、CRWD、VRT、ANET、SMCI、CEG、VST、FLNC、OKLO。</div></section>
<section class="section" id="flow"><div class="section-head"><h3>机构观点与资金流</h3><span class="section-num">10</span></div><div class="table-wrap"><table><thead><tr><th>机构 / 来源</th><th>观点</th><th>涉及资产</th><th>市场影响</th></tr></thead><tbody><tr><td>Edward Jones / AP 引用</td><td>市场上涨主要由科技和韧性盈利支撑，关键问题是能否持续</td><td>美股、科技股</td><td>强调上涨质量取决于科技之外的扩散能力</td></tr><tr><td>FactSet / AP 引用</td><td>S&P 500 最近一季整体盈利增长约 28%</td><td>S&P 500</td><td>盈利韧性对冲通胀和地缘扰动</td></tr><tr><td>ETF 资金流 / 期权异动</td><td>暂无可靠数据</td><td>暂无可靠数据</td><td>需补专门资金流来源</td></tr></tbody></table></div></section>
<section class="section" id="rotation"><div class="section-head"><h3>板块轮动判断</h3><span class="section-num">11</span></div><div class="chips"><span class="chip">软件补涨 / 估值修复</span><span class="chip">AI 硬件高位震荡</span><span class="chip">成长内部轮动</span><span class="chip">小盘未参与</span><span class="chip">防御走弱</span></div><ul><li>主要流入：软件、网络安全、云计算、信息技术、大型科技中的 MSFT。</li><li>主要流出 / 跑输：小盘、能源、必需消费、可选消费、通信服务、电力基础设施链部分股票。</li><li>AI 主线仍健康，但已经从硬件单点扩散到软件层；半导体当天没有继续领先。</li><li>当前市场更像“成长股内部轮动 + 指数高位延续”，不是全面普涨。</li></ul></section>
<section class="section" id="watchlist"><div class="section-head"><h3>我的重点关注股观察</h3><span class="section-num">12</span></div><div class="table-wrap"><table><thead><tr><th>股票</th><th>分组</th><th>收盘</th><th>涨跌幅</th><th>趋势 / 新闻</th><th>我的判断</th></tr></thead><tbody>${watchRows.map((item) => watchRow(item, data)).join("")}</tbody></table></div></section>
<section class="section" id="plan"><div class="section-head"><h3>明日交易计划 / 观察清单</h3><span class="section-num">13</span></div><div class="grid-2"><div class="mini-panel"><strong>宏观观察</strong><p>10Y 是否重新站上 4.5%；油价是否反弹；FedWatch 是否继续定价年内不降息。</p></div><div class="mini-panel"><strong>大盘观察</strong><p>SPY/QQQ 是否继续创新高；IWM 能否转强；RSP 是否继续跑赢 SPY。</p></div><div class="mini-panel"><strong>板块观察</strong><p>IGV/CIBR/WCLD 能否延续补涨；SMH/SOXX 是否重新领涨；XLP/XLE 是否继续走弱。</p></div><div class="mini-panel"><strong>个股观察</strong><p>DELL、MSFT、AVGO、NVDA、SMCI、CRM、NOW、ORCL、PLTR、PANW、CRWD、DDOG、NET、ANET、VRT、FLNC。</p></div></div></section>
<section class="section" id="risk"><div class="section-head"><h3>风险提示</h3><span class="section-num">14</span></div><div class="table-wrap"><table><thead><tr><th>风险维度</th><th>当前状态</th><th>风险等级</th></tr></thead><tbody><tr><td>宏观利率</td><td>10Y 仍接近 4.5%，PCE 同比 3.8%，核心 PCE 3.3%</td><td class="warn">中高</td></tr><tr><td>市场宽度</td><td>软件扩散改善，但小盘下跌、多个防御和消费板块走弱</td><td class="warn">中</td></tr><tr><td>AI 拥挤度</td><td>DELL、SMCI 大涨，NVDA/SMH 反而回落</td><td class="warn">中高</td></tr><tr><td>财报风险</td><td>Dell 质量较强，但后续软件和 AI 链财报预期抬高</td><td class="warn">中</td></tr><tr><td>地缘 / 油价</td><td>油价回落缓和压力，但霍尔木兹和中东风险仍在</td><td class="warn">中</td></tr><tr><td>技术面</td><td>指数连续创新高，部分软件单日涨幅较大</td><td class="warn">中</td></tr><tr><td>流动性</td><td>全美成交量高于 20 日均值</td><td class="good">中低</td></tr></tbody></table></div></section>
<section class="section" id="conclusion"><div class="section-head"><h3>最终结论</h3><span class="section-num">15</span></div><div class="grid-2"><div class="mini-panel"><strong>今日市场结论</strong><p>美股处在强趋势上涨阶段，但主线发生了细微变化：AI 硬件仍有催化，软件和云计算开始明显补涨。半导体 ETF 和 NVDA 回落，说明硬件端短线拥挤或利好钝化。</p></div><div class="mini-panel"><strong>当前市场阶段</strong><p>强趋势上涨 + 成长内部轮动 + 软件补涨。</p></div><div class="mini-panel"><strong>操作倾向</strong><p>不构成投资建议。追高硬件链需谨慎，可观察软件补涨持续性、IWM/RSP 宽度改善，以及 10Y/油价是否重新施压。</p></div></div><h4>最值得关注的 5 个信号</h4><div class="table-wrap"><table><thead><tr><th>#</th><th>观察信号</th><th>触发条件</th><th>可能含义</th></tr></thead><tbody><tr><td>1</td><td>IGV / 软件</td><td>继续跑赢 QQQ</td><td>资金从硬件扩散到应用层</td></tr><tr><td>2</td><td>SMH / SOXX</td><td>重新转强并跑赢 SPY</td><td>AI 硬件主线恢复</td></tr><tr><td>3</td><td>IWM</td><td>由跌转涨并跑赢 SPY</td><td>市场宽度真正改善</td></tr><tr><td>4</td><td>10Y 美债</td><td>重新上破 4.5%</td><td>压制成长估值</td></tr><tr><td>5</td><td>油价</td><td>WTI 回到 $90 附近</td><td>通胀和地缘压力回升</td></tr></tbody></table></div><div class="source-box">${sourceText(reportDate, treasury.url, vix.url)}</div></section>
<section class="section" id="archive"><div class="section-head"><h3>历史报告</h3><span class="section-num">HISTORY</span></div><p class="subtitle">历史版本会自动保存到 <a href="archive/">archive/</a>。GitHub Actions 每次生成新日报前，会把上一版按日期复制为历史报告。</p><div class="download-actions"><button class="pdf-button" onclick="downloadPdf()">下载本报告 PDF</button><a class="history-link" href="archive/">查看历史报告</a></div></section>
</article></main></div><script src="https://cdn.jsdelivr.net/npm/html2pdf.js@0.10.1/dist/html2pdf.bundle.min.js"></script><script>window.downloadPdf=function(){const date=document.body.dataset.reportDate||"latest";const filename="美股收盘日报-"+date+".pdf";const report=document.querySelector(".report");if(window.html2pdf&&report){html2pdf().set({margin:8,filename,image:{type:"jpeg",quality:.98},html2canvas:{scale:2,useCORS:true,backgroundColor:"#ffffff"},jsPDF:{unit:"mm",format:"a4",orientation:"portrait"},pagebreak:{mode:["css","legacy"]}}).from(report).save();return}window.print()}</script></body></html>`;
}

const data = await mapLimit([...etfs, ...stocks], 8, ([symbol, kind]) => fetchStockAnalysis(symbol, kind));
const reportDate = targetDateArg || row(data, "SPY")?.t;
if (!reportDate) throw new Error("Unable to determine report date from SPY.");
const [treasury, vix] = await Promise.all([fetchTreasury(reportDate), fetchVix(reportDate)]);

await archiveCurrent(reportDate);
await writeArchiveIndex(reportDate);
await writeFile(path.join(root, "index.html"), renderHtml({ reportDate, data, treasury, vix }), "utf8");
console.log(`Generated report for ${reportDate}`);
