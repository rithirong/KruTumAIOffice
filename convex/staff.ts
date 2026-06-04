// Hired Staff (from the catalog) do real department work: each tick one Staff
// member produces a small deliverable in their division, narrated in character,
// and it lands in the team feed.

import { action, query, internalQuery, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";

const SPOTS: [number, number][] = [
  [6, 4],
  [7, 5],
  [8, 4],
  [9, 5],
  [5, 5],
  [10, 4],
];

// division is stored as the first part of backstory ("division • vibe").
function divisionOf(backstory: string): string {
  return backstory.split("•")[0].trim();
}

export const pickStaff = internalQuery({
  args: {},
  handler: async (ctx) => {
    const staff = await ctx.db
      .query("agents")
      .withIndex("by_role", (q) => q.eq("role", "Staff"))
      .collect();
    if (staff.length === 0) return null;
    // Prefer an idle one; otherwise anyone. Random to spread the work around.
    const idle = staff.filter((s) => s.status === "idle");
    const pool = idle.length ? idle : staff;
    const a = pool[Math.floor(Math.random() * pool.length)];
    return { id: a._id, name: a.name, division: divisionOf(a.backstory), persona: a.personality };
  },
});

export const recordWork = internalMutation({
  args: {
    agentId: v.id("agents"),
    name: v.string(),
    division: v.string(),
    output: v.string(),
    speech: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("works", {
      agentId: args.agentId,
      name: args.name,
      division: args.division,
      output: args.output,
    });
    const spot = SPOTS[Math.floor(Math.random() * SPOTS.length)];
    await ctx.db.patch(args.agentId, {
      status: "working",
      speech: args.speech,
      x: spot[0],
      y: spot[1],
      room: "office",
    });
  },
});

// One Staff member does a beat of department work. No-op if no Staff are hired.
export const doWork = action({
  args: {},
  handler: async (ctx): Promise<{ ok: boolean; name?: string; output?: string }> => {
    const s = await ctx.runQuery(internal.staff.pickStaff, {});
    if (!s) return { ok: false };
    const res = await ctx.runAction(internal.ai.staffWork, {
      name: s.name,
      division: s.division,
      persona: s.persona,
    });
    await ctx.runMutation(internal.staff.recordWork, {
      agentId: s.id,
      name: s.name,
      division: s.division,
      output: res.output,
      speech: res.speech,
    });
    return { ok: true, name: s.name, output: res.output };
  },
});

export const recentWorks = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("works").order("desc").take(12);
    return rows.map((r) => ({ id: r._id, name: r.name, division: r.division, output: r.output }));
  },
});
