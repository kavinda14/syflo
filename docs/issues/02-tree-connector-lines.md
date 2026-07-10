# 02 — Chat tree connector lines in the left sidebar (AFK)

## What to build

The chat tree in the left sidebar shows its hierarchy with connector lines instead of
indentation alone: a vertical trunk under each parent, a horizontal elbow into every
child row, and a clean trunk termination after the last sibling. Design source of
truth: the tree-list CSS in `design/mockup-paper-view.html`; behavioral reference:
Syflo's `BranchTreeNode`. Existing tree behavior (select, rename, context menu,
expand/collapse) is unchanged.

## Acceptance criteria

- [ ] Nested branches show trunk + elbow lines; root-level chats show none
- [ ] Trunk ends at the last child of each parent (no dangling line)
- [ ] Collapsing a parent hides its children's lines
- [ ] All existing ChatTree tests still pass; new tests cover the three line behaviors

## Blocked by

None - can start immediately
