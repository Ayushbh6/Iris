# Project content evidence

Reviewed 3 October 2026 against the public GitHub main branches. This is a source review, not a claim that the three applications were deployed or benchmarked during this task. Their checkouts are outside the published files, under ignored `.local/`.

## Socrates

Snapshot: [`d956792`](https://github.com/Ayushbh6/Socrates/tree/d956792620f30f45ee8cf1b7f4a195cb89202d66).

- [README](https://github.com/Ayushbh6/Socrates/blob/d956792620f30f45ee8cf1b7f4a195cb89202d66/README.md): local-first workspace; Classic is the stable product, experimental V2/Flow is distinct; cancellation/restart recovery and SQLite persistence.
- [CompressorAgent](https://github.com/Ayushbh6/Socrates/blob/d956792620f30f45ee8cf1b7f4a195cb89202d66/packages/core/src/agent/CompressorAgent.ts): structured compaction, schema validation, anchor checks and repair, deterministic carryover.
- [Trace retrieval](https://github.com/Ayushbh6/Socrates/blob/d956792620f30f45ee8cf1b7f4a195cb89202d66/packages/core/src/tools/traceRetrieveTool.ts): lexical, semantic, combined and audit retrieval with turn references.
- [Tool implementations](https://github.com/Ayushbh6/Socrates/tree/d956792620f30f45ee8cf1b7f4a195cb89202d66/packages/core/src/tools): shell, patches, project documents, memory and MCP registry.

## Checker / DPA Guru

Snapshot: [`20a28d2`](https://github.com/Ayushbh6/DPA_Guru/tree/20a28d206e1005e29361d51fcb17b225c045f04d).

- [Agent registry](https://github.com/Ayushbh6/DPA_Guru/blob/20a28d206e1005e29361d51fcb17b225c045f04d/apps/api/src/upload_api/agents/registry.py): distinct criteria, research, review, approval-pack and copilot prompts/runtime configurations.
- [Document retrieval](https://github.com/Ayushbh6/DPA_Guru/blob/20a28d206e1005e29361d51fcb17b225c045f04d/apps/api/src/upload_api/document_retrieval.py): pgvector and full-text ranks fused with RRF, page-aware chunks and quote-to-page matching.
- [API routes](https://github.com/Ayushbh6/DPA_Guru/blob/20a28d206e1005e29361d51fcb17b225c045f04d/apps/api/src/upload_api/main.py): approved-criteria/checklist endpoints.
- [Review tools](https://github.com/Ayushbh6/DPA_Guru/blob/20a28d206e1005e29361d51fcb17b225c045f04d/apps/api/src/upload_api/agents/tools/review_tools.py): document/KB search and exact-page retrieval.
- [Approval pack tools](https://github.com/Ayushbh6/DPA_Guru/blob/20a28d206e1005e29361d51fcb17b225c045f04d/apps/api/src/upload_api/agents/tools/approval_pack_tools.py): vendor context, validated findings and evidence appendix.
- [Document export](https://github.com/Ayushbh6/DPA_Guru/blob/20a28d206e1005e29361d51fcb17b225c045f04d/apps/web/src/lib/docxExport.ts).

The independent public-document demo scope comes from the owner's approved profile. No client deployment or legal accuracy metric is claimed.

## SEC Summariser

Snapshot: [`a89c748`](https://github.com/Ayushbh6/SEC-Summariser/tree/a89c7489dbbbede1297209543b4ec640c83fba4a).

- [Chat route](https://github.com/Ayushbh6/SEC-Summariser/blob/a89c7489dbbbede1297209543b4ec640c83fba4a/src/app/api/chat/route.ts): three tools (`researcher`, `content_retriever`, `get_report_metadata`), authenticated Supabase user lookup, user-scoped filing queries and accession-number duplicate checks. The README's two-tool/10-step description is stale; implementation has three tools and a 20-step limit.
- [SEC API](https://github.com/Ayushbh6/SEC-Summariser/blob/a89c7489dbbbede1297209543b4ec640c83fba4a/src/lib/sec_api.ts): company lookup, filing/date filters, SEC requests and table-preserving HTML-to-Markdown conversion.
- [Conversations](https://github.com/Ayushbh6/SEC-Summariser/blob/a89c7489dbbbede1297209543b4ec640c83fba4a/src/lib/conversations.ts): stored threads and messages.

Omitted unverified README claims: Lighthouse/performance scores, enterprise-grade security, production readiness, current deployment status and configured database RLS guarantees.

## Presentation

`lib/content.ts` contains the curated narrative, stack, step descriptions and pinned source links. `knowledge/profile.md` teaches the same verified facts to Iris. `ProjectCaseStudy` presents each project as an interactive four-step walkthrough. `ProjectVisual` contains original SVG workflow illustrations; they are explicitly labelled as illustrations, not screenshots of a running application. Landing previews and assistant project blocks reuse the same artwork.
