import { ArrowRight, ArrowUpRight } from "lucide-react";
import { projects } from "../lib/content";
import type { RenderBlock, RenderView } from "../lib/agent/render";

export const LINKS = {
  cv: { label: "Download CV", href: "/Ayush_Bhattacharya_CV.pdf" },
  email: { label: "Email Ayush", href: "mailto:bhatt.ayush.1998@gmail.com" },
  linkedin: {
    label: "LinkedIn",
    href: "https://www.linkedin.com/in/ayush-bhattacharya-ba09b6162",
  },
  github: { label: "GitHub", href: "https://github.com/Ayushbh6" },
  socrates_repo: {
    label: "Socrates repository",
    href: "https://github.com/Ayushbh6/Socrates",
  },
  checker_repo: {
    label: "Checker repository",
    href: "https://github.com/Ayushbh6/DPA_Guru",
  },
  sec_repo: {
    label: "SEC Summariser repository",
    href: "https://github.com/Ayushbh6/SEC-Summariser",
  },
} as const;

// The agent-facing ids differ slightly from the landing-page ids.
const PROJECT_CARDS: Record<
  string,
  {
    number: string;
    name: string;
    category: string;
    subtitle: string;
    detail: string;
    stack: readonly string[];
    status: string;
  }
> = {
  socrates: projects[0],
  checker: projects[1],
  sec_summariser: projects[2],
  this_website: {
    number: "04",
    name: "This website",
    category: "VOICE AGENT",
    subtitle: "A conversation instead of a CV.",
    detail:
      "The assistant you are talking to: a real-time voice agent on Gemini Live that answers from an approved profile and composes this screen as it speaks.",
    stack: ["Gemini Live", "Generative UI", "Cloudflare Workers"],
    status: "Personal project · live",
  },
};

function Block({ block }: { block: RenderBlock }) {
  const head =
    "heading" in block && block.heading ? (
      <h3 className="gv-heading">{block.heading}</h3>
    ) : null;
  switch (block.kind) {
    case "text":
      return (
        <div className="gv-block">
          {head}
          <p className="gv-text">{block.body}</p>
        </div>
      );
    case "bullets":
      return (
        <div className="gv-block">
          {head}
          <ul className="gv-bullets">
            {block.points.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      );
    case "stats":
      return (
        <div className="gv-block">
          {head}
          <div className="gv-stats">
            {block.stats.map((s) => (
              <div key={s.label}>
                <strong>{s.value}</strong>
                <span>{s.label}</span>
              </div>
            ))}
          </div>
        </div>
      );
    case "timeline":
      return (
        <div className="gv-block">
          {head}
          <div className="timeline canvas-timeline gv-timeline">
            {block.entries.map((e) => (
              <article key={e.period + e.title}>
                <span className="eyebrow">{e.period}</span>
                <div>
                  <h3>{e.org}</h3>
                  <span className="role">{e.title}</span>
                  {e.note && <p>{e.note}</p>}
                </div>
              </article>
            ))}
          </div>
        </div>
      );
    case "project": {
      const card = PROJECT_CARDS[block.project];
      return (
        <div className="gv-block gv-project">
          <p className="eyebrow">
            {card.category} / {card.number}
          </p>
          <h3 className="gv-project-name">
            {card.name}
            <em>{card.subtitle}</em>
          </h3>
          <p className="project-detail">{card.detail}</p>
          {block.emphasis && <p className="gv-emphasis">{block.emphasis}</p>}
          <div className="stack">
            {card.stack.map((s) => (
              <span key={s}>{s}</span>
            ))}
          </div>
          <p className="project-status">{card.status}</p>
        </div>
      );
    }
    case "flow":
      return (
        <div className="gv-block">
          {head}
          <div
            className="architecture gv-flow"
            style={{
              gridTemplateColumns: `repeat(${block.steps.length}, 1fr)`,
            }}
          >
            {block.steps.map((step, i) => (
              <div key={step}>
                <span>{String(i + 1).padStart(2, "0")}</span>
                <strong>{step}</strong>
                {i < block.steps.length - 1 && <ArrowRight />}
              </div>
            ))}
          </div>
          <p className="caption">
            An illustrative workflow, not a verified deployment diagram.
          </p>
        </div>
      );
    case "fit":
      return (
        <div className="gv-block">
          {head}
          <div className="gv-fit" role="table">
            {block.rows.map((r) => (
              <div
                className={`gv-fit-row ${r.strength}`}
                role="row"
                key={r.requirement}
              >
                <span className="gv-fit-badge" role="cell">
                  {r.strength === "strong"
                    ? "Strong match"
                    : r.strength === "partial"
                      ? "Partial"
                      : "Gap"}
                </span>
                <strong role="cell">{r.requirement}</strong>
                <p role="cell">{r.evidence}</p>
              </div>
            ))}
          </div>
        </div>
      );
    case "tags":
      return (
        <div className="gv-block">
          {head}
          <div className="stack gv-tags">
            {block.tags.map((t) => (
              <span key={t}>{t}</span>
            ))}
          </div>
        </div>
      );
    case "links":
      return (
        <div className="gv-block">
          {head}
          <div className="gv-links">
            {block.links.map((l) => (
              <a
                className="inline-link"
                key={l}
                href={LINKS[l].href}
                target={l === "email" ? undefined : "_blank"}
                rel="noreferrer"
              >
                {LINKS[l].label} <ArrowUpRight size={16} />
              </a>
            ))}
          </div>
        </div>
      );
  }
}

export default function GenerativeView({
  view,
  eyebrow = "COMPOSED BY THE ASSISTANT",
}: {
  view: RenderView;
  eyebrow?: string;
}) {
  return (
    <div className="gv" key={view.title}>
      <p className="eyebrow">{eyebrow}</p>
      <h2 id="canvas-title">{view.title}</h2>
      {view.subtitle && <p className="stage-description">{view.subtitle}</p>}
      <div className={`gv-blocks ${view.layout}`}>
        {view.blocks.map((b, i) => (
          <Block block={b} key={i} />
        ))}
      </div>
    </div>
  );
}
