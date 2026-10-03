# Ayush Bhattacharya — public profile

Knowledge version: v1 draft, 1 October 2026. Source: one-page AI and Risk CVs dated 1 October 2026, `resumes/source/projects.json`, `website/lib/content.ts`. Everything here is approved for the agent to say. Anything not here, the agent does not know.

## In one line

AI engineer with quantitative-finance roots who builds reliable LLM systems for regulated environments — banking risk and pharmaceutical compliance — with a focus on traceability, evaluation and real users.

## Positioning

- Two strengths in one person: applied AI engineering (agents, RAG, evaluation) and banking risk (credit and operational risk, regulatory calculations).
- Builds things that are actually used: deployed Databricks apps at Erste, a live pilot with 10–15 reviewers for ALIGNIA.
- Cares about reliability: evidence-linked findings, human review, evaluation harnesses, auditable workflows.
- Target roles: AI engineer / applied AI, agentic systems, document intelligence, and risk analytics or automation roles that combine finance and AI.
- Based in Vienna, Austria. Open to full-time roles.

## Experience

### Erste Group Bank AG — Operational Risk Intern
Vienna · January 2026 – present (current role)
- Builds and operates AI agents and data applications for the Operational Risk team.
- Owns two deployed Databricks Apps and administers the team's Databricks workspace (Unity Catalog-governed data, serverless compute, data pipelines). Go-to contact in the team for loss-data queries.
- Built a scheduled AI agent that monitors the NFR decisions inbox, turns about 50–100 unstructured email threads per quarter into structured records and auto-populates the team's decision log, removing manual data entry.
- Built a one-click large-loss review: checks 5–60 flagged loss events daily against sub-loss and threshold rules, filters out up to half as false positives, and returns checked results in about a minute instead of a manual ID-by-ID review.
- Built Agent Bricks-based agents for loss-event analysis, summarisation and classification.
- Built a monthly operational-risk dashboard and data pipeline tracking risk materialisation across business areas for KPI oversight.
- Supports operational-risk capital model (AMA) execution and stress testing, quantifying capital and risk-weighted-asset (RWA) impacts of entity-level scenarios.

### AI by DNA — Lead AI Developer
Remote · May 2025 – December 2025 (completed)
- Built ALIGNIA, an AI compliance-review platform for pharmaceutical promotional material, from concept to a live pilot with 10–15 reviewers at a European pharmaceutical company.
- Owned architecture, implementation and delivery; reported directly to the CEO.
- Designed RAG and LLM pipelines for claim extraction, evidence retrieval, reference verification, human review, version tracking and exportable reports — every finding traceable to its source.
- Led three interns for about six months; iterated on the system from pilot feedback.
- Stack: Python, FastAPI, Next.js, multi-agent document processing.

### Integration Technologies Group (ITG) — AI Developer
Fairfax, Virginia (remote) · January 2025 – May 2025
- Delivered a text-to-SQL agent with an agentic harness and built-in verification checks. ITG client testers reported that the same model improved from roughly 60–70% intent-to-SQL accuracy with one-shot prompting to over 95% with the harness. The figures are client-user test feedback relayed by Ayush, not a new independently audited benchmark or general accuracy guarantee; test-set size and protocol are not documented here.
- Built multi-agent and RAG applications for financial and compliance workflows.
- Built Python / FastAPI services for integration.

### Deloitte Austria — Analyst, Financial Advisory
Vienna · October 2023 – December 2024 (summer intern July – September 2023)
- Produced recurring expected-credit-loss (ECL) calculations in SAS, combining PD, LGD and EAD inputs for credit-risk reporting.
- Migrated an existing probability-of-default model from SAS to R, translating the logic and reconciling outputs against the SAS version.
- Updated inputs and ran established credit-risk models, including macroeconomic PD models; contributed to macro-variable selection and model comparison (AUC, AIC, BIC).
- Automated financial-data processing in Python.

### Ernst & Young LLP — Senior Analyst, Business Consulting
Bengaluru, India · October 2020 – June 2022
- SOX and internal financial controls (IFC) audits, on-site inventory reconciliations, and support for an asset-management implementation at a pharmaceutical client.

## Projects

### Socrates — AI workspace for long-running agent work
- Local-first AI workspace for coding and investigation: orchestration, tool execution, MCP servers, persistent memory and structured context compression.
- Dedicated evaluation harnesses for compression, retrieval, memory routing and cost.
- Central question: how can an assistant keep useful context across sessions without carrying everything into every interaction?
- Stack: TypeScript, Next.js, Fastify, SQLite.
- Why it matters to him: Socrates is Ayush's favourite project and a personal dream — building his own "perfect" agent harness that feels truly personal and seamless to use.
- Status: independent project in active development (V2 in progress).
- Link: https://github.com/Ayushbh6/Socrates

### Checker (formerly DPA Guru) — AI contract-risk review
- AI-assisted review of data-processing agreements against approved criteria.
- Document ingestion, hybrid semantic + keyword retrieval (pgvector), page-level source references, human approval in the loop.
- Independent demo using public documents — not a client deployment.
- Stack: Python, Next.js, PostgreSQL, pgvector.
- Link: https://github.com/Ayushbh6/DPA_Guru

### SEC Summariser — financial filing analysis
- AI research app that retrieves SEC filings by company, filing type and date range.
- Filing ingestion, table-preserving document conversion, stored-content retrieval and conversational analysis.
- Stack: TypeScript, Next.js, Supabase, PostgreSQL, Gemini.
- Link: https://github.com/Ayushbh6/SEC-Summariser

### This website
- The conversational agent itself is a project: a real-time voice agent with generative UI, built by Ayush.

## Skills

- Agents & LLMs: LangGraph, LangChain, LlamaIndex, Agent Bricks, MCP, tool calling, multi-agent workflows, human-in-the-loop, context engineering.
- Retrieval & evaluation: RAG, hybrid search, reranking, pgvector, Pinecone, FAISS, evaluation harnesses, memory systems.
- Engineering: Python, FastAPI, SQL / PostgreSQL, Databricks (Unity Catalog), Docker, Git, REST APIs, TypeScript, Next.js.
- Models & cloud: OpenAI API, Gemini API, Azure Web Apps, Databricks Apps, serverless compute.
- Risk: ECL / IFRS 9 inputs (PD, LGD, EAD), PD model migration and reconciliation, model comparison (AUC, AIC, BIC), operational-risk loss data, stress testing, capital and RWA, SOX / internal controls.
- Also: R, SAS, Excel, pandas, NumPy, GitHub Copilot in VS Code; experienced with coding agents.

## Education

- MSc Quantitative Finance — Vienna University of Economics and Business (WU Vienna), September 2022 – November 2024 (completed).
- BSc Economics, Mathematics and Statistics — Christ University, Bengaluru, June 2017 – June 2020.
- Certification: Advanced Credit Risk Management — TU Delft.
- Only if asked about current studies: also enrolled in an MSc Data Science at TU Wien since autumn 2025, alongside work.

## Languages

English (professional), German (A2, actively learning), Hindi and Bengali (native).

## Outside work

- Grappling: Brazilian jiu-jitsu and Luta Livre; also kickboxing and strength training.
- Goes for runs.
- Loves trying new food, and cooks.
- Plays the guitar, though he hasn't picked it up in a while.
- Favourite colour: violet / purple.

## Contact

- Email: bhatt.ayush.1998@gmail.com
- LinkedIn: https://www.linkedin.com/in/ayush-bhattacharya-ba09b6162
- GitHub: https://github.com/Ayushbh6
- CV: downloadable on the site.
