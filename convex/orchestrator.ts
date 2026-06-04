// The agent orchestrator: a small state machine that advances the company one
// "beat" at a time. A beat is either the CEO delegating a task, the developer
// starting it, or the developer finishing it — so the CEO -> Dev loop is always
// visible on the canvas. `step` runs one beat; `start`/`stop` drive a
// self-rescheduling game loop.

import { v } from "convex/values";
import { internal, api } from "./_generated/api";
import {
  action,
  mutation,
  query,
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";

const LOOP_MS = 4000;
const DEV_DESKS: [number, number][] = [
  [2, 7],
  [4, 7],
  [2, 9],
  [4, 9],
];

// ---------- internal state helpers ----------

export const getState = internalQuery({
  args: {},
  handler: async (ctx) => {
    const agents = await ctx.db.query("agents").collect();
    const ceo = agents.find((a) => a.role === "CEO") ?? null;
    const dev = agents.find((a) => a.role === "Developer") ?? null;

    let openTask = null;
    if (dev) {
      const tasks = await ctx.db
        .query("tasks")
        .withIndex("by_assignee", (q) => q.eq("assignedTo", dev._id))
        .collect();
      openTask =
        tasks.find(
          (t) => t.status === "backlog" || t.status === "in_progress",
        ) ?? null;
    }

    const doneTasks = await ctx.db
      .query("tasks")
      .withIndex("by_status", (q) => q.eq("status", "done"))
      .order("desc")
      .take(5);

    return {
      ceo: ceo && {
        id: ceo._id,
        name: ceo.name,
        persona: ceo.personality,
      },
      dev: dev && {
        id: dev._id,
        name: dev.name,
        persona: dev.personality,
      },
      openTask: openTask && {
        id: openTask._id,
        title: openTask.title,
        description: openTask.description,
        status: openTask.status,
        requiresApproval: openTask.requiresApproval,
      },
      recentTitles: doneTasks.map((t) => t.title),
    };
  },
});

export const setSpeech = internalMutation({
  args: {
    id: v.id("agents"),
    status: v.union(
      v.literal("idle"),
      v.literal("thinking"),
      v.literal("working"),
      v.literal("in_meeting"),
    ),
    speech: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { status: args.status, speech: args.speech });
  },
});

// CEO assigns a new task to the developer (strict-JSON message + task row).
export const assignTask = internalMutation({
  args: {
    ceoId: v.id("agents"),
    devId: v.id("agents"),
    title: v.string(),
    description: v.string(),
    ceoSpeech: v.string(),
    requiresApproval: v.boolean(),
  },
  handler: async (ctx, args) => {
    const taskId = await ctx.db.insert("tasks", {
      title: args.title,
      description: args.description,
      status: "backlog",
      priority: args.requiresApproval ? "high" : "medium",
      createdBy: args.ceoId,
      assignedTo: args.devId,
      requiresApproval: args.requiresApproval,
      approved: false,
    });

    await ctx.db.insert("messages", {
      from: args.ceoId,
      to: args.devId,
      type: "task_assignment",
      payload: JSON.stringify({
        taskId,
        title: args.title,
        priority: args.requiresApproval ? "high" : "medium",
        requiresApproval: args.requiresApproval,
      }),
    });

    await ctx.db.patch(args.ceoId, { status: "idle", speech: args.ceoSpeech });
    await ctx.db.patch(args.devId, { status: "thinking", speech: "รับทราบครับ" });
    await ctx.db.insert("events", {
      type: "task_assigned",
      actorId: args.ceoId,
      data: JSON.stringify({ taskId, title: args.title }),
    });
    return taskId;
  },
});

// Developer starts working: walk to a desk, flip task to in_progress.
export const startWork = internalMutation({
  args: { devId: v.id("agents"), taskId: v.id("tasks") },
  handler: async (ctx, args) => {
    const desk = DEV_DESKS[Math.floor(Math.random() * DEV_DESKS.length)];
    await ctx.db.patch(args.taskId, { status: "in_progress" });
    await ctx.db.patch(args.devId, {
      status: "working",
      speech: "ลงมือพัฒนาแล้ว…",
      x: desk[0],
      y: desk[1],
      room: "dev_room",
    });
  },
});

