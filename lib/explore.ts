import { experience, projects } from "./content";
import type { RenderView } from "./agent/render";

// Stored pages for the sidebar. They are RenderViews, so they look exactly like
// the views the assistant composes, and opening one costs nothing.

export const EXPLORE_ITEMS = [
  {
    id: "socrates",
    label: "Socrates",
    number: "01",
    event: "the Socrates project page",
  },
  {
    id: "checker",
    label: "Checker",
    number: "02",
    event: "the Checker project page",
  },
  {
    id: "sec_summariser",
    label: "SEC Summariser",
    number: "03",
    event: "the SEC Summariser project page",
  },
  {
    id: "experience",
    label: "Experience",
    number: "04",
    event: "the Experience page",
  },
] as const;
export type ExploreId = (typeof EXPLORE_ITEMS)[number]["id"];

const REPOS = {
  socrates: "socrates_repo",
  checker: "checker_repo",
  sec_summariser: "sec_repo",
} as const;

export function exploreView(id: ExploreId): RenderView {
  if (id === "experience")
    return {
      title: "From quantitative roots to applied AI",
      layout: "stack",
      blocks: [
        {
          kind: "timeline",
          entries: experience.map(([period, org, title, note]) => ({
            period,
            org,
            title,
            note,
          })),
        },
        { kind: "links", links: ["cv", "linkedin"] },
      ],
    };
  const project = projects.find(
    (p) => p.id === (id === "sec_summariser" ? "sec" : id),
  )!;
  return {
    title: "Selected work",
    layout: "stack",
    blocks: [
      { kind: "project", project: id },
      { kind: "flow", heading: "Conceptual flow", steps: [...project.nodes] },
      { kind: "links", links: [REPOS[id]] },
    ],
  };
}

export const explore = {
  label: (id: ExploreId) => EXPLORE_ITEMS.find((i) => i.id === id)!.label,
  event: (id: ExploreId) => EXPLORE_ITEMS.find((i) => i.id === id)!.event,
};
