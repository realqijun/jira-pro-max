# Project Management

A project-management workspace for a single project manager (PM), built as the structured foundation for a future AI "project intelligence" layer (health briefings, dependency and risk detection). The base app records project state; the future AI layer reads and proposes changes to it.

## Language

### Structure

**Project**:
A bounded piece of work a PM manages, with its own tasks, milestones, risks and evidence.
_Avoid_: Workstream, initiative, board

**Task**:
A unit of work inside a Project with an owner, status and dates.
_Avoid_: Issue, ticket, card, to-do

**Milestone**:
A dated checkpoint in a Project that Tasks roll up to (e.g. "UAT begins").
_Avoid_: Phase, deadline, gate

**Dependency**:
A directed relationship stating one item cannot proceed until another is done.
_Avoid_: Blocker (see Risk), link, relation

**Status**:
A named state an item (Task, Milestone, Risk, Project) can be in. Statuses are defined per Project and each maps to one fixed Status Category.
_Avoid_: State, stage, column

**Status Category**:
The fixed, system-defined meaning behind a Status (e.g. for Tasks: not started, in progress, blocked, done, cancelled). Users rename and add Statuses; they cannot add Categories.
_Avoid_: Status type, workflow

### People

**Person**:
Someone who owns or does work in one Project (team member, vendor contact, stakeholder). Defined per Project; may or may not be linked to a User account.
_Avoid_: Assignee, member, resource, contact

**Team**:
A named group of People within one Project (e.g. "Team B", "Vendor Acme") that can own work collectively.
_Avoid_: Group, squad, department

**Label**:
A per-Project free-form tag applied to Tasks and Evidence for filtering.
_Avoid_: Tag, category

**User**:
An account that can sign in. Owns Projects. Distinct from Person.
_Avoid_: Account, login

### History

**Activity Event**:
An immutable record that a specific field of a specific item changed, from what to what, by whom, when.
_Avoid_: Audit log entry, history, change, revision

### Risk

**Risk**:
A recorded possibility that something may go wrong for a Project, with probability, impact and an owner.
_Avoid_: Issue, blocker, concern

**Risk Register**:
The list of all Risks in a Project.

### Evidence

**Evidence**:
A source artifact attached to a Project (plan, minutes, transcript, status update, export) from which project facts may be derived. A transcript is stored as ordered Passages as well as its full text. The full text is `extractedText`; `prunedText` holds the compressed copy for the AI layer when a text compressor responds, else the original text.
_Avoid_: Document, file, attachment, upload

**Passage**:
One ordered part of a transcript: its text, plus the speaker and timestamp when the transcript has them. A Source may cite a Passage instead of the whole Evidence; when the Passage is gone, the Source degrades to the whole Evidence.
_Avoid_: Chunk, snippet, segment (as a noun), quote

### Decision Memory

**Decision**:
A recorded choice made on a Project at a point in time: its title, date, owner (a Person), status (active, superseded, revisited), the context at the time, what was chosen, the alternatives rejected and why, and an optional revisit-when trigger. It rests on zero or more Assumptions, cites at least one Source, and may supersede an earlier Decision. Its history is its Activity Events.
_Avoid_: Choice, ADR, resolution, verdict, issue

**Assumption**:
A condition a Decision rests on, which the Project can later contradict; unlike a Risk (a possibility of harm) it is a belief the Decision depends on. Its subtype names what can invalidate it: date (a Milestone or Task date), person (a Person staying on the Project), dependency (an existing Dependency) or external-rule (a condition outside the Project, stated in words). It is holding, broken or retired.
_Avoid_: Premise, precondition, constraint, hypothesis, risk

**Source**:
A citation from a Decision or an edge to something already in the Project history: an Evidence item, a Comment or an Activity Event, optionally narrowed to one Passage of the Evidence.
_Avoid_: Reference, link (see Dependency and Evidence link), attachment, footnote

**Proposal**:
A Decision the Assistant extracted from Evidence or a Comment and offers to the PM for confirmation, with the Sources it came from and any typed Assumptions it suggests. It is pending, accepted or rejected; nothing enters the graph until a PM accepts it.
_Avoid_: Suggestion, draft decision, candidate, recommendation

**Cause**, **Consequence**:
The two directions of an edge between a Decision, an Assumption and the items they touch: what led to a record sits on its cause side, what follows from it on its consequence side. Not node types.
_Avoid_: Reason, effect, outcome, impact node

### Discussion

**Comment**:
A short, plain-text, dated statement attached to one Task, Risk or Milestone, optionally attributed to the Person who said it ("said by") and dated to when it was said ("said on"). Immutable once posted; may be deleted, in which case the item's history keeps the body.
_Avoid_: Message, note, remark, update

**Room**:
A place inside one Project where the PM and the People they admit exchange Chat Messages. Either a group Room, which has a name and many Participants, or a one-to-one Room between the PM and a single Person. Always scoped to one Project.
_Avoid_: Channel, chat, thread, conversation

**Participant**:
A Person admitted to a Room by the PM. Admission is the only way into a Room; a Person cannot join one themselves.
_Avoid_: Member, user, recipient, attendee

**Chat Message**:
One plain-text entry in a Room, optionally carrying a single media attachment. Attributed to the PM or to the Participant who wrote it, by a name captured at the time of writing. Never edited and never deleted.
_Avoid_: Message (that is an Assistant turn), post, chat, DM

**Invite**:
A single-use link the PM generates for one Person, by which that Person sets a password and gains a messaging-only login to that Project. Expires after seven days, is superseded by the next Invite for the same Person, and is stored only as a hash.
_Avoid_: Invitation email, magic link, signup link, token

### Renders

**Render**:
A generated picture of what a Project delivers, made from a description the PM writes by hand, so the PM and the people building the thing can react to one image instead of a paragraph each. It is pending, ready or failed, and it carries the exact description, model and seed it was produced from.
A Render illustrates intent. It is not a drawing, is not to scale, and never enters a build package.
_Avoid_: Image, mockup, visualisation, drawing, rendering (the verb)

### Assistant

**Assistant**:
The in-app agent a User converses with. It reads a Project through the same read models as the UI and changes it through the same services, acting on behalf of the User; every change it makes is an Activity Event marked as made via the Assistant.
_Avoid_: Chatbot, bot, copilot, AI

**Conversation**:
The stored thread of Messages between one User and the Assistant about one Project (or, on the dashboard, about no Project).
_Avoid_: Chat, thread, session

**Message**:
One turn in a Conversation: from the User, or from the Assistant (text plus any tool calls it made).
A Message is always an Assistant turn; what People send each other in a Room is a **Chat Message**, a separate concept under Discussion.
_Avoid_: Prompt, reply, chat message

**Profile**:
A User's own Markdown description of how they work (tone, cadence, defaults, preferences). One per User, slow-changing, editable by the User and revised by Reflection. Every version is kept.
_Avoid_: user.md, persona, settings

**Working Memory**:
The Assistant's Markdown notes on one User's situation in one Project (current priorities, recurring People, recent decisions). One per User per Project, fast-changing, editable by the User and revised by Reflection. Every version is kept.
_Avoid_: context.md, memory file, notes, scratchpad

**Reflection**:
A background pass, run after an Assistant turn, that reads the recent Conversation and the changes made and rewrites the Profile and Working Memory. Must preserve what the User wrote.
_Avoid_: Learning, training, background agent
