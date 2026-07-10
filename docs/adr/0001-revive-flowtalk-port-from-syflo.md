# Revive flowtalk as the active repo; port features back from syflo

Status: accepted (2026-07-02)

In May 2026 the project pivoted from FlowTalk (general branching-chat app) to Syflo
(research-paper exploration tool) by copying the code into `/Users/kavisenewiratne/syflo/`,
leaving this repo frozen at the pre-fork state. Syflo turned out to be too narrowly focused
on the research community, so this repo becomes the active home of the general-purpose
product **FlowTalk** again. Selected Syflo features are ported back here rather than
developed fresh: the PDF viewer with right-click color highlighting (fixing the
width/height-not-normalized-by-zoom bug in syflo's `PdfView.tsx` during the port) and the
branch-tree connector-line design from syflo's `PaperView.tsx` `BranchTreeNode`.

## Considered Options

- **Strip syflo down instead of reviving flowtalk** — rejected because Syflo continues to
  live as its own research-focused product; it cannot be cannibalized.
- **One repo serving both products** — rejected: the product identities (general chat vs.
  paper exploration) are expected to diverge further.

## Consequences

- **Two products are maintained in parallel** (syflo stays active for research use). Shared
  components (`Sidebar/ChatTree.tsx`, `useVoiceInput.ts` — byte-identical today) will drift;
  fixes must be applied twice or consciously dropped on one side.
- flowtalk misses all syflo-era infrastructure (pdfjs-dist/katex deps, highlight backend
  endpoints); ports must bring their dependencies and backend routes along.
- `docs/PRD.md` in this repo is a stale copy of the *Syflo* PRD and must be rewritten for
  FlowTalk.
