# 06 — Branch from a PDF selection + linked highlight (AFK)

## What to build

"Open as new chat" in the PDF popup creates a branch in the chat tree anchored to the
selected text, and saves a highlight (active color) linked to that branch. Clicking an
existing highlight opens the highlight actions menu: recolor, delete, open linked chat.
Link semantics ported unchanged: the highlight's chat link is optional and set to NULL
when the branch is deleted — the highlight itself survives.

## Acceptance criteria

- [ ] Branching from a PDF selection creates both the branch (visible in the left tree)
      and the linked highlight
- [ ] Highlight actions menu offers recolor / delete / open linked chat
- [ ] Deleting the branch keeps the highlight, unlinked
- [ ] The AI definition in the popup uses text surrounding the selection as context

## Blocked by

- 04-pdf-highlights-zoom-safe.md
