// "Hire from catalog" — turns a persona from the bundled agency-agents catalog
// into a new Staff agent placed in the open office area.

import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const hire = mutation({
  args: {
    name: v.string(),
    division: v.string(),
    vibe: v.string(),
    color: v.string(),
    emoji: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("agents")
      .filter((q) => q.eq(q.field("name"), args.name))
      .first();
    if (existing) return { hired: false, reason: "already on the team" };

    // Scatter new hires across the open office floor (avoid the labelled rooms).
    const x = 1 + Math.floor(Math.random() * 12);
    const y = 4 + Math.floor(Math.random() * 2); // hallway rows 4–5
    await ctx.db.insert("agents", {
      name: args.name,
      role: "Staff",
      backstory: `${args.division} • ${args.vibe}`,
      personality: args.vibe,
      x,
      y,
      room: "office",
      status: "idle",
      color: args.color,
      speech: args.emoji,
    });
    return { hired: true };
  },
});

export const fire = mutation({
  args: { id: v.id("agents") },
  handler: async (ctx, args) => {
    const a = await ctx.db.get(args.id);
    if (a && a.role === "Staff") await ctx.db.delete(args.id);
  },
});

export const listHired = query({
  args: {},
  handler: async (ctx) => {
    const staff = await ctx.db
      .query("agents")
      .withIndex("by_role", (q) => q.eq("role", "Staff"))
      .collect();
    return staff.map((a) => ({ id: a._id, name: a.name, vibe: a.personality, color: a.color }));
  },
});
