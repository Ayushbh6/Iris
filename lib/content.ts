export const projects = [
  {
    id: "socrates",
    number: "01",
    name: "Socrates",
    category: "AGENT SYSTEMS",
    subtitle: "Long-running work. Context that carries forward.",
    description:
      "A local-first AI workspace with real tools, structured memory and a traceable history of the work.",
    detail:
      "Socrates brings coding and investigation into a persistent workspace. Conversations, tool runs and project evidence stay connected, so an assistant can pick up a thread without loading the entire past into every prompt.",
    stack: ["TypeScript", "Next.js", "Fastify", "SQLite", "MCP"],
    nodes: [
      "Project request",
      "Tools & evidence",
      "Context compression",
      "Continue the work",
    ],
    status: "Independent project · active development",
    repo: "https://github.com/Ayushbh6/Socrates",
    question:
      "How do you keep an agent useful after the conversation gets long?",
    approach:
      "Treat context as part of the runtime. Keep a compact working state, preserve exact references, and retrieve the earlier evidence when it matters.",
    features: [
      {
        title: "Tools that do real work",
        body: "Shell, file search, patches, Git and MCP integrations operate inside a project workspace. Tool activity streams into the conversation.",
      },
      {
        title: "Memory with a way back",
        body: "A structured CompressorAgent preserves important state and turn references. Trace retrieval can recover the original conversation and tool evidence.",
      },
      {
        title: "A durable local trail",
        body: "SQLite stores conversations, events and run metadata. The Classic workspace supports cancellation and recovery after a restart.",
      },
    ],
    workflow: [
      {
        label: "Start",
        title: "Give the work a home",
        body: "Choose a project and start a conversation. Its files, prior discussions and project guidance provide the working context.",
      },
      {
        label: "Act",
        title: "Use tools, keep the evidence",
        body: "The runtime coordinates model calls and local tools. You can follow their outputs and inspect how the answer was reached.",
      },
      {
        label: "Remember",
        title: "Compress without losing the trail",
        body: "The compressor produces structured context with source anchors. Trace retrieval finds earlier turns when a precise detail is needed again.",
      },
      {
        label: "Continue",
        title: "Pick up the thread",
        body: "Persistent conversations and project memory support continued work. The stable Classic workspace and the experimental V2 work are separate.",
      },
    ],
    takeaway:
      "The engineering focus is continuity: a useful working context backed by retrievable evidence.",
    scope:
      "The public main branch contains the Classic workspace. V2 is a separate work in progress.",
    source:
      "https://github.com/Ayushbh6/Socrates/blob/d956792620f30f45ee8cf1b7f4a195cb89202d66/packages/core/src/agent/CompressorAgent.ts",
    sourceLabel: "Explore the context engine",
  },
  {
    id: "checker",
    number: "02",
    name: "Checker",
    category: "DOCUMENT INTELLIGENCE",
    subtitle: "From contract clauses to reviewable evidence.",
    description:
      "An AI-assisted DPA review workflow: approved criteria, hybrid retrieval and findings you can trace back to the page.",
    detail:
      "Checker helps a reviewer work through data-processing agreements. It separates the criteria to check, the evidence in the documents and the findings to review, keeping a human approval step in the workflow.",
    stack: ["Python", "FastAPI", "Next.js", "PostgreSQL", "pgvector"],
    nodes: [
      "Review documents",
      "Approved criteria",
      "Evidence & findings",
      "Approval pack",
    ],
    status: "Independent demo · public documents",
    repo: "https://github.com/Ayushbh6/DPA_Guru",
    question:
      "Can a reviewer follow an AI finding back to the clause that supports it?",
    approach:
      "Keep the review criteria explicit and approved. Search both the agreement and selected knowledge sources, then return findings with page references and supporting excerpts.",
    features: [
      {
        title: "Criteria before conclusions",
        body: "A criteria agent prepares the checklist. The reviewer can approve the criteria before the document assessment begins.",
      },
      {
        title: "Two ways to find evidence",
        body: "PostgreSQL full-text search and pgvector similarity are combined with reciprocal rank fusion. Tools can fetch exact document pages for closer reading.",
      },
      {
        title: "A pack for the reviewer",
        body: "Separate review and approval-pack agents assemble findings, vendor context and an evidence appendix. The frontend supports review and document export.",
      },
    ],
    workflow: [
      {
        label: "Prepare",
        title: "Collect the review material",
        body: "Create a vendor review with the DPA and supporting documents. Parsing and chunking retain the page locations used later as evidence.",
      },
      {
        label: "Approve",
        title: "Agree on what to check",
        body: "Draft review criteria from the vendor context and selected knowledge sources. A human approves the checklist before the assessment.",
      },
      {
        label: "Review",
        title: "Read, retrieve and substantiate",
        body: "The review agent searches uploaded documents and the knowledge base, fetches exact pages and produces evidence-linked assessments.",
      },
      {
        label: "Decide",
        title: "Bring the findings to a human",
        body: "The approval pack combines review findings with a validated evidence appendix, giving the reviewer the material needed for a decision.",
      },
    ],
    takeaway:
      "The finding is only useful if a reviewer can inspect its criteria and its evidence.",
    scope:
      "Checker is the public-facing name of DPA Guru, an independent demo using public documents.",
    source:
      "https://github.com/Ayushbh6/DPA_Guru/blob/20a28d206e1005e29361d51fcb17b225c045f04d/apps/api/src/upload_api/document_retrieval.py",
    sourceLabel: "Explore the evidence retrieval",
  },
  {
    id: "sec",
    number: "03",
    name: "SEC Summariser",
    category: "FINANCIAL INFORMATION",
    subtitle: "Find the filing. Keep the source. Ask better questions.",
    description:
      "A conversational research app that finds SEC filings, preserves their tables and lets you analyse the stored documents.",
    detail:
      "SEC Summariser connects a financial research question to the underlying EDGAR filings. The assistant can fetch a report, retrieve its stored content or look up its metadata, then continue the analysis in the same conversation.",
    stack: ["TypeScript", "Next.js", "Gemini", "AI SDK", "Supabase"],
    nodes: [
      "Research question",
      "EDGAR filings",
      "Stored content",
      "Conversational analysis",
    ],
    status: "Independent financial research project",
    repo: "https://github.com/Ayushbh6/SEC-Summariser",
    question:
      "How do you get from a company question to the right filing and its actual contents?",
    approach:
      "Separate discovery from reading. Fetch and store a filing once, retrieve its contents for analysis, and use a lighter metadata lookup when only a date or source link is needed.",
    features: [
      {
        title: "Three focused tools",
        body: "researcher discovers and stores filings; content_retriever reads stored documents; get_report_metadata returns dates, form types and source URLs.",
      },
      {
        title: "Structure survives ingestion",
        body: "Company names and tickers resolve to SEC identifiers. HTML is converted to Markdown with a custom table rule, preserving rows and columns for analysis.",
      },
      {
        title: "A reusable research thread",
        body: "Supabase stores filing metadata, document content and conversations. Existing accession numbers are checked per user before a filing is fetched again.",
      },
    ],
    workflow: [
      {
        label: "Ask",
        title: "Start with a research question",
        body: "Specify a company, form type and time range in the conversation—for example, an annual 10-K or quarterly 10-Q filing.",
      },
      {
        label: "Find",
        title: "Fetch from the original source",
        body: "The researcher tool resolves the company, filters SEC filings and stores the report with its accession number and source URL.",
      },
      {
        label: "Read",
        title: "Retrieve the document, tables included",
        body: "The content_retriever tool reads the saved filing. The HTML-to-Markdown conversion keeps table structure available to the model.",
      },
      {
        label: "Analyse",
        title: "Continue with the source at hand",
        body: "Ask follow-up questions in a persistent conversation. A separate metadata tool retrieves report dates and filing links without loading full documents.",
      },
    ],
    takeaway:
      "Discovery, document content and metadata have different jobs—and different retrieval needs.",
    scope:
      "An independent research application built around public SEC filings.",
    source:
      "https://github.com/Ayushbh6/SEC-Summariser/blob/a89c7489dbbbede1297209543b4ec640c83fba4a/src/app/api/chat/route.ts",
    sourceLabel: "Explore the three-tool agent",
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
