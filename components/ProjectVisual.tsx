"use client";

import { useId } from "react";
import type { ProjectId } from "../lib/content";

// Original schematic illustrations. These depict workflows, not product screenshots.
export default function ProjectVisual({
  project,
  active = 0,
}: {
  project: ProjectId;
  active?: number;
}) {
  const marker = useId().replaceAll(":", "");
  const ink = "#473453",
    muted = "#8a7895",
    line = "#b8a8c5",
    accent = "#8050a5";
  const selected = (step: number) => (active === step ? "#e0ceef" : "#f8f5fa");
  return (
    <svg
      className={`project-visual visual-${project}`}
      viewBox="0 0 560 300"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <marker
          id={marker}
          markerWidth="7"
          markerHeight="7"
          refX="6"
          refY="3.5"
          orient="auto"
        >
          <path d="m1 1 4 2.5L1 6" stroke={muted} strokeWidth="1.2" />
        </marker>
      </defs>
      {project === "socrates" ? (
        <>
          <circle
            cx="133"
            cy="144"
            r="101"
            stroke={line}
            strokeDasharray="3 8"
            className="visual-orbit"
          />
          <path
            d="M207 144h54V64h44M261 144h44M261 144v81h44"
            stroke={line}
            strokeWidth="1.5"
            markerEnd={`url(#${marker})`}
          />
          <circle
            cx="133"
            cy="144"
            r="73"
            fill={active === 0 ? "#ded0e9" : "#eee6f3"}
            stroke={line}
            className="visual-node"
          />
          <text
            x="133"
            y="144"
            textAnchor="middle"
            fill={ink}
            fontSize="31"
            fontFamily="var(--serif)"
          >
            Socrates
          </text>
          <text x="133" y="169" textAnchor="middle" fill={muted} fontSize="13">
            AGENT RUNTIME
          </text>
          {[
            ["Local tools", "Files · shell · MCP"],
            ["Working context", "Structured compression"],
            ["Project history", "SQLite · trace retrieval"],
          ].map(([title, sub], i) => (
            <g key={title}>
              <rect
                x="306"
                y={30 + i * 80}
                width="218"
                height="67"
                rx="5"
                fill={selected(i + 1)}
                stroke={active === i + 1 ? accent : line}
                className="visual-node"
              />
              <circle cx="325" cy={51 + i * 80} r="3" fill={accent} />
              <text x="339" y={58 + i * 80} fill={ink} fontSize="20">
                {title}
              </text>
              <text x="324" y={80 + i * 80} fill={muted} fontSize="13">
                {sub}
              </text>
            </g>
          ))}
          <text
            x="133"
            y="274"
            textAnchor="middle"
            fill={muted}
            fontSize="13"
            letterSpacing="1"
          >
            CONTEXT WITH A WAY BACK
          </text>
        </>
      ) : project === "checker" ? (
        <>
          <rect
            x="35"
            y="30"
            width="215"
            height="244"
            rx="5"
            fill={active === 0 ? "#fff" : "#faf8f6"}
            stroke={line}
            className="visual-node"
          />
          <text x="55" y="61" fill={muted} fontSize="12" letterSpacing="2">
            AGREEMENT
          </text>
          <text
            x="55"
            y="93"
            fill={ink}
            fontSize="25"
            fontFamily="var(--serif)"
          >
            Data processing
          </text>
          <path
            d="M55 114h153M55 126h127M55 214h150M55 226h138M55 238h84"
            stroke={line}
            strokeWidth="2"
          />
          <rect x="48" y="145" width="189" height="48" rx="3" fill="#e3d6ed" />
          <text x="60" y="164" fill={ink} fontSize="14">
            Relevant clause
          </text>
          <path d="M60 179h149" stroke={muted} strokeWidth="2" />
          <path
            d="M237 169h46"
            stroke={accent}
            strokeWidth="1.5"
            markerEnd={`url(#${marker})`}
          />
          <text x="297" y="57" fill={muted} fontSize="12" letterSpacing="1.5">
            REVIEW CRITERIA
          </text>
          <rect
            x="286"
            y="72"
            width="238"
            height="44"
            rx="4"
            fill={selected(1)}
            stroke={line}
            className="visual-node"
          />
          <path d="m301 93 5 5 9-11" stroke={accent} strokeWidth="2" />
          <text x="328" y="101" fill={ink} fontSize="19">
            Approved by reviewer
          </text>
          <rect
            x="286"
            y="140"
            width="238"
            height="66"
            rx="4"
            fill={selected(2)}
            stroke={active === 2 ? accent : line}
            className="visual-node"
          />
          <text x="304" y="166" fill={ink} fontSize="21">
            Finding + evidence
          </text>
          <text x="304" y="190" fill={muted} fontSize="14">
            Source excerpt · page reference
          </text>
          <path d="M405 207v24" stroke={line} markerEnd={`url(#${marker})`} />
          <circle
            cx="306"
            cy="255"
            r="13"
            fill={active === 3 ? accent : "#d9c9e5"}
            className="visual-node"
          />
          <path
            d="m300 255 4 4 8-8"
            stroke={active === 3 ? "#fff" : ink}
            strokeWidth="2"
          />
          <text x="332" y="262" fill={ink} fontSize="21">
            Human decision
          </text>
        </>
      ) : (
        <>
          <path
            d="M167 155h42M351 155h35"
            stroke={line}
            strokeWidth="1.5"
            markerEnd={`url(#${marker})`}
          />
          <text
            x="103"
            y="34"
            textAnchor="middle"
            fill={muted}
            fontSize="12"
            letterSpacing="2"
          >
            DISCOVER
          </text>
          <text
            x="280"
            y="34"
            textAnchor="middle"
            fill={muted}
            fontSize="12"
            letterSpacing="2"
          >
            RETRIEVE
          </text>
          <text
            x="461"
            y="34"
            textAnchor="middle"
            fill={muted}
            fontSize="12"
            letterSpacing="2"
          >
            ANALYSE
          </text>
          <rect
            x="33"
            y="65"
            width="136"
            height="184"
            rx="5"
            fill={selected(1)}
            stroke={line}
            className="visual-node"
          />
          <text
            x="52"
            y="94"
            fill={ink}
            fontSize="23"
            fontFamily="var(--serif)"
          >
            EDGAR
          </text>
          {["10-K", "10-Q", "8-K"].map((form, i) => (
            <g key={form}>
              <path d={`M52 ${121 + i * 41}h96`} stroke={line} />
              <text x="54" y={146 + i * 41} fill={ink} fontSize="20">
                {form}
              </text>
            </g>
          ))}
          <rect
            x="211"
            y="94"
            width="139"
            height="126"
            rx="5"
            fill={selected(2)}
            stroke={line}
            className="visual-node"
          />
          <text
            x="280"
            y="130"
            textAnchor="middle"
            fill={ink}
            fontSize="20"
            fontFamily="var(--serif)"
          >
            Stored filings
          </text>
          <path
            d="M231 151h99M231 167h99M231 183h99M231 151v48M267 151v48M302 151v48M330 151v48"
            stroke={line}
          />
          <rect
            x="390"
            y="65"
            width="137"
            height="184"
            rx="5"
            fill={selected(3)}
            stroke={line}
            className="visual-node"
          />
          <text
            x="407"
            y="96"
            fill={ink}
            fontSize="23"
            fontFamily="var(--serif)"
          >
            Research
          </text>
          <path
            d="M408 119h98M408 131h82M408 153h98M408 165h93M408 177h63"
            stroke={line}
            strokeWidth="2"
          />
          <path d="M408 207h80" stroke={accent} strokeWidth="2" />
          <text x="408" y="232" fill={muted} fontSize="13">
            Source links
          </text>
          <text
            x="280"
            y="278"
            textAnchor="middle"
            fill={muted}
            fontSize="13"
            letterSpacing="1"
          >
            ONE QUESTION. THREE FOCUSED TOOLS.
          </text>
        </>
      )}
    </svg>
  );
}
