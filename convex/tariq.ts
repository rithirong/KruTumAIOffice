// Tariq the trader: fetches live gold prices, runs the ported signal engine, and
// paper-trades against his portfolio. Real orders are NEVER placed by the loop —
// they are gated behind an explicit human action (submitRealOrder).

import { action, query, internalQuery, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { analyzeGold, type GoldSignal } from "./goldSignal";

const RISK_FRACTION = 0.02; // risk ~2% of cash per trade on the SL distance
const ATR_SL = 1.0;
const ATR_TP1 = 2.5;
const TRADING_DESKS: [number, number][] = [
  [9, 7],
  [11, 7],
  [9, 9],
  [11, 9],
];

type Position = {
  side: "BUY" | "SELL";
  entry: number;
  sl: number;
  tp1: number;
  units: number;
  openedAt: number;
};

function parsePosition(holdings: string): Position | null {
  try {
    return JSON.parse(holdings)?.position ?? null;
  } catch {
    return null;
  }
}

function unrealized(p: Position, price: number): number {
  return (price - p.entry) * p.units * (p.side === "BUY" ? 1 : -1);
}

// ───────── internal state helpers ─────────

export const getTrader = internalQuery({
  args: {},
  handler: async (ctx) => {
    const agents = await ctx.db.query("agents").collect();
    const trader = agents.find((a) => a.role === "Trader") ?? null;
    if (!trader) return null;
    const pf = await ctx.db
      .query("portfolio")
      .withIndex("by_agent", (q) => q.eq("agentId", trader._id))
      .first();
    if (!pf) return null;
    return {
      agentId: trader._id,
      name: trader.name,
      persona: trader.personality,
      portfolioId: pf._id,
      cash: pf.cash,
      holdings: pf.holdings,
      realizedPnl: pf.realizedPnl ?? 0,
    };
  },
});

export const setLastSignal = internalMutation({
  args: { portfolioId: v.id("portfolio"), signal: v.string(), totalValue: v.number() },
  handler: async (ctx, args) => {
    const pf = await ctx.db.get(args.portfolioId);
    await ctx.db.patch(args.portfolioId, {
      lastSignal: args.signal,
      totalValue: args.totalValue,
    });
    // Append an equity-curve point for the chart.
    if (pf) {
      await ctx.db.insert("equity", {
        agentId: pf.agentId,
        value: args.totalValue,
        cash: pf.cash,
      });
    }
  },
});

export const openPosition = internalMutation({
  args: {
    portfolioId: v.id("portfolio"),
    agentId: v.id("agents"),
    position: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.portfolioId, {
      holdings: JSON.stringify({ position: JSON.parse(args.position) }),
    });
    await ctx.db.insert("events", {
      type: "paper_open",
      actorId: args.agentId,
      data: args.position,
    });
  },
});