// Developer finishes. If the task needs sign-off it goes to `awaiting_approval`
// (a human must approve before it counts as done); otherwise it's done outright.
export const completeWork = internalMutation({
  args: {
    devId: v.id("agents"),
    ceoId: v.id("agents"),
    taskId: v.id("tasks"),
    result: v.string(),
    speech: v.string(),
    requiresApproval: v.boolean(),
    ranOk: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    // Sandbox run failed → the task fails (no approval path).
    if (args.ranOk === false) {
      await ctx.db.patch(args.taskId, { status: "failed", approved: false });
      await ctx.db.insert("messages", {
        from: args.devId,
        to: args.ceoId,
        type: "status_update",
        payload: JSON.stringify({ taskId: args.taskId, result: args.result }),
      });
      await ctx.db.patch(args.devId, { status: "idle", speech: args.speech });
      await ctx.db.insert("events", {
        type: "task_failed",
        actorId: args.devId,
        data: JSON.stringify({ taskId: args.taskId }),
      });
      return;
    }
    if (args.requiresApproval) {
      await ctx.db.patch(args.taskId, { status: "awaiting_approval" });
      await ctx.db.insert("messages", {
        from: args.devId,
        to: args.ceoId,
        type: "approval_request",
        payload: JSON.stringify({ taskId: args.taskId, result: args.result }),
      });
      await ctx.db.patch(args.devId, {
        status: "idle",
        speech: "ส่งงานแล้ว รอหัวหน้าอนุมัติก่อน deploy ครับ",
      });
      await ctx.db.insert("events", {
        type: "awaiting_approval",
        actorId: args.devId,
        data: JSON.stringify({ taskId: args.taskId }),
      });
      return;
    }
    await ctx.db.patch(args.taskId, { status: "done", approved: true });
    await ctx.db.insert("messages", {
      from: args.devId,
      to: args.ceoId,
      type: "status_update",
      payload: JSON.stringify({ taskId: args.taskId, result: args.result }),
    });
    await ctx.db.patch(args.devId, { status: "idle", speech: args.speech });
    await ctx.db.insert("events", {
      type: "task_done",
      actorId: args.devId,
      data: JSON.stringify({ taskId: args.taskId }),
    });
  },
});

// ── human-in-the-loop approval gate ──

export const pendingApprovals = query({
  args: {},
  handler: async (ctx) => {
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_status", (q) => q.eq("status", "awaiting_approval"))
      .collect();
    return tasks.map((t) => ({ id: t._id, title: t.title, description: t.description }));
  },
});

export const approveTask = mutation({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task || task.status !== "awaiting_approval") return;
    await ctx.db.patch(args.taskId, { status: "done", approved: true });
    if (task.assignedTo) {
      await ctx.db.patch(task.assignedTo, {
        status: "idle",
        speech: "ขอบคุณครับ deploy ขึ้นแล้ว!",
      });
    }
    await ctx.db.insert("events", {
      type: "task_approved",
      actorId: task.createdBy,
      data: JSON.stringify({ taskId: args.taskId, title: task.title }),
    });
  },
});

export const rejectTask = mutation({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task || task.status !== "awaiting_approval") return;
    await ctx.db.patch(args.taskId, { status: "failed", approved: false });
    if (task.assignedTo) {
      await ctx.db.patch(task.assignedTo, {
        status: "idle",
        speech: "รับทราบครับ เดี๋ยวผมแก้ใหม่",
      });
    }
    await ctx.db.insert("events", {
      type: "task_rejected",
      actorId: task.createdBy,
      data: JSON.stringify({ taskId: args.taskId, title: task.title }),
    });
  },
});

// ---------- the orchestrator ----------

