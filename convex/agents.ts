import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { roomValidator, statusValidator } from "./schema";

// All agents — the canvas subscribes to this and re-renders reactively.
export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("agents").collect();
  },
});

// Move an agent to a new grid tile (used by the game loop / manual control).
export const move = mutation({
  args: {
    id: v.id("agents"),
    x: v.number(),
    y: v.number(),
    room: v.optional(roomValidator),
  },
  handler: async (ctx, args) => {
    const patch: { x: number; y: number; room?: typeof args.room } = {
      x: args.x,
      y: args.y,
    };
    if (args.room !== undefined) patch.room = args.room;
    await ctx.db.patch(args.id, patch);
  },
});

// Update an agent's status and optional speech bubble.
export const setStatus = mutation({
  args: {
    id: v.id("agents"),
    status: statusValidator,
    speech: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      status: args.status,
      speech: args.speech,
    });
  },
});
