# 05 — Renamable color labels (AFK)

## What to build

Each highlight color carries a user-editable **color label** (e.g. "Important"),
renamed inline in the floating popup via the pencil icon (edit mode), persisted
server-side, and shown under each swatch. 1:1 port of Syflo's `useLabels` flow and
label endpoints.

## Acceptance criteria

- [ ] Renaming a color's label in the popup persists across reload
- [ ] Swatch rows show the label under each color; reset-to-default works per row
- [ ] Edit mode matches `design/mockup-popup-edit-labels.html` (edit state)

## Blocked by

- 04-pdf-highlights-zoom-safe.md
