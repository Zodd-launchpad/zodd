"use client";

// A token "bonds" (graduates) once its real ZEC reserve crosses the
// threshold -- visualized as sand draining from the top bulb into the
// bottom one. `pct` is the same 0-100 graduation progress the old linear
// bar used; at 100 the bottom bulb reads as full ("bondeo").
const GLASS_STROKE = "var(--border)";
const BULB_HEIGHT = 54; // y-span of each bulb in the 100x140 viewBox, from its wide end to the neck

export default function Hourglass({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(100, pct));
  const bottomFillH = (clamped / 100) * BULB_HEIGHT;
  const topFillH = ((100 - clamped) / 100) * BULB_HEIGHT;
  const bottomY = 126 - bottomFillH; // bottom bulb sand grows upward from the base
  const topY = 68 - topFillH; // top bulb sand recedes downward toward the neck as it drains
  const flowing = clamped > 0 && clamped < 100;

  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "4px 0" }}>
      <svg width="64" height="90" viewBox="0 0 100 140" aria-hidden="true">
        <defs>
          <clipPath id="hg-top-bulb">
            <path d="M28,14 L72,14 L54,68 L46,68 Z" />
          </clipPath>
          <clipPath id="hg-bottom-bulb">
            <path d="M46,72 L54,72 L72,126 L28,126 Z" />
          </clipPath>
          <linearGradient id="hg-sand" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffcc4d" />
            <stop offset="100%" stopColor="#f5a623" />
          </linearGradient>
        </defs>

        <rect x="20" y="8" width="60" height="6" rx="3" fill={GLASS_STROKE} />
        <rect x="20" y="126" width="60" height="6" rx="3" fill={GLASS_STROKE} />

        {topFillH > 0.3 && (
          <rect x="20" y={topY} width="60" height={topFillH} fill="url(#hg-sand)" clipPath="url(#hg-top-bulb)" />
        )}
        {bottomFillH > 0.3 && (
          <rect x="20" y={bottomY} width="60" height={bottomFillH} fill="url(#hg-sand)" clipPath="url(#hg-bottom-bulb)" />
        )}

        {flowing && <rect x="49" y="68" width="2" height="4" fill="#f5a623" className="hourglass-stream" />}

        <path
          d="M28,14 L72,14 L54,68 L54,72 L72,126 L28,126 L46,72 L46,68 Z"
          fill="none"
          stroke={GLASS_STROKE}
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
