"use client";

// Small dependency-free SVG charts for the overview.

const W = 640;
const H = 170;
const LEFT = 34;
const BOTTOM = 22;

type Series = { name: string; color: string; values: number[] };

export function BarChart({
  labels,
  series,
  format = (n) => String(Math.round(n * 100) / 100),
  title,
}: {
  labels: string[];
  series: Series[];
  format?: (n: number) => string;
  title: string;
}) {
  const n = labels.length;
  const totals = labels.map((_, i) =>
    series.reduce((a, s) => a + (s.values[i] ?? 0), 0),
  );
  const max = Math.max(...totals, 0);
  const top = max === 0 ? 1 : max;
  const slot = (W - LEFT) / n;
  const bar = Math.max(2, Math.min(28, slot * 0.7));
  const y = (v: number) => ((H - BOTTOM - 8) * v) / top;
  const ticks = [0, Math.floor((n - 1) / 2), n - 1];
  return (
    <figure className="adm-chart">
      <figcaption>
        <strong>{title}</strong>
        <span className="adm-legend">
          {series.length > 1 &&
            series.map((s) => (
              <span key={s.name}>
                <i style={{ background: s.color }} /> {s.name}
              </span>
            ))}
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
        <line
          x1={LEFT}
          x2={W}
          y1={H - BOTTOM}
          y2={H - BOTTOM}
          className="axis"
        />
        <line x1={LEFT} x2={W} y1={8} y2={8} className="grid" />
        <text x={LEFT - 6} y={12} className="tick" textAnchor="end">
          {format(max)}
        </text>
        <text x={LEFT - 6} y={H - BOTTOM} className="tick" textAnchor="end">
          0
        </text>
        {labels.map((label, i) => {
          let base = H - BOTTOM;
          const x = LEFT + i * slot + (slot - bar) / 2;
          return (
            <g key={label + i}>
              <title>{`${label}: ${series
                .map((s) => `${s.name} ${format(s.values[i] ?? 0)}`)
                .join(", ")}`}</title>
              <rect
                x={LEFT + i * slot}
                y={8}
                width={slot}
                height={H - BOTTOM - 8}
                className="hit"
              />
              {series.map((s) => {
                const h = y(s.values[i] ?? 0);
                base -= h;
                return h > 0 ? (
                  <rect
                    key={s.name}
                    x={x}
                    y={base}
                    width={bar}
                    height={h}
                    rx={2}
                    fill={s.color}
                  />
                ) : null;
              })}
            </g>
          );
        })}
        {ticks.map((i) => (
          <text
            key={i}
            x={LEFT + i * slot + slot / 2}
            y={H - 6}
            className="tick"
            textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
          >
            {labels[i]}
          </text>
        ))}
      </svg>
    </figure>
  );
}

// Ranked horizontal bars (top views).
export function Ranked({
  title,
  items,
}: {
  title: string;
  items: { label: string; value: number }[];
}) {
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <figure className="adm-chart">
      <figcaption>
        <strong>{title}</strong>
      </figcaption>
      {items.length === 0 && <p className="adm-muted">Nothing yet.</p>}
      <ol className="adm-ranked">
        {items.map((i) => (
          <li key={i.label}>
            <span className="adm-ranked-label">{i.label}</span>
            <span className="adm-ranked-bar">
              <i style={{ width: `${(i.value / max) * 100}%` }} />
            </span>
            <span className="adm-muted">{i.value}</span>
          </li>
        ))}
      </ol>
    </figure>
  );
}
