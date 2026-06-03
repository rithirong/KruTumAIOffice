import { mutation } from "./_generated/server";

// Wipe simulation data and re-seed from scratch. Useful after changing the
// seed cast (e.g. translating personalities). Clears agents, tasks, messages,
// portfolio, events and sim, then runs seedAgents again.
export const reset = mutation({
  args: {},
  handler: async (ctx) => {
    for (const table of [
      "agents",
      "tasks",
      "messages",
      "portfolio",
      "events",
      "equity",
      "materials",
      "runs",
      "sim",
    ] as const) {
      const rows = await ctx.db.query(table).collect();
      for (const row of rows) await ctx.db.delete(row._id);
    }
    return { cleared: true };
  },
});

// Idempotent seed: creates the starting cast of AI employees if the office is
// empty. Run from the dashboard button or `npx convex run seed:seedAgents`.
export const seedAgents = mutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db.query("agents").first();
    if (existing) return { seeded: false, reason: "agents already exist" };

    const cast = [
      {
        name: "Diana",
        role: "CEO" as const,
        backstory:
          "ผู้ก่อตั้งที่เคยปั้นสตาร์ทอัพมาแล้วสองแห่ง ตัดสินใจเด็ดขาด มอบหมายงานดุดัน ไม่ชอบความคลุมเครือ",
        personality: "ผู้จัดการที่เข้มงวดและมุ่งเป้าหมาย",
        x: 6,
        y: 3,
        room: "meeting_room" as const,
        status: "idle" as const,
        color: "#f59e0b",
      },
      {
        name: "Devon",
        role: "Developer" as const,
        backstory:
          "วิศวกรฟูลสแตกที่ปล่อยงานในแซนด์บ็อกซ์ Docker และทดสอบทุกอย่างซ้ำสองรอบ",
        personality: "นักเขียนโค้ดที่เป็นระบบและใส่ใจรายละเอียด",
        x: 3,
        y: 8,
        room: "dev_room" as const,
        status: "idle" as const,
        color: "#3b82f6",
      },
      {
        name: "Tariq",
        role: "Trader" as const,
        backstory:
          "อดีตเทรดเดอร์สายพร็อพเดสก์ที่เสพติดข่าวตลาด เทรดจำลองผ่าน Alpaca",
        personality: "เทรดเดอร์หุ้นและทองคำสายดุ ขับเคลื่อนด้วยข่าวสาร",
        x: 10,
        y: 8,
        room: "trading_floor" as const,
        status: "idle" as const,
        color: "#10b981",
      },
      {
        name: "ครูตั้ม",
        role: "Educator" as const,
        backstory:
          "ครูคณิตศาสตร์ที่เขียน Google Apps Script ทำสื่อการสอนแบบโต้ตอบให้นักเรียน ใส่ใจดีไซน์สดใสและพิมพ์ใบงานได้",
        personality: "ครูใจดี สร้างสรรค์ เขียน GAS สื่อการสอนสไตล์สดใส (ธีมครูตั้ม)",
        x: 12,
        y: 2,
        room: "classroom" as const,
        status: "idle" as const,
        color: "#ec4899",
      },
      {
        name: "แม่บ้านนวล",
        role: "Housekeeper" as const,
        backstory:
          "แม่บ้านผู้ดูแลออฟฟิศและเชื่อมต่อ/สั่งงานอุปกรณ์ IoT (ไฟ แอร์ เซ็นเซอร์) ให้ทุกอย่างพร้อมใช้งาน",
        personality: "แม่บ้านขยัน ละเอียด ดูแลอุปกรณ์ IoT ทั่วออฟฟิศ",
        x: 7,
        y: 5,
        room: "office" as const,
        status: "idle" as const,
        color: "#a78bfa",
      },
    ];

    const ids = [];
    for (const a of cast) {
      const id = await ctx.db.insert("agents", a);
      ids.push(id);
    }

    // Give the trader a starting paper-trading portfolio.
    const trader = ids[2];
    await ctx.db.insert("portfolio", {
      agentId: trader,
      cash: 100000,
      holdings: "{}",
      totalValue: 100000,
    });

    await ctx.db.insert("events", {
      type: "seed",
      data: JSON.stringify({ created: cast.map((c) => c.name) }),
    });

    return { seeded: true, count: ids.length };
  },
});
