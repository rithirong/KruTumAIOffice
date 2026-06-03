// Gold (XAUUSD) signal engine — a faithful TypeScript port of the strategy in
// the user's Python bot (gold/gold_sig.py). Same constants, indicators, 10-factor
// ScoreCard and ATR-based SL/TP. Differs only in that it pulls live prices from a
// free API (Yahoo GC=F gold futures) instead of cTrader, and never places real
// orders. Pure module — no Convex imports — so it is easy to test in isolation.

// ── strategy constants (verbatim from gold_sig.py) ──
const EMA_FAST = 9;
const EMA_SLOW = 21;
const BB_PERIOD = 20;
const BB_STD = 2.0;
const ATR_SL = 1.0;
const ATR_TP1 = 2.5;
const ATR_TP2 = 3.5;
const ATR_TP3 = 5.0;
const PULLBACK_ATR_MULT = 0.3;
const MIN_SCORE = 7;

export type Bar = {
  time: number; // ms epoch
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type GoldSignal = {
  price: number;
  direction: "BUY" | "SELL" | "HOLD";
  actionable: boolean; // true only when a real entry is triggered
  reason: string;
  score: number; // 0..10
  stars: string;
  entry: number;
  sl: number;
  tp1: number;
  tp2: number;
  tp3: number;
  rsi1h: number;
  rsi4h: number;
  atr: number;
  adx: number;
  emaDaily: "↑" | "↓";
  ema4h: "↑" | "↓";
  scorecard: Record<string, boolean>;
  asOf: number;
};

// ───────────────────────── data fetch ─────────────────────────

// Fetch ~60 days of 1h gold-futures bars from Yahoo Finance (no API key).
export async function fetchGoldBars(): Promise<Bar[]> {
  const url =
    "https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=1h&range=60d";
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`Yahoo fetch failed: ${res.status}`);
  const json = await res.json();
  const r = json?.chart?.result?.[0];
  if (!r) throw new Error("Yahoo returned no chart data");
  const ts: number[] = r.timestamp ?? [];
  const q = r.indicators?.quote?.[0] ?? {};
  const bars: Bar[] = [];
  for (let i = 0; i < ts.length; i++) {
    const o = q.open?.[i],
      h = q.high?.[i],
      l = q.low?.[i],
      c = q.close?.[i],
      v = q.volume?.[i];
    if (o == null || h == null || l == null || c == null) continue; // skip gaps
    bars.push({ time: ts[i] * 1000, open: o, high: h, low: l, close: c, volume: v ?? 0 });
  }
  return bars;
}

// Resample 1h bars into larger buckets (4h) or per-UTC-day (1d).
export function resample(bars: Bar[], bucketMs: number): Bar[] {
  const out: Bar[] = [];
  let cur: Bar | null = null;
  let key = -1;
  for (const b of bars) {
    const k = Math.floor(b.time / bucketMs);
    if (k !== key) {
      if (cur) out.push(cur);
      cur = { ...b };
      key = k;
    } else if (cur) {
      cur.high = Math.max(cur.high, b.high);
      cur.low = Math.min(cur.low, b.low);
      cur.close = b.close;
      cur.volume += b.volume;
    }
  }
  if (cur) out.push(cur);
  return out;
}

export function resampleDaily(bars: Bar[]): Bar[] {
  return resample(bars, 24 * 3600 * 1000);
}

// ───────────────────────── indicators ─────────────────────────

const last = <T>(a: T[]): T => a[a.length - 1];

// EMA with adjust=False semantics (recursive, seeded at the first value).
function ema(values: number[], n: number): number[] {
  const a = 2 / (n + 1);
  const out: number[] = [];
  values.forEach((v, i) => out.push(i === 0 ? v : a * v + (1 - a) * out[i - 1]));
  return out;
}

// Wilder smoothing (alpha = 1/n), seeded at the first sample.
function wilder(values: number[], n: number): number[] {
  const a = 1 / n;
  const out: number[] = [];
  values.forEach((v, i) => out.push(i === 0 ? v : out[i - 1] + a * (v - out[i - 1])));
  return out;
}

function rsi(closes: number[], n = 14): number[] {
  const gains: number[] = [0];
  const losses: number[] = [0];
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gains.push(Math.max(d, 0));
    losses.push(Math.max(-d, 0));
  }
  const ag = wilder(gains, n);
  const al = wilder(losses, n);
  return closes.map((_, i) => {
    const l = al[i];
    if (l === 0) return 100;
    const rs = ag[i] / l;
    return 100 - 100 / (1 + rs);
  });
}

function trueRanges(bars: Bar[]): number[] {
  return bars.map((b, i) => {
    if (i === 0) return b.high - b.low;
    const pc = bars[i - 1].close;
    return Math.max(b.high - b.low, Math.abs(b.high - pc), Math.abs(b.low - pc));
  });
}

