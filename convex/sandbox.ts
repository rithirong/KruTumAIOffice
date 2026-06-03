// Devon's real code execution via the sandbox bridge (Docker). When
// SANDBOX_BRIDGE_URL is set, the orchestrator runs Devon's code for real and the
// task only passes if the script exits 0.

import { action, query, internalAction, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";

// Write code for a task and run it in the sandbox. Returns execution result, or
// { executed:false } if no bridge is configured (caller falls back to a description).
export const runForTask = internalAction({
  args: { taskTitle: v.string(), taskDescription: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{
    executed: boolean;
    ok?: boolean;
    code?: string;
    stdout?: string;
    stderr?: string;
    exitCode?: number;
  }> => {
    const url = process.env.SANDBOX_BRIDGE_URL;
    if (!url) return { executed: false };

    const { code } = await ctx.runAction(internal.ai.devWriteCode, {
      taskTitle: args.taskTitle,
      taskDescription: args.taskDescription,
    });

    try {
      const res = await fetch(`${url.replace(/\/$/, "")}/run`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Bridge-Token": process.env.SANDBOX_BRIDGE_TOKEN ?? "",
        },
        body: JSON.stringify({ code, language: "python" }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { executed: true, ok: false, code, stdout: "", stderr: body?.detail ?? `HTTP ${res.status}`, exitCode: -1 };
      }
      return {
        executed: true,
        ok: !!body.ok,
        code,
        stdout: body.stdout ?? "",
        stderr: body.stderr ?? "",
        exitCode: body.exit_code ?? -1,
      };
    } catch (err) {
      return { executed: true, ok: false, code, stdout: "", stderr: err instanceof Error ? err.message : String(err), exitCode: -1 };
    }
  },
});

export const storeRun = internalMutation({
  args: {
    taskId: v.optional(v.id("tasks")),
    agentId: v.id("agents"),
    title: v.string(),
    code: v.string(),
    stdout: v.string(),
    stderr: v.string(),
    exitCode: v.number(),
    ok: v.boolean(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("runs", args);
  },
});

export const bridgeStatus = action({
  args: {},
  handler: async (): Promise<Record<string, unknown>> => {
    const url = process.env.SANDBOX_BRIDGE_URL;
    if (!url) return { configured: false };
    try {
      const res = await fetch(`${url.replace(/\/$/, "")}/health`);
      const body = await res.json().catch(() => ({}));
      return { configured: true, reachable: res.ok, ...body };
    } catch (err) {
      return { configured: true, reachable: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
});

export const lastRun = query({
  args: {},
  handler: async (ctx) => {
    const r = await ctx.db.query("runs").order("desc").first();
    if (!r) return null;
    return {
      title: r.title,
      code: r.code,
      stdout: r.stdout,
      stderr: r.stderr,
      exitCode: r.exitCode,
      ok: r.ok,
    };
  },
});