// Advance the simulation by exactly one beat. Safe to call manually or on a loop.
export const step = action({
  args: {},
  handler: async (ctx): Promise<{ actor: string; did: string; detail: string }> => {
    const s = await ctx.runQuery(internal.orchestrator.getState, {});
    if (!s.ceo || !s.dev) {
      return { actor: "system", did: "idle", detail: "กรุณาสร้างพนักงานก่อน" };
    }

    // No open task → CEO delegates a new one.
    if (!s.openTask) {
      await ctx.runMutation(internal.orchestrator.setSpeech, {
        id: s.ceo.id,
        status: "thinking",
        speech: "กำลังวางแผนงานถัดไป…",
      });
      const plan = await ctx.runAction(internal.ai.ceoCreateTask, {
        ceoName: s.ceo.name,
        ceoPersona: s.ceo.persona,
        recentTitles: s.recentTitles,
      });
      await ctx.runMutation(internal.orchestrator.assignTask, {
        ceoId: s.ceo.id,
        devId: s.dev.id,
        title: plan.title,
        description: plan.description,
        ceoSpeech: plan.speech,
        requiresApproval: plan.requiresApproval,
      });
      return { actor: s.ceo.name, did: "assigned", detail: plan.title };
    }

    // Task just assigned → developer starts working.
    if (s.openTask.status === "backlog") {
      await ctx.runMutation(internal.orchestrator.startWork, {
        devId: s.dev.id,
        taskId: s.openTask.id,
      });
      return { actor: s.dev.name, did: "started", detail: s.openTask.title };
    }

    // Task in progress → developer finishes it. If the sandbox bridge is
    // configured, Devon actually writes & runs code; otherwise he describes it.
    const sandbox = await ctx.runAction(internal.sandbox.runForTask, {
      taskTitle: s.openTask.title,
      taskDescription: s.openTask.description,
    });

    let result: string;
    let speech: string;
    let ranOk = true;
    if (sandbox.executed) {
      ranOk = !!sandbox.ok;
      await ctx.runMutation(internal.sandbox.storeRun, {
        taskId: s.openTask.id,
        agentId: s.dev.id,
        title: s.openTask.title,
        code: sandbox.code ?? "",
        stdout: sandbox.stdout ?? "",
        stderr: sandbox.stderr ?? "",
        exitCode: sandbox.exitCode ?? -1,
        ok: ranOk,
      });
      result = ranOk
        ? `รันผ่าน (exit 0)\n${(sandbox.stdout ?? "").trim()}`.slice(0, 500)
        : `รันไม่ผ่าน (exit ${sandbox.exitCode})\n${(sandbox.stderr ?? "").trim()}`.slice(0, 500);
      speech = ranOk ? "โค้ดรันผ่านทั้งหมดในแซนด์บ็อกซ์ครับ" : "ยังรันไม่ผ่าน เดี๋ยวผมแก้ครับ";
    } else {
      const work = await ctx.runAction(internal.ai.devDoTask, {
        devName: s.dev.name,
        devPersona: s.dev.persona,
        taskTitle: s.openTask.title,
        taskDescription: s.openTask.description,
      });
      result = work.result;
      speech = work.speech;
    }

    await ctx.runMutation(internal.orchestrator.completeWork, {
      devId: s.dev.id,
      ceoId: s.ceo.id,
      taskId: s.openTask.id,
      result,
      speech,
      requiresApproval: s.openTask.requiresApproval,
      ranOk,
    });
    return {
      actor: s.dev.name,
      did: !ranOk ? "failed" : s.openTask.requiresApproval ? "awaiting_approval" : "completed",
      detail: s.openTask.title,
    };
  },
});

// Human directive → CEO turns it into a task and assigns it to the developer.
export const directCeo = action({
  args: { directive: v.string() },
  handler: async (ctx, args): Promise<{ ok: boolean; title: string }> => {
    const directive = args.directive.trim();
    if (!directive) return { ok: false, title: "" };
    const s = await ctx.runQuery(internal.orchestrator.getState, {});
    if (!s.ceo || !s.dev) return { ok: false, title: "" };

    await ctx.runMutation(internal.orchestrator.setSpeech, {
      id: s.ceo.id,
      status: "thinking",
      speech: "รับคำสั่งจากเจ้านาย กำลังจัดงาน…",
    });
    const plan = await ctx.runAction(internal.ai.ceoPlanDirective, {
      ceoName: s.ceo.name,
      ceoPersona: s.ceo.persona,
      directive,
    });
    await ctx.runMutation(internal.orchestrator.assignTask, {
      ceoId: s.ceo.id,
      devId: s.dev.id,
      title: plan.title,
      description: plan.description,
      ceoSpeech: plan.speech,
      requiresApproval: plan.requiresApproval,
    });
    return { ok: true, title: plan.title };
  },
});