export const closePosition = internalMutation({
  args: {
    portfolioId: v.id("portfolio"),
    agentId: v.id("agents"),
    exit: v.number(),
    pnl: v.number(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const pf = await ctx.db.get(args.portfolioId);
    if (!pf) return;
    const cash = pf.cash + args.pnl;
    await ctx.db.patch(args.portfolioId, {
      cash,
      totalValue: cash,
      realizedPnl: (pf.realizedPnl ?? 0) + args.pnl,
      holdings: JSON.stringify({ position: null }),
    });
    await ctx.db.insert("events", {
      type: "paper_close",
      actorId: args.agentId,
      data: JSON.stringify({ exit: args.exit, pnl: args.pnl, reason: args.reason }),
    });
  },
});

export const moveTrader = internalMutation({
  args: {
    agentId: v.id("agents"),
    status: v.union(v.literal("idle"), v.literal("thinking"), v.literal("working")),
    speech: v.string(),
  },
  handler: async (ctx, args) => {
    const desk = TRADING_DESKS[Math.floor(Math.random() * TRADING_DESKS.length)];
    await ctx.db.patch(args.agentId, {
      status: args.status,
      speech: args.speech,
      x: desk[0],
      y: desk[1],
      room: "trading_floor",
    });
  },
});

// ───────── the trading beat ─────────

export const tradeStep = action({
  args: {},
  handler: async (
    ctx,
  ): Promise<{ action: string; direction: string; price: number; detail: string }> => {
    const t = await ctx.runQuery(internal.tariq.getTrader, {});
    if (!t) return { action: "idle", direction: "-", price: 0, detail: "ยังไม่มีเทรดเดอร์/พอร์ต" };

    const signal: GoldSignal = await analyzeGold();
    const price = signal.price;
    const pos = parsePosition(t.holdings);

    let action = "watching";
    let detail = signal.reason;
    let totalValue = t.cash;

    if (pos) {
      // Manage the open position: check SL / TP against the latest price.
      const hitTP = pos.side === "BUY" ? price >= pos.tp1 : price <= pos.tp1;
      const hitSL = pos.side === "BUY" ? price <= pos.sl : price >= pos.sl;
      if (hitTP || hitSL) {
        const exit = hitTP ? pos.tp1 : pos.sl;
        const pnl = (exit - pos.entry) * pos.units * (pos.side === "BUY" ? 1 : -1);
        await ctx.runMutation(internal.tariq.closePosition, {
          portfolioId: t.portfolioId,
          agentId: t.agentId,
          exit,
          pnl,
          reason: hitTP ? "TP1" : "SL",
        });
        totalValue = t.cash + pnl;
        action = pnl >= 0 ? "ปิดกำไร" : "ปิดขาดทุน";
        detail = `${pos.side} ปิดที่ ${exit.toFixed(2)} (${hitTP ? "TP1" : "SL"}) P/L ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}`;
      } else {
        totalValue = t.cash + unrealized(pos, price);
        action = "ถือสถานะ";
        detail = `${pos.side} @ ${pos.entry.toFixed(2)} | ราคา ${price.toFixed(2)} | กำไรลอย ${unrealized(pos, price) >= 0 ? "+" : ""}${unrealized(pos, price).toFixed(2)}`;
      }
    } else if (signal.actionable) {
      // Open a fresh paper position sized to risk ~2% of cash on the SL distance.
      const slDist = signal.atr * ATR_SL;
      const units = Math.max(1, Math.floor((t.cash * RISK_FRACTION) / Math.max(slDist, 0.01)));
      const side = signal.direction as "BUY" | "SELL";
      const newPos: Position = {
        side,
        entry: price,
        sl: side === "BUY" ? price - slDist : price + slDist,
        tp1: side === "BUY" ? price + signal.atr * ATR_TP1 : price - signal.atr * ATR_TP1,
        units,
        openedAt: Date.now(),
      };
      await ctx.runMutation(internal.tariq.openPosition, {
        portfolioId: t.portfolioId,
        agentId: t.agentId,
        position: JSON.stringify(newPos),
      });
      action = "เปิดสถานะ";
      detail = `${side} ${units} หน่วย @ ${price.toFixed(2)} SL ${newPos.sl.toFixed(2)} TP ${newPos.tp1.toFixed(2)} (${signal.score}/10)`;
    }

    await ctx.runMutation(internal.tariq.setLastSignal, {
      portfolioId: t.portfolioId,
      signal: JSON.stringify(signal),
      totalValue,
    });

    // Narrate in character.
    const { speech } = await ctx.runAction(internal.ai.traderNarrate, {
      name: t.name,
      persona: t.persona,
      summary:
        `ทองราคา ${price.toFixed(2)} | คะแนน ${signal.score}/10 ${signal.stars} | ` +
        `RSI ${signal.rsi1h} ADX ${signal.adx} | การกระทำ: ${action} — ${detail}`,
    });
    await ctx.runMutation(internal.tariq.moveTrader, {
      agentId: t.agentId,
      status: action === "watching" ? "thinking" : "working",
      speech,
    });

    return { action, direction: signal.direction, price, detail };
  },
});

// ───────── public reads for the UI ─────────

export const dashboard = query({
  args: {},
  handler: async (ctx) => {
    const agents = await ctx.db.query("agents").collect();
    const trader = agents.find((a) => a.role === "Trader");
    if (!trader) return null;
    const pf = await ctx.db
      .query("portfolio")
      .withIndex("by_agent", (q) => q.eq("agentId", trader._id))
      .first();
    if (!pf) return null;
    return {
      name: trader.name,
      cash: pf.cash,
      totalValue: pf.totalValue,
      realizedPnl: pf.realizedPnl ?? 0,
      position: parsePosition(pf.holdings),
      signal: pf.lastSignal ? (JSON.parse(pf.lastSignal) as GoldSignal) : null,
    };
  },
});

// Equity curve for the trader (oldest → newest), capped for the chart.
export const equityHistory = query({
  args: {},
  handler: async (ctx) => {
    const agents = await ctx.db.query("agents").collect();
    const trader = agents.find((a) => a.role === "Trader");
    if (!trader) return [];
    const rows = await ctx.db
      .query("equity")
      .withIndex("by_agent", (q) => q.eq("agentId", trader._id))
      .order("desc")
      .take(150);
    return rows.reverse().map((r) => ({ t: r._creationTime, value: r.value }));
  },
});

// ───────── gated real-order (human-confirmed only) ─────────

// Audit-log helper for real-order attempts (actions can't write the db directly).
export const logRealOrder = internalMutation({
  args: { type: v.string(), data: v.string() },
  handler: async (ctx, args) => {
    const agents = await ctx.db.query("agents").collect();
    const trader = agents.find((a) => a.role === "Trader");
    await ctx.db.insert("events", { type: args.type, actorId: trader?._id, data: args.data });
  },
});

// Places a REAL order — but only when a human clicks the button. If the MT5
// bridge is configured (MT5_BRIDGE_URL), it POSTs to the bridge, which is
// demo-guarded. If not configured, it just records the intent. The autonomous
// loop never calls this.
export const submitRealOrder = action({
  args: { side: v.string(), entry: v.number(), sl: v.number(), tp1: v.number(), units: v.number() },
  handler: async (ctx, args): Promise<{ ok: boolean; placed: boolean; message: string }> => {
    const url = process.env.MT5_BRIDGE_URL;
    const token = process.env.MT5_BRIDGE_TOKEN ?? "";
    const lot = parseFloat(process.env.MT5_LOT ?? "0.01");

    if (!url) {
      await ctx.runMutation(internal.tariq.logRealOrder, {
        type: "real_order_intent",
        data: JSON.stringify({ ...args, note: "MT5 bridge ไม่ได้ตั้งค่า — บันทึกเจตนาเท่านั้น" }),
      });
      return {
        ok: true,
        placed: false,
        message: "บันทึกคำสั่งไว้แล้ว (ยังไม่ได้ตั้งค่า MT5 bridge — ดู mt5-bridge/README.md)",
      };
    }

    try {
      const res = await fetch(`${url.replace(/\/$/, "")}/order`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Bridge-Token": token },
        body: JSON.stringify({ side: args.side, volume: lot, sl: args.sl, tp: args.tp1 }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        await ctx.runMutation(internal.tariq.logRealOrder, {
          type: "real_order_failed",
          data: JSON.stringify({ ...args, status: res.status, body }),
        });
        return { ok: false, placed: false, message: `MT5 ปฏิเสธคำสั่ง: ${body?.detail ?? res.status}` };
      }
      await ctx.runMutation(internal.tariq.logRealOrder, {
        type: "real_order_placed",
        data: JSON.stringify({ ...args, lot, demo: body?.demo, result: body?.result }),
      });
      return {
        ok: true,
        placed: true,
        message: `ส่งคำสั่งจริงสำเร็จ${body?.demo ? " (บัญชี Demo)" : ""} — ${args.side} ${lot} lot`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await ctx.runMutation(internal.tariq.logRealOrder, {
        type: "real_order_failed",
        data: JSON.stringify({ ...args, error: msg }),
      });
      return { ok: false, placed: false, message: `เชื่อมต่อ MT5 bridge ไม่ได้: ${msg}` };
    }
  },
});

// Health of the MT5 bridge, for a UI indicator. Never throws.
export const bridgeStatus = action({
  args: {},
  handler: async (): Promise<Record<string, unknown>> => {
    const url = process.env.MT5_BRIDGE_URL;
    if (!url) return { configured: false };
    try {
      const res = await fetch(`${url.replace(/\/$/, "")}/health`);
      const body = await res.json().catch(() => ({}));
      return { configured: true, reachable: res.ok, ...body };
    } catch (err) {
      return {
        configured: true,
        reachable: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
});

// Compute the current gold signal without trading (testing / manual refresh).
export const analyze = action({
  args: {},
  handler: async () => await analyzeGold(),
});
