// ครูตั้ม the educator: writes Google Apps Script math teaching materials in the
// user's house style. Each material is a standalone GAS web app (รหัส.js + Index.html).

import { action, query, internalQuery, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { addXp } from "./xp";

const CLASSROOM_DESKS: [number, number][] = [
  [11, 2],
  [12, 2],
  [13, 2],
  [12, 3],
];

// Standard doGet wrapper for a material (matches the house style exactly).
function buildCodeJs(title: string): string {
  return `function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
      .setTitle(${JSON.stringify(title)})
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}`;
}

export const getEducator = internalQuery({
  args: {},
  handler: async (ctx) => {
    const agents = await ctx.db.query("agents").collect();
    const ed = agents.find((a) => a.role === "Educator") ?? null;
    return ed && { id: ed._id, name: ed.name, persona: ed.personality };
  },
});

export const setEducator = internalMutation({
  args: {
    id: v.id("agents"),
    status: v.union(v.literal("idle"), v.literal("thinking"), v.literal("working")),
    speech: v.string(),
  },
  handler: async (ctx, args) => {
    const desk = CLASSROOM_DESKS[Math.floor(Math.random() * CLASSROOM_DESKS.length)];
    await ctx.db.patch(args.id, {
      status: args.status,
      speech: args.speech,
      x: desk[0],
      y: desk[1],
      room: "classroom",
    });
  },
});

export const storeMaterial = internalMutation({
  args: {
    agentId: v.id("agents"),
    topic: v.string(),
    title: v.string(),
    codeJs: v.string(),
    indexHtml: v.string(),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("materials", args);
    await ctx.db.insert("events", {
      type: "material_created",
      actorId: args.agentId,
      data: JSON.stringify({ topic: args.topic, bytes: args.indexHtml.length }),
    });
    await addXp(ctx, args.agentId, 12); // created a teaching material
    return id;
  },
});

// Generate a GAS teaching material for a topic. Human-triggered (button).
export const createMaterial = action({
  args: { topic: v.string() },
  handler: async (ctx, args): Promise<{ ok: boolean; title: string }> => {
    const ed = await ctx.runQuery(internal.educator.getEducator, {});
    if (!ed) return { ok: false, title: "" };
    const topic = args.topic.trim() || "การบวกเลขสองหลัก";

    await ctx.runMutation(internal.educator.setEducator, {
      id: ed.id,
      status: "working",
      speech: `กำลังออกแบบสื่อเรื่อง "${topic}" ครับ…`,
    });

    const { html } = await ctx.runAction(internal.ai.gasCreateMaterial, { topic });

    await ctx.runMutation(internal.educator.storeMaterial, {
      agentId: ed.id,
      topic,
      title: topic,
      codeJs: buildCodeJs(topic),
      indexHtml: html,
    });

    await ctx.runMutation(internal.educator.setEducator, {
      id: ed.id,
      status: "idle",
      speech: `จัดสื่อเรื่อง "${topic}" ให้แล้วครับ ลองกดดูได้เลย`,
    });

    return { ok: true, title: topic };
  },
});

// Lightweight list for the UI (no big html payloads).
export const listMaterials = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("materials").order("desc").take(20);
    return rows.map((r) => ({ id: r._id, title: r.title, topic: r.topic, bytes: r.indexHtml.length }));
  },
});

// Full material (code + html) for viewing one.
export const getMaterial = query({
  args: { id: v.id("materials") },
  handler: async (ctx, args) => {
    const m = await ctx.db.get(args.id);
    if (!m) return null;
    return { title: m.title, topic: m.topic, codeJs: m.codeJs, indexHtml: m.indexHtml };
  },
});