function atr(bars: Bar[], n = 14): number[] {
  return wilder(trueRanges(bars), n);
}

// Returns the most recent { upper, lower, width } Bollinger reading and the
// previous width (to detect expansion).
function bollinger(closes: number[], n = BB_PERIOD, std = BB_STD) {
  const upper: number[] = [];
  const lower: number[] = [];
  const width: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < n - 1) {
      upper.push(NaN);
      lower.push(NaN);
      width.push(NaN);
      continue;
    }
    const w = closes.slice(i - n + 1, i + 1);
    const mid = w.reduce((s, x) => s + x, 0) / n;
    const variance = w.reduce((s, x) => s + (x - mid) ** 2, 0) / (n - 1); // sample std
    const sigma = Math.sqrt(variance);
    const up = mid + std * sigma;
    const lo = mid - std * sigma;
    upper.push(up);
    lower.push(lo);
    width.push(((up - lo) / mid) * 100);
  }
  return { upper, lower, width };
}

// Per-UTC-day cumulative VWAP.
function vwap(bars: Bar[]): number[] {
  const out: number[] = [];
  let day = -1;
  let cumTPV = 0;
  let cumVol = 0;
  for (const b of bars) {
    const d = Math.floor(b.time / (24 * 3600 * 1000));
    if (d !== day) {
      day = d;
      cumTPV = 0;
      cumVol = 0;
    }
    const tp = (b.high + b.low + b.close) / 3;
    cumTPV += tp * b.volume;
    cumVol += b.volume;
    out.push(cumVol ? cumTPV / cumVol : b.close);
  }
  return out;
}

function adxLast(bars: Bar[], n = 14): number {
  const plusDM: number[] = [0];
  const minusDM: number[] = [0];
  for (let i = 1; i < bars.length; i++) {
    const up = bars[i].high - bars[i - 1].high;
    const dn = bars[i - 1].low - bars[i].low;
    plusDM.push(Math.max(up, 0));
    minusDM.push(Math.max(dn, 0));
  }
  const atrArr = wilder(trueRanges(bars), n);
  const pDI = wilder(plusDM, n).map((v, i) => (atrArr[i] ? (100 * v) / atrArr[i] : 0));
  const mDI = wilder(minusDM, n).map((v, i) => (atrArr[i] ? (100 * v) / atrArr[i] : 0));
  const dx = pDI.map((p, i) => {
    const sum = p + mDI[i];
    return sum ? (100 * Math.abs(p - mDI[i])) / sum : 0;
  });
  return last(wilder(dx, n));
}

function marketStructure(closes: number[], lookback = 10): string {
  if (closes.length < lookback * 2) return "NEUTRAL";
  const recent = closes.slice(-lookback);
  const earlier = closes.slice(-lookback * 2, -lookback);
  const rMax = Math.max(...recent),
    rMin = Math.min(...recent);
  const eMax = Math.max(...earlier),
    eMin = Math.min(...earlier);
  if (rMax > eMax && rMin > eMin) return "BULLISH";
  if (rMax < eMax && rMin < eMin) return "BEARISH";
  return "NEUTRAL";
}

// Donchian-style breakout bounds for the latest bar (shift(1).rolling(n)).
function breakoutBounds(bars: Bar[], n = 20): { upper: number; lower: number } {
  const prev = bars.slice(-(n + 1), -1); // n bars before the last
  return {
    upper: Math.max(...prev.map((b) => b.high)),
    lower: Math.min(...prev.map((b) => b.low)),
  };
}

function starRating(t: number): string {
  if (t >= 9) return "🌟🌟🌟🌟🌟";
  if (t >= 8) return "⭐⭐⭐⭐";
  if (t >= 7) return "⭐⭐⭐";
  if (t >= 6) return "⭐⭐";
  return "⭐";
}

// ───────────────────────── analysis ─────────────────────────

