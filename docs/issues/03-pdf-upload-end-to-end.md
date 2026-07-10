# 03 — PDF upload end-to-end (AFK)

## What to build

Attaching a PDF via the paperclip's "Upload file" option stores it server-side, binds
it to the current chat tree (**one PDF per chat tree**, ADR-0002 — a second attach
prompts to start a new tree), and switches the app to the three-column view where the
PDF renders (pdf.js) with zoom controls. No highlights yet. Backend brings the minimal
papers schema/routes from Syflo — without the Marker parsing pipeline (PRD non-goal).

## Acceptance criteria

- [ ] Uploading a PDF in a chat opens the three-column view with the rendered PDF
- [ ] Reloading the app restores the PDF for that chat tree
- [ ] Attaching a second PDF to the same tree is rejected with the new-tree prompt
- [ ] Layout matches the approved `design/mockup-pdf-layout.html`

## Blocked by

- 01-pdf-layout-mockup.md (approved mockup)
