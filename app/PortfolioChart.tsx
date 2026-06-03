"use client";

// Self-contained SVG equity-curve chart — no charting dependency.
// Green when the latest value is at/above the starting value, red otherwise.

type Point = { t: number; value: number };

export function PortfolioChart({
  points,
  width = 296,
  height = 96,
}: {
  points: Point[];
  width?: number;
  height?: number;
}) {
  if (!points || points.length === 0) {
    return (
      <div
        style={{ width, height }}
        className="rounded bg-white/5 flex items-center justify-center text-[11px] text-slate-600"
      >
        ยังไม่มีข้อมูล — กด “วิเคราะห์ทอง” หรือ “รันอัตโนมัติ”
      </div>
    );
  }

  const pad = 6;
  const start = points[0].value;
  const lastVal = points[points.length - 1].value;
  const up = lastVal >= start;
  const stroke = up ? "#34d399" : "#f87171";
  const fillTop = up ? "rgba(52,211,153,0.22)" : "rgba(248,113,113,0.22)";

  const values = points.map((p) => p.value);
  // Include the start line in the range so the baseline is always visible.
  const min = Math.min(...values, start);
  const max = Math.max(...values, start);
  const span = max - min || 1;

  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const x = (i: number) =>
    pad + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v: number) => pad + innerH - ((v - min) / span) * innerH;

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)},${(height - pad).toFixed(1)} L${x(0).toFixed(1)},${(height - pad).toFixed(1)} Z`;
  const baseY = y(start);

  const pct = ((lastVal - start) / start) * 100;

  return (
    <svg width={width} height={height} className="rounded bg-white/5">
      {/* baseline at the starting value */}
      <line
        x1={pad}
        x2={width - pad}
        y1={baseY}
        y2={baseY}
        stroke="#475569"
        strokeWidth={1}
        strokeDasharray="3 3"
      />
      <path d={area} fill={fillTop} stroke="none" />
      <path d={line} fill="none" stroke={stroke} strokeWidth={1.75} strokeLinejoin="round" />
      <circle cx={x(points.length - 1)} cy={y(lastVal)} r={2.5} fill={stroke} />
      <text x={pad} y={pad + 8} fontSize={9} fill="#64748b">
        ${start.toLocaleString(undefined, { maximumFractionDigits: 0 })}
      </text>
      <text
        x={width - pad}
        y={pad + 8}
        fontSize={9}
        textAnchor="end"
        fill={stroke}
      >
        {pct >= 0 ? "+" : ""}
        {pct.toFixed(2)}%
      </text>
    </svg>
  );
}
