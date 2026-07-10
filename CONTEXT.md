# FlowTalk

General-purpose branching-chat app: one conversation can branch into a tree of focused
sub-chats, navigable as a mind map. Distinct from **Syflo**, its research-focused sibling
product, which serves as the source of ported features.

## Language

**Branch**:
A sub-chat spun off from a word or selection in a parent chat. Branches form the chat tree.
_Avoid_: sub-conversation, thread, fork

**Chat tree**:
The hierarchy of a root chat and all its branches, shown in the left sidebar with
connector lines (trunk + elbows).
_Avoid_: chat list, history

**Highlight**:
A colored, persistent marking of a text passage in an uploaded PDF, created via the
right-click menu. Five colors: yellow, green, blue, pink, orange.
_Avoid_: annotation, marking, Markierung

**Color label**:
A user-editable name attached to one of the five highlight colors (e.g. "Important",
"Question"), renamed inline in the right-click menu.
_Avoid_: tag, category

**Paper search**:
Searching external indices for a research paper from the paperclip menu and attaching
the found paper's PDF to the current chat.
_Avoid_: import, fetch

**Availability**:
A paper-search result's PDF status: *open* (importable), *manual* (a free copy exists
but its host blocks automated download), *paywalled* (no free copy; only a publisher
link is offered).
_Avoid_: access status, lock state

**Web search**:
A tool call the chat model makes against the local SearXNG instance to pull live web
results into the conversation. Not related to Paper search.
_Avoid_: search (unqualified), SearXNG search

**Syflo**:
The separate, research-focused sibling product (own repo, own roadmap). FlowTalk ports
selected features from it but does not track it.
_Avoid_: SciFlow, Ciflow (voice-transcript artifacts)
