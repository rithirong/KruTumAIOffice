"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import catalog from "./personaCatalog.json";

type Persona = { name: string; division: string; emoji: string; color: string; vibe: string };

const DIVISIONS = [...new Set((catalog as Persona[]).map((p) => p.division))].sort();

export function HirePanel({ onClose }: { onClose: () => void }) {
  const hired = useQuery(api.hire.listHired);
  const hire = useMutation(api.hire.hire);
  const fire = useMutation(api.hire.fire);
  const [division, setDivision] = useState<string>("all");
  const [q, setQ] = useState("");

  const hiredNames = useMemo(() => new Set((hired ?? []).map((h) => h.name)), [hired]);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (catalog as Persona[]).filter(
      (p) =>
        (division === "all" || p.division === division) &&
        (!needle || p.name.toLowerCase().includes(needle) || p.vibe.toLowerCase().includes(needle)),
    );
  }, [division, q]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-[#0e1016] ring-1 ring-white/10 rounded-xl w-full max-w-3xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-3 p-4 border-b border-white/10">
          <h2 className="text-lg font-semibold">จ้างพนักงาน</h2>
          <span className="text-xs text-slate-500">
            แคตตาล็อก {catalog.length} คน · ทีมปัจจุบัน {hired?.length ?? 0}
          </span>
          <button
            onClick={onClose}
            className="ml-auto rounded-md bg-slate-700 hover:bg-slate-600 px-3 py-1 text-sm"
          >
            ปิด
          </button>
        </header>

        <div className="flex gap-2 p-3 border-b border-white/10">
          <select
            value={division}
            onChange={(e) => setDivision(e.target.value)}
            className="rounded-md bg-white/5 ring-1 ring-white/10 px-2 py-1.5 text-sm outline-none"
          >
            <option value="all">ทุกแผนก</option>
            {DIVISIONS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ค้นหาชื่อ/บทบาท…"
            className="flex-1 rounded-md bg-white/5 ring-1 ring-white/10 px-3 py-1.5 text-sm outline-none focus:ring-amber-400/40"
          />
        </div>

        <div className="overflow-auto p-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
          {list.map((p) => {
            const isHired = hiredNames.has(p.name);
            return (
              <div
                key={p.division + p.name}
                className="rounded-lg ring-1 ring-white/10 p-3 flex items-start gap-3"
              >
                <span
                  className="text-xl shrink-0 h-8 w-8 rounded-full flex items-center justify-center"
                  style={{ background: p.color + "33" }}
                >
                  {p.emoji}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm truncate">{p.name}</span>
                    <span className="text-[10px] text-slate-500">{p.division}</span>
                  </div>
                  <p className="text-xs text-slate-500 line-clamp-2">{p.vibe}</p>
                </div>
                <button
                  onClick={() => hire({ name: p.name, division: p.division, vibe: p.vibe, color: p.color, emoji: p.emoji })}
                  disabled={isHired}
                  className="shrink-0 rounded-md bg-amber-500 hover:bg-amber-400 disabled:opacity-30 px-2.5 py-1 text-xs font-medium text-black transition"
                >
                  {isHired ? "จ้างแล้ว" : "จ้าง"}
                </button>
              </div>
            );
          })}
        </div>

        {hired && hired.length > 0 && (
          <div className="border-t border-white/10 p-3">
            <p className="text-xs text-slate-500 mb-2">ทีมที่จ้างมา (กดเพื่อปลด)</p>
            <div className="flex flex-wrap gap-2">
              {hired.map((h) => (
                <button
                  key={h.id}
                  onClick={() => fire({ id: h.id })}
                  className="rounded-full px-2.5 py-1 text-xs ring-1 ring-white/15 hover:bg-red-600/30"
                  title="ปลดออก"
                  style={{ borderColor: h.color }}
                >
                  {h.name} ✕
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
