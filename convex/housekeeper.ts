// แม่บ้านนวล the housekeeper: tends the office IoT devices. For now this is an
// in-sim role-play (no real devices). When the user picks an IoT platform
// (Home Assistant / MQTT / Tuya), wire a real bridge the same way the MT5 bridge
// works: replace the simulated action in `tendDevices` with a call out to the
// bridge, gated/safe as appropriate. See the `MT5_BRIDGE_URL` pattern in tariq.ts.

import { action, internalQuery, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";

// Simulated IoT chores around the office (Thai).
const CHORES = [
  "เปิดไฟห้องประชุมให้พร้อมก่อนมีตติ้ง",
  "ปรับแอร์ห้องเทรดเป็น 24°C",
  "ตรวจเซ็นเซอร์ประตูทางเข้า",
  "ปิดไฟห้องเรียนหลังเลิกใช้งาน",
  "เช็คกล้องวงจรปิดรอบออฟฟิศ",
  "เปิดเครื่องฟอกอากาศในห้องพัฒนา",
  "รดน้ำต้นไม้อัตโนมัติที่ระเบียง",
];

const OFFICE_SPOTS: [number, number][] = [
  [6, 4],
  [7, 5],
  [8, 4],
  [9, 5],
];

export const getHousekeeper = internalQuery({
  args: {},
  handler: async (ctx) => {
    const agents = await ctx.db.query("agents").collect();
    const hk = agents.find((a) => a.role === "Housekeeper") ?? null;
    return hk && { id: hk._id, name: hk.name, persona: hk.personality };
  },
});

export const setHousekeeper = internalMutation({
  args: {
    id: v.id("agents"),
    status: v.union(v.literal("idle"), v.literal("working")),
    speech: v.string(),
    chore: v.string(),
  },
  handler: async (ctx, args) => {
    const spot = OFFICE_SPOTS[Math.floor(Math.random() * OFFICE_SPOTS.length)];
    await ctx.db.patch(args.id, {
      status: args.status,
      speech: args.speech,
      x: spot[0],
      y: spot[1],
      room: "office",
    });
    await ctx.db.insert("events", {
      type: "iot_chore",
      actorId: args.id,
      data: JSON.stringify({ chore: args.chore, simulated: true }),
    });
  },
});

export const logControl = internalMutation({
  args: { type: v.string(), data: v.string() },
  handler: async (ctx, args) => {
    const agents = await ctx.db.query("agents").collect();
    const hk = agents.find((a) => a.role === "Housekeeper");
    await ctx.db.insert("events", { type: args.type, actorId: hk?._id, data: args.data });
  },
});

// Health of the IoT bridge (Tuya/SmartLife + Xiaomi). Never throws. Includes the
// configured device list so the UI can render toggles.
export const bridgeStatus = action({
  args: {},
  handler: async (): Promise<Record<string, unknown>> => {
    const url = process.env.IOT_BRIDGE_URL;
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

// Turn a real device on/off via the bridge (human-triggered from the UI).
export const controlDevice = action({
  args: { name: v.string(), on: v.boolean() },
  handler: async (ctx, args): Promise<{ ok: boolean; message: string }> => {
    const url = process.env.IOT_BRIDGE_URL;
    const token = process.env.IOT_BRIDGE_TOKEN ?? "";
    if (!url) {
      return { ok: false, message: "ยังไม่ได้ตั้งค่า IoT bridge (ดู iot-bridge/README.md)" };
    }
    try {
      const res = await fetch(`${url.replace(/\/$/, "")}/control`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Bridge-Token": token },
        body: JSON.stringify({ name: args.name, on: args.on }),
      });
      const body = await res.json().catch(() => ({}));
      await ctx.runMutation(internal.housekeeper.logControl, {
        type: res.ok ? "iot_control" : "iot_control_failed",
        data: JSON.stringify({ ...args, status: res.status, body }),
      });
      if (!res.ok) return { ok: false, message: `สั่งอุปกรณ์ไม่สำเร็จ: ${body?.detail ?? res.status}` };
      return { ok: true, message: `${args.name} → ${args.on ? "เปิด" : "ปิด"} แล้ว` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, message: `เชื่อม IoT bridge ไม่ได้: ${msg}` };
    }
  },
});

// Do one IoT chore (simulated) and narrate it in character. Human-triggered.
export const tendDevices = action({
  args: {},
  handler: async (ctx): Promise<{ ok: boolean; chore: string }> => {
    const hk = await ctx.runQuery(internal.housekeeper.getHousekeeper, {});
    if (!hk) return { ok: false, chore: "" };

    const chore = CHORES[Math.floor(Math.random() * CHORES.length)];
    // TODO(real IoT): when a platform is chosen, call the IoT bridge here instead
    // of just simulating, e.g. POST to HOME_ASSISTANT/MQTT/Tuya for `chore`.
    const { speech } = await ctx.runAction(internal.ai.housekeeperNarrate, {
      name: hk.name,
      persona: hk.persona,
      summary: `กำลังทำงานดูแลอุปกรณ์ IoT: ${chore} (โหมดจำลอง ยังไม่ต่ออุปกรณ์จริง)`,
    });

    await ctx.runMutation(internal.housekeeper.setHousekeeper, {
      id: hk.id,
      status: "working",
      speech,
      chore,
    });
    return { ok: true, chore };
  },
});
