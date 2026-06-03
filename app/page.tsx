"use client";

import { useEffect, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { OfficeCanvas } from "./OfficeCanvas";
import { PortfolioChart } from "./PortfolioChart";
import { HirePanel } from "./HirePanel";
import type { Id } from "@/convex/_generated/dataModel";

const STATUS_DOT: Record<string, string> = {
  idle: "bg-slate-500",
  thinking: "bg-amber-400",
  working: "bg-emerald-400",
  in_meeting: "bg-blue-400",
};

// Thai labels for agent status.
const STATUS_TH: Record<string, string> = {
  idle: "ว่าง",
  thinking: "กำลังคิด",
  working: "กำลังทำงาน",
  in_meeting: "กำลังประชุม",
};

// Thai labels for roles.
const ROLE_TH: Record<string, string> = {
  CEO: "ซีอีโอ",
  Developer: "นักพัฒนา",
  Trader: "เทรดเดอร์",
  Analyst: "นักวิเคราะห์",
  Educator: "ครู",
  Housekeeper: "แม่บ้าน",
};

const TASK_BADGE: Record<string, string> = {
  backlog: "bg-slate-600 text-slate-100",
  in_progress: "bg-emerald-600 text-emerald-50",
  awaiting_approval: "bg-amber-500 text-black",
  done: "bg-blue-600 text-blue-50",
  failed: "bg-red-600 text-red-50",
};

// Thai labels for task status.
const TASK_TH: Record<string, string> = {
  backlog: "รอทำ",
  in_progress: "กำลังทำ",
  awaiting_approval: "รออนุมัติ",
  done: "เสร็จ",
  failed: "ล้มเหลว",
};

export default function Home() {
  const agents = useQuery(api.agents.list);
  const tasks = useQuery(api.orchestrator.listTasks);
  const sim = useQuery(api.orchestrator.simState);
  const trader = useQuery(api.tariq.dashboard);
  const equity = useQuery(api.tariq.equityHistory);
  const seed = useMutation(api.seed.seedAgents);
  const step = useAction(api.orchestrator.step);
  const tradeStep = useAction(api.tariq.tradeStep);
  const submitRealOrder = useAction(api.tariq.submitRealOrder);
  const bridgeStatus = useAction(api.tariq.bridgeStatus);
  const start = useMutation(api.orchestrator.start);
  const stop = useMutation(api.orchestrator.stop);
  const approveTask = useMutation(api.orchestrator.approveTask);
  const rejectTask = useMutation(api.orchestrator.rejectTask);
  const materials = useQuery(api.educator.listMaterials);
  const createMaterial = useAction(api.educator.createMaterial);
  const tendDevices = useAction(api.housekeeper.tendDevices);
  const iotStatus = useAction(api.housekeeper.bridgeStatus);
  const controlDevice = useAction(api.housekeeper.controlDevice);
  const [tending, setTending] = useState(false);
  const [iot, setIot] = useState<Record<string, unknown> | null>(null);
  const onTend = async () => {
    setTending(true);
    try {
      await tendDevices();
    } finally {
      setTending(false);
    }
  };
  useEffect(() => {
    let alive = true;
    const tick = () => iotStatus().then((s) => alive && setIot(s)).catch(() => {});
    tick();
    const id = setInterval(tick, 30000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [iotStatus]);

  const iotDevices = (iot?.devices as { name: string; platform: string }[] | undefined) ?? [];
  const iotLabel = !iot
    ? null
    : !iot.configured
      ? { text: "IoT: ยังไม่ได้ตั้งค่า (โหมดจำลอง)", cls: "text-slate-500" }
      : !iot.reachable
        ? { text: "IoT: เชื่อม bridge ไม่ได้", cls: "text-red-400" }
        : { text: `IoT: เชื่อมแล้ว · ${iot.device_count ?? 0} อุปกรณ์`, cls: "text-emerald-400" };
  const [stepping, setStepping] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [bridge, setBridge] = useState<Record<string, unknown> | null>(null);
  const [topic, setTopic] = useState("");
  const [genning, setGenning] = useState(false);
  const [hireOpen, setHireOpen] = useState(false);
  const [selMat, setSelMat] = useState<Id<"materials"> | null>(null);
  const material = useQuery(
    api.educator.getMaterial,
    selMat ? { id: selMat } : "skip",
  );

  const onGenerate = async () => {
    setGenning(true);
    try {
      await createMaterial({ topic });
      setTopic("");
    } finally {
      setGenning(false);
    }
  };

  // Poll the MT5 bridge health for the status indicator.
  useEffect(() => {
    let alive = true;
    const tick = () => bridgeStatus().then((b) => alive && setBridge(b)).catch(() => {});
    tick();
    const id = setInterval(tick, 30000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [bridgeStatus]);

  const bridgeLabel = !bridge
    ? null
    : !bridge.configured
      ? { text: "MT5: ยังไม่ได้ตั้งค่า", cls: "text-slate-500" }
      : !bridge.reachable
        ? { text: "MT5: เชื่อม bridge ไม่ได้", cls: "text-red-400" }
        : bridge.mt5_connected
          ? {
              text: `MT5: เชื่อมต่อแล้ว${bridge.is_demo ? " (Demo)" : " ⚠ Live"}`,
              cls: bridge.is_demo ? "text-emerald-400" : "text-amber-400",
            }
          : { text: "MT5: bridge ทำงาน แต่ terminal ปิด", cls: "text-amber-400" };

  const onAnalyze = async () => {
    setAnalyzing(true);
    try {
      await tradeStep();
    } finally {
      setAnalyzing(false);
    }
  };

  const onRealOrder = async () => {
    const s = trader?.signal;
    if (!s) return;
    if (
      !confirm(
        `ยืนยันส่งคำสั่งจริง?\n${s.direction} ทอง @ ${s.price}\nSL ${s.sl} / TP ${s.tp1}\n\n(คำเตือน: นี่คือเงินจริงผ่านโบรกเกอร์)`,
      )
    )
      return;
    const res = await submitRealOrder({
      side: s.direction,
      entry: s.entry,
      sl: s.sl,
      tp1: s.tp1,
      units: 100,
    });
    alert(res.message);
  };

  const running = sim?.running ?? false;
  const seeded = (agents?.length ?? 0) > 0;

  const onStep = async () => {
    setStepping(true);
    try {
      await step();
    } finally {
      setStepping(false);
    }
  };

  return (
    <main className="flex-1 flex flex-col items-center gap-6 p-8 bg-[#0a0b10] text-slate-200">
      {hireOpen && <HirePanel onClose={() => setHireOpen(false)} />}
      <header className="text-center">
        <h1 className="text-2xl font-bold tracking-tight">🏢 Gemification</h1>
        <p className="text-sm text-slate-400">บริษัท AI หลายเอเจนต์ในรูปแบบเกม</p>
      </header>

      <div className="flex flex-col lg:flex-row gap-6 items-start">
        <div className="flex flex-col gap-3">
          <OfficeCanvas />

          {/* แผงควบคุม */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => seed()}
              className="rounded-md bg-amber-500 hover:bg-amber-400 px-3 py-2 text-sm font-medium text-black transition"
            >
              สร้างพนักงาน
            </button>
            <button
              onClick={() => setHireOpen(true)}
              className="rounded-md bg-fuchsia-600 hover:bg-fuchsia-500 px-3 py-2 text-sm font-medium transition"
            >
              จ้างพนักงาน
            </button>
            <button
              onClick={onStep}
              disabled={!seeded || stepping || running}
              className="rounded-md bg-slate-700 hover:bg-slate-600 disabled:opacity-40 px-3 py-2 text-sm font-medium transition"
            >
              {stepping ? "กำลังทำงาน…" : "ก้าวต่อไป"}
            </button>
            {running ? (
              <button
                onClick={() => stop()}
                className="rounded-md bg-red-600 hover:bg-red-500 px-3 py-2 text-sm font-medium transition"
              >
                ⏸ หยุด
              </button>
            ) : (
              <button
                onClick={() => start()}
                disabled={!seeded}
                className="rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 px-3 py-2 text-sm font-medium transition"
              >
                ▶ รันอัตโนมัติ
              </button>
            )}
            <span className="text-xs text-slate-500 ml-auto">
              {running ? (
                <span className="text-emerald-400">● กำลังทำงาน</span>
              ) : (
                <span>หยุดชั่วคราว</span>
              )}{" "}
              · รอบที่ {sim?.tick ?? 0}
            </span>
          </div>

          {sim?.lastError && (
            <p className="text-xs text-amber-400/90 bg-amber-950/40 ring-1 ring-amber-500/20 rounded px-2 py-1.5">
              ⚠ จังหวะล่าสุดข้ามไป (น่าจะชน rate limit) — ลองต่อรอบถัดไปอัตโนมัติ:{" "}
              <span className="text-amber-300/70">{sim.lastError}</span>
            </p>
          )}
        </div>

        <aside className="w-80 flex flex-col gap-4">
          {/* พนักงาน */}
          <section>
            <h2 className="text-xs uppercase tracking-wider text-slate-500 mb-2">
              พนักงาน
            </h2>
            <div className="rounded-lg ring-1 ring-white/10 divide-y divide-white/5">
              {agents === undefined && (
                <p className="p-3 text-sm text-slate-500">กำลังเชื่อมต่อ…</p>
              )}
              {agents?.length === 0 && (
                <p className="p-3 text-sm text-slate-500">
                  ยังไม่มีพนักงาน — กด “สร้างพนักงาน”
                </p>
              )}
              {agents?.map((a) => (
                <div key={a._id} className="p-3 flex items-start gap-3">
                  <span
                    className="mt-1 h-3 w-3 rounded-full ring-2 ring-white/20 shrink-0"
                    style={{ background: a.color }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{a.name}</span>
                      <span className="text-xs text-slate-400">
                        {ROLE_TH[a.role] ?? a.role}
                      </span>
                      <span
                        className={`h-2 w-2 rounded-full ${STATUS_DOT[a.status] ?? "bg-slate-500"}`}
                      />
                      <span className="text-[10px] text-slate-500">
                        {STATUS_TH[a.status] ?? a.status}
                      </span>
                    </div>
                    {a.speech ? (
                      <p className="text-xs text-slate-300 italic truncate">“{a.speech}”</p>
                    ) : (
                      <p className="text-xs text-slate-600 truncate">{a.personality}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* กระดานงาน */}
          <section>
            <h2 className="text-xs uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-2">
              กระดานงาน
              {(() => {
                const n = tasks?.filter((t) => t.status === "awaiting_approval").length ?? 0;
                return n > 0 ? (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500 text-black normal-case tracking-normal">
                    {n} รออนุมัติ
                  </span>
                ) : null;
              })()}
            </h2>
            <div className="rounded-lg ring-1 ring-white/10 divide-y divide-white/5 max-h-80 overflow-auto">
              {tasks === undefined && (
                <p className="p-3 text-sm text-slate-500">กำลังโหลด…</p>
              )}
              {tasks?.length === 0 && (
                <p className="p-3 text-sm text-slate-500">
                  ยังไม่มีงาน — กด “ก้าวต่อไป” หรือ “รันอัตโนมัติ” เพื่อเริ่ม
                </p>
              )}
              {tasks?.map((t) => (
                <div
                  key={t._id}
                  className={`p-3 ${t.status === "awaiting_approval" ? "bg-amber-500/10" : ""}`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded ${TASK_BADGE[t.status] ?? "bg-slate-600"}`}
                    >
                      {TASK_TH[t.status] ?? t.status}
                    </span>
                    <span className="text-sm font-medium truncate">{t.title}</span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1 line-clamp-2">
                    {t.description}
                  </p>
                  {t.status === "awaiting_approval" && (
                    <div className="flex gap-2 mt-2">
                      <button
                        onClick={() => approveTask({ taskId: t._id })}
                        className="flex-1 rounded bg-emerald-600 hover:bg-emerald-500 px-2 py-1 text-xs font-medium transition"
                      >
                        ✓ อนุมัติให้ deploy
                      </button>
                      <button
                        onClick={() => rejectTask({ taskId: t._id })}
                        className="flex-1 rounded bg-red-700 hover:bg-red-600 px-2 py-1 text-xs font-medium transition"
                      >
                        ✕ ปฏิเสธ
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* เทรดเดอร์ทอง (Tariq) */}
          <section>
            <h2 className="text-xs uppercase tracking-wider text-slate-500 mb-2">
              เทรดเดอร์ทอง — {trader?.name ?? "Tariq"}
            </h2>
            <div className="rounded-lg ring-1 ring-white/10 p-3 flex flex-col gap-3">
              {!trader ? (
                <p className="text-sm text-slate-500">กำลังโหลด…</p>
              ) : (
                <>
                  {/* พอร์ต */}
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div>
                      <p className="text-[10px] text-slate-500">มูลค่ารวม</p>
                      <p className="text-sm font-semibold">
                        ${trader.totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-500">เงินสด</p>
                      <p className="text-sm">
                        ${trader.cash.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-500">กำไรสะสม</p>
                      <p
                        className={`text-sm font-semibold ${trader.realizedPnl >= 0 ? "text-emerald-400" : "text-red-400"}`}
                      >
                        {trader.realizedPnl >= 0 ? "+" : ""}
                        {trader.realizedPnl.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </p>
                    </div>
                  </div>

                  {/* กราฟมูลค่าพอร์ต */}
                  <PortfolioChart points={equity ?? []} />

                  {/* สถานะที่ถืออยู่ */}
                  {trader.position && (
                    <div className="rounded bg-white/5 px-2 py-1.5 text-xs">
                      <span
                        className={`font-semibold ${trader.position.side === "BUY" ? "text-emerald-400" : "text-red-400"}`}
                      >
                        {trader.position.side === "BUY" ? "▲ LONG" : "▼ SHORT"}
                      </span>{" "}
                      {trader.position.units} หน่วย @ {trader.position.entry.toFixed(2)} · SL{" "}
                      {trader.position.sl.toFixed(2)} · TP {trader.position.tp1.toFixed(2)}
                    </div>
                  )}

                  {/* สัญญาณล่าสุด */}
                  {trader.signal && (
                    <div className="text-xs flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span className="text-slate-400">ทอง</span>
                        <span className="font-semibold">${trader.signal.price.toFixed(2)}</span>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] ${
                            trader.signal.direction === "BUY"
                              ? "bg-emerald-600 text-emerald-50"
                              : trader.signal.direction === "SELL"
                                ? "bg-red-600 text-red-50"
                                : "bg-slate-600 text-slate-200"
                          }`}
                        >
                          {trader.signal.direction}
                        </span>
                        <span className="ml-auto">{trader.signal.stars}</span>
                      </div>
                      <div className="flex items-center gap-2 text-slate-500">
                        <span>คะแนน {trader.signal.score}/10</span>
                        <span>RSI {trader.signal.rsi1h}</span>
                        <span>ADX {trader.signal.adx}</span>
                        <span>
                          1D {trader.signal.emaDaily} 4H {trader.signal.ema4h}
                        </span>
                      </div>
                      <p className="text-slate-500">{trader.signal.reason}</p>
                    </div>
                  )}

                  {/* ปุ่ม */}
                  <div className="flex gap-2">
                    <button
                      onClick={onAnalyze}
                      disabled={analyzing || running}
                      className="flex-1 rounded-md bg-yellow-600 hover:bg-yellow-500 disabled:opacity-40 px-2 py-1.5 text-xs font-medium text-black transition"
                    >
                      {analyzing ? "กำลังวิเคราะห์…" : "วิเคราะห์ทอง"}
                    </button>
                    <button
                      onClick={onRealOrder}
                      disabled={!trader.signal || !trader.signal.actionable}
                      title={
                        trader.signal?.actionable
                          ? "ส่งคำสั่งจริง (ต้องยืนยัน)"
                          : "ไม่มีสัญญาณที่เข้าเกณฑ์ส่งจริง"
                      }
                      className="flex-1 rounded-md bg-red-700 hover:bg-red-600 disabled:opacity-30 px-2 py-1.5 text-xs font-medium transition"
                    >
                      ส่งคำสั่งจริง
                    </button>
                  </div>

                  {bridgeLabel && (
                    <p className={`text-[10px] ${bridgeLabel.cls}`}>● {bridgeLabel.text}</p>
                  )}
                </>
              )}
            </div>
          </section>

          {/* ครูตั้ม — สื่อการสอน GAS */}
          <section>
            <h2 className="text-xs uppercase tracking-wider text-slate-500 mb-2">
              ครูตั้ม — สื่อการสอน GAS
            </h2>
            <div className="rounded-lg ring-1 ring-white/10 p-3 flex flex-col gap-3">
              <div className="flex gap-2">
                <input
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="หัวข้อ เช่น การคูณเลขหลักเดียว"
                  className="flex-1 min-w-0 rounded-md bg-white/5 ring-1 ring-white/10 px-2 py-1.5 text-xs outline-none focus:ring-pink-400/40"
                />
                <button
                  onClick={onGenerate}
                  disabled={genning}
                  className="rounded-md bg-pink-600 hover:bg-pink-500 disabled:opacity-40 px-3 py-1.5 text-xs font-medium transition whitespace-nowrap"
                >
                  {genning ? "กำลังเขียน…" : "สร้างสื่อ"}
                </button>
              </div>

              {materials && materials.length > 0 && (
                <div className="flex flex-col gap-1 max-h-32 overflow-auto">
                  {materials.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => setSelMat(m.id)}
                      className={`text-left text-xs rounded px-2 py-1 transition ${
                        selMat === m.id ? "bg-pink-500/20 ring-1 ring-pink-400/40" : "hover:bg-white/5"
                      }`}
                    >
                      📄 {m.title}{" "}
                      <span className="text-slate-500">({(m.bytes / 1024).toFixed(1)} KB)</span>
                    </button>
                  ))}
                </div>
              )}

              {material && (
                <div className="flex flex-col gap-2">
                  {/* พรีวิว — iframe ทำให้สคริปต์กันลิงก์ผ่าน (อยู่ใน frame) */}
                  <iframe
                    title="preview"
                    srcDoc={material.indexHtml}
                    className="w-full h-56 rounded bg-white ring-1 ring-white/10"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => navigator.clipboard.writeText(material.indexHtml)}
                      className="flex-1 rounded bg-slate-700 hover:bg-slate-600 px-2 py-1 text-xs transition"
                    >
                      คัดลอก Index.html
                    </button>
                    <button
                      onClick={() => navigator.clipboard.writeText(material.codeJs)}
                      className="flex-1 rounded bg-slate-700 hover:bg-slate-600 px-2 py-1 text-xs transition"
                    >
                      คัดลอก รหัส.js
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* แม่บ้านนวล — IoT */}
          <section>
            <h2 className="text-xs uppercase tracking-wider text-slate-500 mb-2">
              แม่บ้านนวล — IoT
            </h2>
            <div className="rounded-lg ring-1 ring-white/10 p-3 flex flex-col gap-2">
              <button
                onClick={onTend}
                disabled={tending}
                className="rounded-md bg-violet-600 hover:bg-violet-500 disabled:opacity-40 px-3 py-1.5 text-xs font-medium transition"
              >
                {tending ? "กำลังดูแล…" : "ตรวจ/สั่งอุปกรณ์ (จำลอง)"}
              </button>

              {/* อุปกรณ์จริงจาก IoT bridge (SmartLife/Tuya + Xiaomi) */}
              {iotDevices.length > 0 && (
                <div className="flex flex-col gap-1.5 pt-1">
                  {iotDevices.map((d) => (
                    <div key={d.name} className="flex items-center gap-2 text-xs">
                      <span className="flex-1 truncate">
                        {d.platform === "tuya" ? "🟧" : "🟨"} {d.name}
                      </span>
                      <button
                        onClick={() => controlDevice({ name: d.name, on: true }).then((r) => alert(r.message))}
                        className="rounded bg-emerald-700 hover:bg-emerald-600 px-2 py-0.5"
                      >
                        เปิด
                      </button>
                      <button
                        onClick={() => controlDevice({ name: d.name, on: false }).then((r) => alert(r.message))}
                        className="rounded bg-slate-600 hover:bg-slate-500 px-2 py-0.5"
                      >
                        ปิด
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {iotLabel && <p className={`text-[10px] ${iotLabel.cls}`}>● {iotLabel.text}</p>}
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}
