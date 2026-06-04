// Tiny shared helper to award XP to an agent. Called from completion mutations.
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

export async function addXp(
  ctx: MutationCtx,
  agentId: Id<"agents"> | undefined | null,
  amount: number,
) {
  if (!agentId) return;
  const a = await ctx.db.get(agentId);
  if (a) await ctx.db.patch(agentId, { xp: (a.xp ?? 0) + amount });
}

// Level from total XP: 100 XP per level (level 1 at 0 XP).
export function levelOf(xp: number): number {
  return Math.floor((xp ?? 0) / 100) + 1;
}
