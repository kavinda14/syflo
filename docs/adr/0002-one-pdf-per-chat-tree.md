# One PDF per chat tree

Status: accepted (2026-07-10)

A chat tree has at most one attached PDF. This keeps the ported Syflo data model
unchanged (chats carry a `paper_id`; highlights hang off the paper) and keeps the port a
copy rather than a redesign. Attaching a second PDF prompts the user to start a new chat
tree instead. We chose this over a multi-PDF model with a viewer switcher because
loosening the constraint later (one → many) is a cheap additive change, while tightening
it (many → one) would be a painful data migration.