export function computeSignal(h1: Bar[], h4: Bar[], d1: Bar[]): GoldSignal {
  const closes1h = h1.map((b) => b.close);
  const price = last(closes1h);
  const asOf = last(h1).time;

  const adx = adxLast(h1);
  const { upper, lower } = breakoutBounds(h1, 20);

  const efD = last(ema(d1.map((b) => b.close), EMA_FAST));
  const esD = last(ema(d1.map((b) => b.close), EMA_SLOW));
  const dailyBull = efD > esD;
  const ef4 = last(ema(h4.map((b) => b.close), EMA_FAST));
  const es4 = last(ema(h4.map((b) => b.close), EMA_SLOW));
  const h4Bull = ef4 > es4;

  const isUp = price > upper;
  const isDn = price < lower;

  // Effective direction: the breakout if any, else the daily-EMA bias.
  const direction: "BUY" | "SELL" = isUp
    ? "BUY"
    : isDn
      ? "SELL"
      : dailyBull
        ? "BUY"
        : "SELL";

  const rsi1hArr = rsi(closes1h);
  const rsi4hArr = rsi(h4.map((b) => b.close));
  const rsi1h = last(rsi1hArr);
  const rsi4h = last(rsi4hArr);

  const bb = bollinger(closes1h);
  const bbUpper = last(bb.upper);
  const bbLower = last(bb.lower);
  const bbW = bb.width[bb.width.length - 1];
  const bbWPrev = bb.width[bb.width.length - 2] ?? bbW;
  const vwapVal = last(vwap(h1));
  const atrVal = last(atr(h1));

  // 10-factor scorecard, evaluated for the effective direction.
  const emaAligned =
    (direction === "BUY" && dailyBull) || (direction === "SELL" && !dailyBull);
  const h4Aligned =
    (direction === "BUY" && h4Bull) || (direction === "SELL" && !h4Bull);
  const scorecard = {
    daily_ema_ok: emaAligned,
    h4_ema_ok: h4Aligned,
    market_struct:
      marketStructure(d1.map((b) => b.close)) ===
      (direction === "BUY" ? "BULLISH" : "BEARISH"),
    h1_cross: isUp || isDn,
    rsi_1h_ok: direction === "BUY" ? rsi1h > 50 && rsi1h < 72 : rsi1h > 28 && rsi1h < 50,
    rsi_4h_ok: direction === "BUY" ? rsi4h > 50 && rsi4h < 72 : rsi4h > 28 && rsi4h < 50,
    bb_breakout:
      (direction === "BUY" && price > bbUpper) ||
      (direction === "SELL" && price < bbLower),
    bb_expanding: bbW > bbWPrev,
    vwap_side:
      (direction === "BUY" && price > vwapVal) ||
      (direction === "SELL" && price < vwapVal),
    dxy_ok: adx > 20,
  };
  const score = Object.values(scorecard).filter(Boolean).length;

  // entry/SL/TP from a 0.3*ATR pullback off the breakout, per the Python bot.
  const r2 = (x: number) => Math.round(x * 100) / 100;
  const entry = r2(direction === "BUY" ? price - PULLBACK_ATR_MULT * atrVal : price + PULLBACK_ATR_MULT * atrVal);
  const sl = r2(direction === "BUY" ? entry - ATR_SL * atrVal : entry + ATR_SL * atrVal);
  const tp1 = r2(direction === "BUY" ? entry + ATR_TP1 * atrVal : entry - ATR_TP1 * atrVal);
  const tp2 = r2(direction === "BUY" ? entry + ATR_TP2 * atrVal : entry - ATR_TP2 * atrVal);
  const tp3 = r2(direction === "BUY" ? entry + ATR_TP3 * atrVal : entry - ATR_TP3 * atrVal);

  // A trade is actionable only on a real breakout + trend alignment + score.
  const actionable =
    (isUp || isDn) && adx > 20 && emaAligned && h4Aligned && score >= MIN_SCORE;

  let reason: string;
  if (!isUp && !isDn) reason = "ยังไม่มี breakout — ราคายังอยู่ในกรอบ";
  else if (adx <= 20) reason = `ADX ${adx.toFixed(1)} ต่ำกว่า 20 — เทรนด์ยังอ่อน`;
  else if (!emaAligned) reason = "EMA รายวันสวนทิศ — ข้าม";
  else if (!h4Aligned) reason = "EMA 4H สวนทิศ — ข้าม";
  else if (score < MIN_SCORE) reason = `คะแนน ${score}/10 ต่ำกว่าเกณฑ์ ${MIN_SCORE}`;
  else reason = `สัญญาณ ${direction} ผ่านเกณฑ์ ${score}/10`;

  return {
    price: r2(price),
    direction: actionable ? direction : "HOLD",
    actionable,
    reason,
    score,
    stars: starRating(score),
    entry,
    sl,
    tp1,
    tp2,
    tp3,
    rsi1h: r2(rsi1h),
    rsi4h: r2(rsi4h),
    atr: r2(atrVal),
    adx: r2(adx),
    emaDaily: dailyBull ? "↑" : "↓",
    ema4h: h4Bull ? "↑" : "↓",
    scorecard,
    asOf,
  };
}

// Convenience: fetch + resample + analyse in one call.
export async function analyzeGold(): Promise<GoldSignal> {
  const h1 = await fetchGoldBars();
  if (h1.length < 50) throw new Error("ข้อมูลราคาทองไม่พอสำหรับวิเคราะห์");
  const h4 = resample(h1, 4 * 3600 * 1000);
  const d1 = resampleDaily(h1);
  return computeSignal(h1, h4, d1);
}
