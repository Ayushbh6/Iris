export const projects = [
  {
    id: "socrates",
    number: "01",
    name: "Socrates",
    category: "AGENT SYSTEMS",
    subtitle: "A workspace for thinking with AI.",
    description:
      "Exploring how agents discover capabilities, retain context and carry work across sessions.",
    detail:
      "A personal agent-system project focused on the relationship between tools, memory and a persistent workspace. The central design question: how can an assistant keep useful context without carrying everything into every interaction?",
    stack: ["Agent architecture", "Memory", "Tool orchestration"],
    nodes: ["Your request", "Agent runtime", "Memory & tools", "Workspace"],
    status: "Independent project · active development",
  },
  {
    id: "checker",
    number: "02",
    name: "Checker",
    category: "DOCUMENT INTELLIGENCE",
    subtitle: "From documents to traceable decisions.",
    description:
      "An independent public-document demo with evidence-grounded review and human approval.",
    detail:
      "Checker explores a review workflow in which findings remain connected to supporting document evidence. Human review is part of the workflow. This is an independent demo using public documents, not a client deployment or a claim of measured client results.",
    stack: ["Document review", "Evidence retrieval", "Human approval"],
    nodes: [
      "Public documents",
      "Evidence retrieval",
      "Review findings",
      "Human approval",
    ],
    status: "Independent demo · public documents",
  },
  {
    id: "sec",
    number: "03",
    name: "SEC Summariser",
    category: "FINANCIAL INFORMATION",
    subtitle: "Making financial information navigable.",
    description:
      "A financial-document summarisation project connecting quantitative interests with applied AI.",
    detail:
      "A selected personal project in financial-document summarisation. A detailed source-code and outcome audit is still required before publishing specific implementation or performance claims.",
    stack: ["Financial documents", "Applied AI", "Summarisation"],
    nodes: [
      "Financial document",
      "Document processing",
      "Summary",
      "Source review",
    ],
    status: "Personal project · detailed case study in preparation",
  },
] as const;
export const experience = [
  [
    "2026 — PRESENT",
    "Erste Group",
    "Operational Risk Intern",
    "Python and SQL workflows, operational-risk reporting and automation.",
  ],
  [
    "2025",
    "ITG",
    "AI Developer",
    "Text-to-SQL agentic harnesses with built-in verification, RAG and multi-agent systems.",
  ],
  [
    "2023 — 2024",
    "Deloitte Austria",
    "Financial Advisory",
    "Credit-risk modelling, PD / LGD / ECL and analytical automation.",
  ],
  [
    "2020 — 2022",
    "EY Bengaluru",
    "Business Consulting",
    "Controls, business processes and inventory-related work.",
  ],
];
export type ProjectId = (typeof projects)[number]["id"];
