"use node";

// LLM layer. Runs in Convex's Node action runtime so the Vercel AI SDK works.
// Provider is chosen by whichever API key is set (no code change to switch).
// Auto-detect priority: DeepSeek -> Gemini -> Claude -> mock. Set LLM_PROVIDER
// ("deepseek" | "gemini" | "claude") to force one when several keys exist.
//   DEEPSEEK_API_KEY             -> DeepSeek (cheapest)
//   GOOGLE_GENERATIVE_AI_API_KEY -> Gemini (has a free tier)
//   ANTHROPIC_API_KEY            -> Claude
//   none                         -> deterministic mock (runs free, offline)
// Set via `npx convex env set ...`.

import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { deepseek } from "@ai-sdk/deepseek";
import { generateObject, generateText, type LanguageModel } from "ai";
import { z } from "zod";

// Returns a configured model, or null to fall back to the mock. `prefer` forces a
// specific provider for this call (if its key exists) — used by the educator to
// always write worksheets with Claude, which handles the teaching context best.
function pickModel(prefer?: "deepseek" | "gemini" | "claude"): LanguageModel | null {
  if (prefer === "claude" && process.env.ANTHROPIC_API_KEY) {
    return anthropic(process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6");
  }
  if (prefer === "gemini" && process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return google(process.env.GEMINI_MODEL ?? "gemini-2.5-flash");
  }
  if (prefer === "deepseek" && process.env.DEEPSEEK_API_KEY) {
    return deepseek(process.env.DEEPSEEK_MODEL ?? "deepseek-chat");
  }

  const force = process.env.LLM_PROVIDER; // optional global override
  const want = (p: string) => !force || force === p;
  if (want("deepseek") && process.env.DEEPSEEK_API_KEY) {
    return deepseek(process.env.DEEPSEEK_MODEL ?? "deepseek-chat");
  }
  if (want("gemini") && process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return google(process.env.GEMINI_MODEL ?? "gemini-2.5-flash");
  }
  if (want("claude") && process.env.ANTHROPIC_API_KEY) {
    return anthropic(process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6");
  }
  return null;
}

// Pool of mock tasks for offline mode (Thai).
const MOCK_TASKS = [
  { title: "สร้างหน้าเข้าสู่ระบบ", description: "ฟอร์มอีเมล + รหัสผ่าน พร้อมตรวจสอบความถูกต้องและ mutation สำหรับยืนยันตัวตนบน Convex" },
  { title: "เพิ่มกราฟพอร์ตการลงทุน", description: "กราฟเส้นแสดงมูลค่าพอร์ตรวมตามช่วงเวลาบนหน้าแดชบอร์ด" },
  { title: "แก้ป้ายสถานะของเอเจนต์", description: "จุดสถานะควรเปลี่ยนเป็นสีเหลืองอำพันขณะที่เอเจนต์กำลังคิด" },
  { title: "เขียน endpoint /health", description: "ตอบกลับ 200 พร้อม build SHA และ uptime สำหรับการมอนิเตอร์" },
  { title: "เพิ่มปุ่มสลับโหมดมืด", description: "บันทึกการเลือกธีมของผู้ใช้ไว้ใน localStorage" },
];

// CEO invents a task to delegate to the Developer.
export const ceoCreateTask = internalAction({
  args: { ceoName: v.string(), ceoPersona: v.string(), recentTitles: v.array(v.string()) },
  returns: v.object({
    title: v.string(),
    description: v.string(),
    speech: v.string(),
    requiresApproval: v.boolean(),
  }),
  handler: async (_ctx, args) => {
    // Risky if it touches auth, money, data deletion, or production deploys.
    const risky = (s: string) => /เข้าสู่ระบบ|ล็อกอิน|พอร์ต|การเงิน|ลบ|deploy|production|ชำระเงิน/i.test(s);
    const model = pickModel();
    if (!model) {
      const pick =
        MOCK_TASKS.find((t) => !args.recentTitles.includes(t.title)) ?? MOCK_TASKS[0];
      return {
        title: pick.title,
        description: pick.description,
        speech: `${pick.title} — ทำให้เสร็จนะ`,
        requiresApproval: risky(pick.title + pick.description),
      };
    }

    const { object } = await generateObject({
      model,
      schema: z.object({
        title: z.string().describe("ชื่องานสั้น ๆ เป็นประโยคคำสั่ง (ภาษาไทย)"),
        description: z.string().describe("สเปกงานสำหรับนักพัฒนา 1-2 ประโยค (ภาษาไทย)"),
        speech: z.string().describe("ประโยคสั้น ๆ ที่ซีอีโอพูดออกมาตามคาแรกเตอร์ (ภาษาไทย)"),
        requiresApproval: z
          .boolean()
          .describe("true ถ้างานนี้เสี่ยง (แตะระบบ auth, การเงิน, ลบข้อมูล, หรือ deploy ขึ้น production) จึงต้องให้มนุษย์อนุมัติก่อน"),
      }),
      prompt:
        `คุณคือ ${args.ceoName} ซีอีโอ (${args.ceoPersona}) ของบริษัทซอฟต์แวร์เล็ก ๆ ` +
        `จงมอบหมายงานพัฒนาเว็บที่เป็นรูปธรรมและขนาดเล็ก 1 งานให้นักพัฒนาของคุณ ` +
        `หลีกเลี่ยงการซ้ำกับงานล่าสุดเหล่านี้: ${args.recentTitles.join("; ") || "ไม่มี"} ` +
        `ระบุ requiresApproval=true ถ้างานเสี่ยง (auth/การเงิน/ลบข้อมูล/deploy) ` +
        `ตอบเป็นภาษาไทยทั้งหมด`,
    });
    return object;
  },
});

// A hired Staff member produces one small department-appropriate deliverable.
const DIVISION_TH: Record<string, string> = {
  engineering: "เขียนโค้ด/ปรับปรุงระบบ",
  design: "ออกแบบ UI/กราฟิก",
  marketing: "ทำคอนเทนต์/แคมเปญการตลาด",
  "paid-media": "ยิงโฆษณา/วางงบสื่อ",
  sales: "ปิดการขาย/ดูแลลูกค้า",
  product: "วางสเปก/โรดแมปผลิตภัณฑ์",
  "project-management": "วางแผน/ติดตามงาน",
  finance: "วิเคราะห์การเงิน/งบประมาณ",
  testing: "ทดสอบ/หาบั๊ก",
  support: "ดูแล/ตอบลูกค้า",
  academic: "วิจัย/วิเคราะห์เชิงวิชาการ",
  "game-development": "พัฒนาเกม",
  "spatial-computing": "งาน AR/VR/3D",
  strategy: "วางกลยุทธ์",
  specialized: "งานเฉพาะทาง",
};

export const staffWork = internalAction({
  args: { name: v.string(), division: v.string(), persona: v.string() },
  returns: v.object({ output: v.string(), speech: v.string() }),
  handler: async (_ctx, args) => {
    const domain = DIVISION_TH[args.division] ?? args.division;
    const model = pickModel();
    if (!model) {
      return {
        output: `ส่งงานสาย ${domain} หนึ่งชิ้น (จำลอง)`,
        speech: `ทำงาน ${domain} อยู่ครับ/ค่ะ`,
      };
    }
    const { object } = await generateObject({
      model,
      schema: z.object({
        output: z.string().describe("ชิ้นงาน/อัปเดตที่เป็นรูปธรรม 1 บรรทัดในสายงานนี้ (ภาษาไทย)"),
        speech: z.string().describe("ประโยคสั้น ๆ ที่พนักงานพูดตามคาแรกเตอร์ (ภาษาไทย)"),
      }),
      prompt:
        `คุณคือ ${args.name} ผู้เชี่ยวชาญสาย ${args.division} (${args.persona}) ` +
        `จงส่งมอบชิ้นงานเล็ก ๆ ที่เป็นรูปธรรม 1 ชิ้นในสายงานของคุณ (${domain}) ให้บริษัทวันนี้ ` +
        `ตอบเป็นภาษาไทย สั้น กระชับ`,
    });
    return object;
  },
});

// CEO turns a human directive into a concrete dev task (in character).
export const ceoPlanDirective = internalAction({
  args: { ceoName: v.string(), ceoPersona: v.string(), directive: v.string() },
  returns: v.object({
    title: v.string(),
    description: v.string(),
    speech: v.string(),
    requiresApproval: v.boolean(),
  }),
  handler: async (_ctx, args) => {
    const risky = (s: string) => /เข้าสู่ระบบ|ล็อกอิน|พอร์ต|การเงิน|ลบ|deploy|production|ชำระเงิน/i.test(s);
    const model = pickModel();
    if (!model) {
      return {
        title: args.directive.slice(0, 60),
        description: args.directive,
        speech: `${args.directive} — จัดให้เลย`,
        requiresApproval: risky(args.directive),
      };
    }
    const { object } = await generateObject({
      model,
      schema: z.object({
        title: z.string().describe("ชื่องานสั้น ๆ เป็นประโยคคำสั่ง (ภาษาไทย)"),
        description: z.string().describe("สเปกงานสำหรับนักพัฒนา 1-2 ประโยค (ภาษาไทย)"),
        speech: z.string().describe("ประโยคสั้น ๆ ที่ซีอีโอพูดเมื่อรับคำสั่งจากเจ้านาย (ภาษาไทย)"),
        requiresApproval: z.boolean().describe("true ถ้างานเสี่ยง (auth/การเงิน/ลบข้อมูล/deploy)"),
      }),
      prompt:
        `คุณคือ ${args.ceoName} ซีอีโอ (${args.ceoPersona}) ` +
        `เจ้านาย (ผู้ใช้) สั่งงานนี้: "${args.directive}" ` +
        `จงแปลงเป็นงานพัฒนาเว็บที่เป็นรูปธรรม 1 งานเพื่อมอบให้นักพัฒนา ` +
        `ตอบเป็นภาษาไทยทั้งหมด`,
    });
    return object;
  },
});

// Developer writes a self-contained Python script (with tests) that the sandbox
// will actually run. No external libraries, no network.
export const devWriteCode = internalAction({
  args: { taskTitle: v.string(), taskDescription: v.string() },
  returns: v.object({ code: v.string() }),
  handler: async (_ctx, args) => {
    const model = pickModel();
    if (!model) {
      return {
        code:
          `# mock solution for: ${args.taskTitle}\n` +
          `def solve():\n    return True\n` +
          `assert solve() is True\n` +
          `print("PASS (mock) ${args.taskTitle}")\n`,
      };
    }
    const { text } = await generateText({
      model,
      prompt:
        `คุณคือ Devon นักพัฒนา จงเขียนสคริปต์ Python ไฟล์เดียวที่รันได้ทันที ` +
        `(ไม่ใช้ไลบรารีภายนอก ไม่ต่อเน็ต) เพื่อ "พิสูจน์" งานนี้: ` +
        `"${args.taskTitle}" — ${args.taskDescription}\n` +
        `ทำฟังก์ชันหลักแบบย่อ + เขียน assert ทดสอบอย่างน้อย 2 เคส + print บรรทัด "PASS ..." เมื่อผ่าน ` +
        `ถ้าตรรกะผิดให้ assert ล้มเพื่อให้ exit code ไม่ใช่ 0\n` +
        `ตอบกลับเป็นโค้ด Python ล้วน ๆ เท่านั้น ห้ามมีคำอธิบายหรือ markdown fence`,
    });
    const code = text.replace(/^\s*```(?:python)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
    return { code };
  },
});

// Trader narrates what he sees in the gold market and what he is doing.
export const traderNarrate = internalAction({
  args: {
    name: v.string(),
    persona: v.string(),
    summary: v.string(), // factual signal/action summary fed to the model
  },
  returns: v.object({ speech: v.string() }),
  handler: async (_ctx, args) => {
    const model = pickModel();
    if (!model) {
      return { speech: args.summary.slice(0, 90) };
    }
    const { object } = await generateObject({
      model,
      schema: z.object({
        speech: z.string().describe("ประโยคสั้น ๆ ที่เทรดเดอร์พูดออกมาตามคาแรกเตอร์ (ภาษาไทย ไม่เกิน 1-2 ประโยค)"),
      }),
      prompt:
        `คุณคือ ${args.name} เทรดเดอร์ทองคำ (${args.persona}) ` +
        `นี่คือสถานการณ์ตลาดและการกระทำของคุณตอนนี้: ${args.summary} ` +
        `พูดออกมาสั้น ๆ ตามคาแรกเตอร์ เป็นภาษาไทย`,
    });
    return object;
  },
});

// Educator (ครูตั้ม) writes a Google Apps Script teaching material as a single
// Index.html, in the user's established "ครูตั้ม" house style. Returns the HTML.
const GAS_STYLE = [
  "สไตล์ (ธีมครูตั้ม):",
  "- ฟอนต์ Google: Mali (UI), Sarabun (คำอธิบาย), Comfortaa (ตัวเลขกระดาน) — @import จาก fonts.googleapis.com",
  "- สี: พื้นหลัง #f8fafc; container ขาว border #f9a8d4; ชื่อเรื่อง #be185d มี text-shadow ชมพู;",
  "  กล่องคำชี้แจง bg #fff7ed border-left #f97316 text #9a3412; กล่องข้อ bg #f0fdf4 border #86efac",
  "- ปุ่ม: สุ่ม #fbbf24, ใบงาน 5 ข้อ #c084fc, ใบงาน 10 ข้อ #34d399, พิมพ์ #38bdf8 (มุมโค้ง 12px)",
  "",
  "ต้องมี 2 ส่วน ใช้ดีไซน์/ฟอนต์/สีเป็นมาตรฐานเดียวกัน:",
  "  (1) สื่อโต้ตอบ — สาธิตแนวคิดบนจอ สุ่มโจทย์ใหม่ได้ มีปุ่มเฉลย/ตรวจ",
  "  (2) ใบงาน (worksheet) — ปุ่ม 'สร้างใบงาน 5 ข้อ' และ 'สร้างใบงาน 10 ข้อ' สุ่มโจทย์ลงในกระดาษ",
  "      มีหัวกระดาษ: ชื่อ-สกุล____ เลขที่___ วันที่___ ช่องคะแนน และเว้นที่ให้เด็กเขียนคำตอบ",
  "",
  "ใบงานต้องพิมพ์บน A4 แนวตั้งเป๊ะ:",
  "- @media print { @page { size: A4 portrait; margin: 0.8cm } * { print-color-adjust: exact !important } }",
  "- ตอนพิมพ์ ซ่อนทุกอย่าง (h1, ส่วนสื่อโต้ตอบ, ปุ่ม) เหลือเฉพาะ .worksheet; .worksheet { width:100%; }",
  "- จัดให้พอดี 1 หน้า A4 ต่อใบงาน 1 ชุด อย่าให้ล้นหน้า ใช้ฟอนต์/ระยะที่อ่านง่ายสำหรับเด็กประถม",
  "- ปุ่มพิมพ์เรียก window.print()",
  "",
  "- ก่อนปิด </body> ใส่สคริปต์กันลิงก์: ถ้า window.top === window.self ให้แทน body ด้วยข้อความ",
  '  "⛔ ไม่อนุญาตให้เข้าถึงลิงก์นี้โดยตรง" พร้อมลิงก์กลับ https://rithirong.in.th',
  "- ทุกข้อความเป็นภาษาไทย เหมาะกับนักเรียนประถม",
].join("\n");

export const gasCreateMaterial = internalAction({
  args: { topic: v.string() },
  returns: v.object({ html: v.string() }),
  handler: async (_ctx, args) => {
    const prompt =
      `คุณคือ "ครูตั้ม" ครูคณิตศาสตร์ที่เขียน Google Apps Script ทำสื่อการสอนแบบโต้ตอบ ` +
      `จงสร้างไฟล์ Index.html ฉบับสมบูรณ์ (HTML + <style> + <script> ในไฟล์เดียว ไม่มีการเรียกเซิร์ฟเวอร์) ` +
      `ที่มีทั้ง "สื่อการสอนโต้ตอบ" และ "ใบงานพิมพ์ A4 แนวตั้ง" สำหรับคณิตศาสตร์ประถม เรื่อง: "${args.topic}"\n\n${GAS_STYLE}\n\n` +
      `ตอบกลับเป็นโค้ด HTML ล้วน ๆ เท่านั้น เริ่มด้วย <!DOCTYPE html> ห้ามมีคำอธิบายหรือ markdown code fence`;

    const clean = (text: string) =>
      text.replace(/^\s*```(?:html)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();

    // Prefer Claude (best at the teaching context); fall back to the auto provider
    // (DeepSeek) if Claude is unavailable, e.g. out of API credit.
    const claudeModel = process.env.ANTHROPIC_API_KEY ? pickModel("claude") : null;
    const autoModel = pickModel();
    for (const model of [claudeModel, autoModel]) {
      if (!model) continue;
      try {
        const { text } = await generateText({ model, prompt });
        return { html: clean(text) };
      } catch {
        // try the next candidate
      }
    }

    // No model worked → minimal in-style mock so the flow still produces something.
    const html = `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${args.topic}</title>
<style>@import url('https://fonts.googleapis.com/css2?family=Mali:wght@400;700&family=Sarabun&display=swap');
body{font-family:'Mali',cursive;background:#f8fafc;color:#0f172a;padding:30px;display:flex;flex-direction:column;align-items:center}
h1{color:#be185d;text-shadow:2px 2px 0 #f9a8d4}
.container{background:#fff;border:3px solid #f9a8d4;border-radius:20px;padding:25px;max-width:900px;width:100%}
button{font-family:'Mali';border:none;border-radius:12px;padding:10px 18px;color:#fff;cursor:pointer;font-weight:bold}
.rand{background:#fbbf24}</style></head>
<body><h1>${args.topic}</h1>
<div class="container"><p>ตัวอย่างสื่อ (โหมดออฟไลน์) — เรื่อง ${args.topic}</p>
<button class="rand" onclick="document.getElementById('q').textContent=Math.floor(Math.random()*900+100)">สุ่มโจทย์</button>
<h2 id="q">123</h2></div>
<script>window.onload=function(){if(window.top===window.self){document.body.innerHTML='<div style="text-align:center;padding:50px;font-family:Sarabun"><h2 style="color:#dc2626">⛔ ไม่อนุญาตให้เข้าถึงลิงก์นี้โดยตรง</h2><a href="https://rithirong.in.th">กลับไปเว็บไซต์หลัก</a></div>'}};</script>
</body></html>`;
    return { html };
  },
});

// Housekeeper (แม่บ้านนวล) narrates an IoT action in character.
export const housekeeperNarrate = internalAction({
  args: { name: v.string(), persona: v.string(), summary: v.string() },
  returns: v.object({ speech: v.string() }),
  handler: async (_ctx, args) => {
    const model = pickModel();
    if (!model) return { speech: args.summary.slice(0, 90) };
    const { object } = await generateObject({
      model,
      schema: z.object({
        speech: z.string().describe("ประโยคสั้น ๆ ที่แม่บ้านพูดตามคาแรกเตอร์ (ภาษาไทย)"),
      }),
      prompt:
        `คุณคือ ${args.name} แม่บ้านที่ดูแลอุปกรณ์ IoT (${args.persona}) ` +
        `สถานการณ์ตอนนี้: ${args.summary} พูดสั้น ๆ ตามคาแรกเตอร์ เป็นภาษาไทย`,
    });
    return object;
  },
});

// Developer executes an assigned task and reports a result.
export const devDoTask = internalAction({
  args: {
    devName: v.string(),
    devPersona: v.string(),
    taskTitle: v.string(),
    taskDescription: v.string(),
  },
  returns: v.object({ result: v.string(), speech: v.string() }),
  handler: async (_ctx, args) => {
    const model = pickModel();
    if (!model) {
      return {
        result: `พัฒนา "${args.taskTitle}" เสร็จในสาขาแซนด์บ็อกซ์ เทสต์ผ่านทั้งหมด (จำลอง)`,
        speech: `เสร็จแล้ว: ${args.taskTitle} เปิด PR ไว้แล้ว`,
      };
    }

    const { object } = await generateObject({
      model,
      schema: z.object({
        result: z.string().describe("สรุปสั้น ๆ ว่าพัฒนาอะไรและทดสอบอย่างไร (ภาษาไทย)"),
        speech: z.string().describe("ประโยคสั้น ๆ ที่นักพัฒนาพูดออกมาตามคาแรกเตอร์ (ภาษาไทย)"),
      }),
      prompt:
        `คุณคือ ${args.devName} นักพัฒนา (${args.devPersona}) ` +
        `คุณได้รับมอบหมายงาน: "${args.taskTitle}" — ${args.taskDescription} ` +
        `จงอธิบายสั้น ๆ ว่าคุณพัฒนาและทดสอบมันในแซนด์บ็อกซ์ Docker อย่างไร ` +
        `ตอบเป็นภาษาไทยทั้งหมด`,
    });
    return object;
  },
});