// ---------- game loop control ----------

export const ensureSim = internalMutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db.query("sim").first();
    if (!existing) await ctx.db.insert("sim", { running: false, tick: 0 });
  },
});

export const getSim = internalQuery({
  args: {},
  handler: async (ctx) => await ctx.db.query("sim").first(),
});

export const setRunning = internalMutation({
  args: { running: v.boolean() },
  handler: async (ctx, args) => {
    const sim = await ctx.db.query("sim").first();
    if (sim) await ctx.db.patch(sim._id, { running: args.running });
    else await ctx.db.insert("sim", { running: args.running, tick: 0 });
  },
});

export const bumpTick = internalMutation({
  args: {},
  handler: async (ctx) => {
    const sim = await ctx.db.query("sim").first();
    // Advancing a tick means the beat succeeded — clear any stale error.
    if (sim) await ctx.db.patch(sim._id, { tick: sim.tick + 1, lastError: undefined });
  },
});

export const logError = internalMutation({
  args: { message: v.string() },
  handler: async (ctx, args) => {
    const sim = await ctx.db.query("sim").first();
    const short = args.message.slice(0, 200);
    if (sim) await ctx.db.patch(sim._id, { lastError: short });
    await ctx.db.insert("events", {
      type: "loop_error",
      data: JSON.stringify({ message: short }),
    });
  },
});

export const start = mutation({
  args: {},
  handler: async (ctx) => {
    await ctx.runMutation(internal.orchestrator.ensureSim, {});
    await ctx.runMutation(internal.orchestrator.setRunning, { running: true });
    await ctx.scheduler.runAfter(0, internal.orchestrator.loop, {});
  },
});

export const stop = mutation({
  args: {},
  handler: async (ctx) => {
    await ctx.runMutation(internal.orchestrator.setRunning, { running: false });
  },
});

// Self-rescheduling driver: run one beat, then queue the next while running.
// A failing beat (e.g. an LLM rate-limit) is logged but does NOT kill the loop —
// the state machine is retry-safe, so the next tick simply tries again.
export const loop = internalAction({
  args: {},
  handler: async (ctx) => {
    const sim = await ctx.runQuery(internal.orchestrator.getSim, {});
    if (!sim || !sim.running) return;
    try {
      await ctx.runAction(api.orchestrator.step, {});
      await ctx.runMutation(internal.orchestrator.bumpTick, {});
    } catch (err) {
      await ctx.runMutation(internal.orchestrator.logError, {
        message: err instanceof Error ? err.message : String(err),
      });
    }
    // Tariq trades gold on his own, in a separate try so a price-feed or LLM
    // hiccup never stalls the main loop.
    try {
      await ctx.runAction(api.tariq.tradeStep, {});
    } catch (err) {
      await ctx.runMutation(internal.orchestrator.logError, {
        message: "Tariq: " + (err instanceof Error ? err.message : String(err)),
      });
    }
    // One hired Staff member does a beat of department work (no-op if none).
    try {
      await ctx.runAction(api.staff.doWork, {});
    } catch (err) {
      await ctx.runMutation(internal.orchestrator.logError, {
        message: "Staff: " + (err instanceof Error ? err.message : String(err)),
      });
    }
    await ctx.scheduler.runAfter(LOOP_MS, internal.orchestrator.loop, {});
  },
});

// ---------- public reads for the UI ----------

export const listTasks = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("tasks").order("desc").take(20);
  },
});

export const recentMessages = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("messages").order("desc").take(15);
  },
});

export const simState = query({
  args: {},
  handler: async (ctx) => {
    const sim = await ctx.db.query("sim").first();
    return {
      running: sim?.running ?? false,
      tick: sim?.tick ?? 0,
      lastError: sim?.lastError,
    };
  },
});
