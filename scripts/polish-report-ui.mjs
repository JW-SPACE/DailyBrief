#!/usr/bin/env node
/**
 * Post-process generated static reports for readability.
 *
 * The report renderer intentionally keeps the data/template pipeline simple.
 * This pass only reshapes already-generated HTML so long LLM paragraphs become
 * scannable colored reading blocks without another model call.
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = "daily_reports";
const STYLE_ID = "daily-brief-reader-polish";

const STYLE = `<style id="${STYLE_ID}">
  .trading-overview-card {
    background: transparent;
    border: 0;
    padding: 0;
    margin: 0 0 1.45rem;
  }
  .trading-overview-card > .eyebrow {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    margin: 0 0 0.75rem;
    color: var(--fg);
  }
  .trading-overview-card > .eyebrow::before {
    content: "";
    width: 0.7rem;
    height: 0.7rem;
    border-radius: 0.2rem;
    background: linear-gradient(135deg, #38bdf8, #22c55e);
  }
  .reader-insight-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 0.7rem;
  }
  @media (min-width: 760px) {
    .reader-insight-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
  .reader-insight {
    border: 1px solid var(--rule);
    border-left: 5px solid var(--muted);
    border-radius: 8px;
    background: var(--bg-elevated);
    padding: 0.82rem 0.95rem;
    min-width: 0;
  }
  .reader-insight p {
    margin: 0.35rem 0 0;
    color: var(--fg-soft);
    font-size: 0.9rem;
    line-height: 1.65;
  }
  .reader-tag {
    display: inline-flex;
    width: fit-content;
    max-width: 100%;
    padding: 0.16rem 0.52rem;
    border-radius: 999px;
    font-size: 0.72rem;
    font-weight: 700;
    line-height: 1.35;
    background: var(--card);
    color: var(--muted);
  }
  .reader-insight.tone-bull { border-left-color: #22c55e; background: rgba(34,197,94,0.08); }
  .reader-insight.tone-bull .reader-tag { background: rgba(34,197,94,0.14); color: #15803d; }
  .reader-insight.tone-bear { border-left-color: #ef4444; background: rgba(239,68,68,0.08); }
  .reader-insight.tone-bear .reader-tag { background: rgba(239,68,68,0.14); color: #b91c1c; }
  .reader-insight.tone-caution { border-left-color: #f59e0b; background: rgba(245,158,11,0.1); }
  .reader-insight.tone-caution .reader-tag { background: rgba(245,158,11,0.16); color: #a16207; }
  .reader-insight.tone-info { border-left-color: #38bdf8; background: rgba(56,189,248,0.08); }
  .reader-insight.tone-info .reader-tag { background: rgba(56,189,248,0.16); color: #0369a1; }

  .trading-pick {
    padding: 0.95rem 1rem;
  }
  .pick-head { margin-bottom: 0.65rem; }
  .pick-rationale-list {
    display: grid;
    gap: 0.45rem;
  }
  .pick-reason {
    display: grid;
    grid-template-columns: 0.5rem 1fr;
    gap: 0.55rem;
    align-items: start;
    padding: 0.48rem 0.58rem;
    border-radius: 7px;
    color: var(--fg-soft);
    font-size: 0.86rem;
    line-height: 1.55;
    background: var(--card);
  }
  .reason-dot {
    width: 0.48rem;
    height: 0.48rem;
    border-radius: 999px;
    margin-top: 0.45rem;
    background: var(--muted);
  }
  .pick-reason.tone-bull { background: rgba(34,197,94,0.09); }
  .pick-reason.tone-bull .reason-dot { background: #22c55e; }
  .pick-reason.tone-bear { background: rgba(239,68,68,0.09); }
  .pick-reason.tone-bear .reason-dot { background: #ef4444; }
  .pick-reason.tone-caution { background: rgba(245,158,11,0.12); }
  .pick-reason.tone-caution .reason-dot { background: #f59e0b; }
  .pick-reason.tone-info { background: rgba(56,189,248,0.09); }
  .pick-reason.tone-info .reason-dot { background: #38bdf8; }

  .ticker-card {
    border-radius: 8px;
  }
  .ticker-indicators > div {
    background: var(--card);
    border-radius: 7px;
    padding: 0.38rem 0.5rem;
    align-items: center;
  }
  @media (prefers-color-scheme: dark) {
    .reader-insight.tone-bull .reader-tag { color: #86efac; }
    .reader-insight.tone-bear .reader-tag { color: #fca5a5; }
    .reader-insight.tone-caution .reader-tag { color: #fcd34d; }
    .reader-insight.tone-info .reader-tag { color: #7dd3fc; }
  }
</style>`;

function listReportHtmlFiles() {
  if (!fs.existsSync(ROOT)) return [];
  const files = [];
  const index = path.join(ROOT, "index.html");
  if (fs.existsSync(index)) files.push(index);

  for (const d of fs.readdirSync(ROOT)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    const file = path.join(ROOT, d, `${d}.html`);
    if (fs.existsSync(file)) files.push(file);
  }
  return files;
}

function isEnglishReport(html) {
  return /<html\s+lang="en"/i.test(html);
}

function normalizeText(text) {
  return text.replace(/\s+/g, " ").trim();
}

function splitSentences(text) {
  const decimalDot = "__DAILY_BRIEF_DECIMAL_DOT__";
  const protectedText = text.replace(/(\d)\.(?=\d)/g, `$1${decimalDot}`);
  return (protectedText.match(/[^。；;.!?]+[。；;.!?]?/g) ?? [protectedText]).map((sentence) =>
    sentence.split(decimalDot).join("."),
  );
}

function splitTextBlocks(text, maxItems = 8) {
  const normalized = normalizeText(text);
  if (!normalized) return [];
  const sentenceMatches = splitSentences(normalized);
  const pieces = [];

  for (const sentence of sentenceMatches) {
    const clean = normalizeText(sentence);
    if (!clean) continue;
    if (clean.length <= 96 || !clean.includes("，")) {
      pieces.push(clean);
      continue;
    }

    let current = "";
    for (const part of clean.split("，")) {
      const next = current ? `${current}，${part}` : part;
      if (next.length > 76 && current) {
        pieces.push(`${current}，`);
        current = part;
      } else {
        current = next;
      }
    }
    if (current) pieces.push(current);
  }

  return pieces.slice(0, maxItems);
}

function toneFor(text) {
  if (/空头|看空|下行|下跌|低于|跌破|承压|恐慌|弱势|bear|negative/i.test(text)) {
    return "bear";
  }
  if (/多头|看多|上行|上涨|高于|站上|反弹|金叉|偏强|bull|positive/i.test(text)) {
    return "bull";
  }
  if (/风险|超买|超卖|震荡|观望|等待|分化|neutral|caution/i.test(text)) {
    return "caution";
  }
  return "info";
}

function labelFor(text, en) {
  const labels = en
    ? {
        crypto: "Crypto",
        us: "US",
        china: "China/HK",
        macro: "Macro",
        commodity: "Commodities",
        technical: "Technical",
        focus: "Point",
      }
    : {
        crypto: "加密",
        us: "美股",
        china: "中港",
        macro: "宏观",
        commodity: "商品",
        technical: "技术",
        focus: "要点",
      };
  if (/BTC|ETH|SOL|加密|恐慌|Coin|crypto/i.test(text)) return labels.crypto;
  if (/SPY|QQQ|AAPL|MSFT|NVDA|TSLA|META|GOOGL|美股|S&P|Nasdaq/i.test(text)) return labels.us;
  if (/BABA|PDD|JD|0700|港股|中概|腾讯|阿里/i.test(text)) return labels.china;
  if (/DXY|VIX|TNX|美元|美债|宏观|dominance/i.test(text)) return labels.macro;
  if (/黄金|原油|GC=F|CL=F|WTI|商品|gold|oil/i.test(text)) return labels.commodity;
  if (/SMA|RSI|MACD|均线|金叉|死叉|技术/i.test(text)) return labels.technical;
  return labels.focus;
}

function renderInsightBlocks(text, en) {
  const blocks = splitTextBlocks(text, 8);
  if (blocks.length === 0) return "";
  return `<div class="overview-text trading-overview-text reader-insight-grid">${blocks
    .map(
      (block) =>
        `<div class="reader-insight tone-${toneFor(block)}"><span class="reader-tag">${labelFor(block, en)}</span><p>${block}</p></div>`,
    )
    .join("")}</div>`;
}

function renderPickReasons(text) {
  const blocks = splitTextBlocks(text, 4);
  if (blocks.length === 0) return "";
  return `<div class="pick-rationale-list">${blocks
    .map(
      (block) =>
        `<div class="pick-reason tone-${toneFor(block)}"><span class="reason-dot"></span><span>${block}</span></div>`,
    )
    .join("")}</div>`;
}

function stripExistingStyle(html) {
  return html.replace(new RegExp(`\\n?<style id="${STYLE_ID}">[\\s\\S]*?<\\/style>\\n?`, "g"), "\n");
}

function polishHtml(html) {
  const en = isEnglishReport(html);
  let next = stripExistingStyle(html);

  next = next.replace(
    /<p class="overview-text trading-overview-text">([\s\S]*?)<\/p>/g,
    (_match, text) => renderInsightBlocks(text, en),
  );

  next = next.replace(
    /<p class="pick-rationale">([\s\S]*?)<\/p>/g,
    (_match, text) => renderPickReasons(text),
  );

  if (next.includes("</head>")) {
    next = next.replace("</head>", `${STYLE}\n</head>`);
  }
  return next;
}

const files = listReportHtmlFiles();
if (files.length === 0) {
  console.log("[polish-report-ui] no report HTML files found");
  process.exit(0);
}

for (const file of files) {
  const before = fs.readFileSync(file, "utf8");
  const after = polishHtml(before);
  if (after !== before) {
    fs.writeFileSync(file, after, "utf8");
    console.log(`[polish-report-ui] polished ${file}`);
  } else {
    console.log(`[polish-report-ui] unchanged ${file}`);
  }
}
