"use client";
import { useCallback, useState } from "react";
import { BarChart, Ranked } from "./charts";
import { REFRESH_MS, Updated, usePoll, type Call, type Row } from "./lib";

const VOICE = "#7647ae";
const TEXT = "#d3a8ec";
const dayLabel = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

export default function Overview({ call, tick }: { call: Call; tick: number }) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Row | null>(null);
  const load = useCallback(async () => {
    const next = await call(`/admin/stats?days=${days}`);
    if (next) setData(next);
  }, [call, days]);
  const updated = usePoll(load, REFRESH_MS, tick);
  if (!data) return <p className="adm-muted">Loading…</p>;
  const t = data.totals;
  const s: Row[] = data.series;
  const labels = s.map((d) => dayLabel(d.date));
  // Hours come in UTC; show them in the owner's time.
  const offset = -new Date().getTimezoneOffset() / 60;
  const local = Array<number>(24).fill(0);
  data.hours.forEach((n: number, h: number) => {
    local[(((h + Math.round(offset)) % 24) + 24) % 24] += n;
  });
  const money = (n: number) => `$${n.toFixed(2)}`;
  const tiles: [string, string, string?][] = [
    [
      "Conversations",
      String(t.conversations),
      `${Math.round(t.voiceShare * 100)}% voice`,
    ],
    ["Visitors", String(t.visitors)],
    [
      "Engaged",
      t.conversations
        ? `${Math.round((t.engagedConversations / t.conversations) * 100)}%`
        : "—",
      `${t.engagedConversations} asked something`,
    ],
    [
      "Messages from visitors",
      String(t.userTurns),
      `${t.avgTurns} per conversation`,
    ],
    ["Job descriptions", String(t.jobDescriptions), "fit tables shown"],
    ["Views shown", String(t.viewsShown)],
    ["Left a message", String(t.leftMessages)],
    ["Counted spend", money(t.costUsd), "voice at worst case"],
  ];
  return (
    <section>
      <div className="adm-line adm-range">
        <span className="adm-muted">Last</span>
        {[7, 30, 90].map((d) => (
          <button
            key={d}
            className={days === d ? "on" : "adm-quiet"}
            onClick={() => setDays(d)}
          >
            {d} days
          </button>
        ))}
        <Updated at={updated} />
      </div>
      <div className="adm-tiles">
        {tiles.map(([label, value, note]) => (
          <div key={label} className="adm-tile">
            <span className="adm-muted">{label}</span>
            <strong>{value}</strong>
            {note && <span className="adm-muted">{note}</span>}
          </div>
        ))}
      </div>
      <div className="adm-charts">
        <BarChart
          title="Conversations per day"
          labels={labels}
          series={[
            { name: "Voice", color: VOICE, values: s.map((d) => d.voice) },
            { name: "Text", color: TEXT, values: s.map((d) => d.text) },
          ]}
          format={(n) => String(Math.round(n))}
        />
        <BarChart
          title="Visitors per day"
          labels={labels}
          series={[
            {
              name: "Visitors",
              color: VOICE,
              values: s.map((d) => d.visitors),
            },
          ]}
          format={(n) => String(Math.round(n))}
        />
        <BarChart
          title="Visitor messages per day"
          labels={labels}
          series={[
            { name: "Messages", color: VOICE, values: s.map((d) => d.turns) },
          ]}
          format={(n) => String(Math.round(n))}
        />
        <BarChart
          title="Counted spend per day"
          labels={labels}
          series={[
            { name: "USD", color: "#e08cb4", values: s.map((d) => d.costUsd) },
          ]}
          format={(n) => money(n)}
        />
        <BarChart
          title="When people start a conversation (your local time)"
          labels={local.map((_, h) => `${String(h).padStart(2, "0")}h`)}
          series={[{ name: "Conversations", color: VOICE, values: local }]}
          format={(n) => String(Math.round(n))}
        />
        <Ranked
          title="Most shown views"
          items={(data.topViews as Row[]).map((v) => ({
            label: v.title,
            value: v.n,
          }))}
        />
      </div>
    </section>
  );
}
