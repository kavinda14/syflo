# 07 — Paper search from the plus menu (AFK)

## What to build

The plus menu gains a **"Research paper"** option opening a centered search modal
(`design/mockup-pdf-layout.html` sections 02+03). Search queries OpenAlex + arXiv in
parallel, merges and dedupes (DOI, normalized title), with Semantic Scholar as
outage fallback (PRD feature 4). Each result carries an availability state:
**open** (direct import), **manual** (free copy exists but the host blocks
download — "Open source page" link + hint), **paywalled** (Lock badge + "View
publisher" link). Importing downloads the PDF server-side (`POST
/api/papers/from-url`, no Marker), binds it to the current chat tree (ADR-0002 —
a tree that already has a PDF gets the new-tree prompt) and switches to the
three-column view. `blockedHosts` logic and its tests come along unchanged.

## Acceptance criteria

- [ ] "Research paper" in the plus menu opens the search modal (mockup section 03)
- [ ] Results show the three availability states with the mockup's badges/actions
- [ ] Importing an open-access result attaches the PDF to the current tree and
      opens the three-column view; a second import prompts for a new tree
- [ ] Search merges OpenAlex + arXiv (dedup via DOI/title), falls back to
      Semantic Scholar only when both primaries fail — covered by route tests
- [ ] `blockedHosts` ported with its tests

## Blocked by

- 03-pdf-upload-end-to-end.md
