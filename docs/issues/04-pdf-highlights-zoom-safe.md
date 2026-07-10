# 04 — PDF highlights, zoom-safe, end-to-end (AFK)

## What to build

Right-clicking a text selection in the PDF opens the floating popup with the five
highlight color swatches; picking one persists a highlight (multi-rect, server-side)
that renders correctly **at every zoom level**. The port fixes Syflo's known bug: rect
positions were normalized by zoom but width/height were not, so highlights were only
correctly sized at their creation zoom. All four rect values are normalized here.

## Acceptance criteria

- [ ] Highlight created at one zoom renders with correct geometry at other zooms —
      covered by a regression test (create at zoom A, assert at zoom B)
- [ ] Highlights survive reload
- [ ] Popup visuals match `design/mockup-popup-edit-labels.html` (picker state)
- [ ] Deleting a highlight never deletes any chat (link is optional)

## Blocked by

- 03-pdf-upload-end-to-end.md
