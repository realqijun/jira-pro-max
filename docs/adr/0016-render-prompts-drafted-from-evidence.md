---
status: accepted
---

# A Render description may be drafted from Evidence, and only the approved description is sent

ADR 0012 kept Project data out of every Render prompt: the PM typed a sentence, and only that sentence left for the image provider.
PMs asked to start from what they already have instead, such as a brief, site notes or a meeting transcript.
Issue #117 lets the PM draft the description from up to three pieces of Evidence.
This ADR supersedes the "Only what the PM typed is sent" section of ADR 0012; the rest of ADR 0012 stands.

## The rule is "only what the PM approved is sent"

The PM ticks Evidence in the Renders form, optionally adds a few words, and clicks **Draft from Evidence**.
A server action returns a condensed description into the editable textarea.
The PM edits it and clicks **Generate**, which calls the existing `rendersService.request` with that text and the Evidence ids.

The image provider still receives exactly one string: the approved description plus the style suffix.
The Evidence ids are provenance and are never read into the prompt.
A service test and the Playwright spec both assert that the provider sees `promptSentFor(approved)` and none of the Evidence text or titles.
`safe=privacy,secrets` stays on as a backstop.

## The User's own Assistant model drafts

The draft runs on the model the User configured for their Assistant (ADR 0011), not on the free image provider.
That model already reads this Evidence for the Assistant and the Proposal pass, so drafting sends it nowhere new.
The free image service only ever sees text a human has read and approved.

The cost is that drafting needs an Assistant model.
Without one, the picker is disabled with a one-line explanation, and hand-typed Renders work exactly as before.
An unreadable saved credential counts as no model, so the page does not fail.

## Bounded input, fenced as data

At most `RENDER_EVIDENCE_MAX = 3` pieces of Evidence, enforced by the validation schema and again by the service, which also checks that every id belongs to the Project.
A foreign or missing id reads as not found, so an id from another Project is not confirmed to exist.
Each text is cut to 6,000 characters.

The draft reads `prunedText`, else `extractedText`, else the pasted `body`.
The ticket named only the first two; `body` is the fallback because migration 0020 added `pruned_text` without a backfill, so older pasted Evidence has only a body.
Evidence with no text at all is not offered, and a request that names one is refused.

The sources are fenced as data, the system prompt tells the model never to follow instructions inside them, and it asks for a visual description without names, contact details, prices, dates or ids.
That instruction is advice to the model, not a control: the control is that the PM reviews the text before anything is sent.
The answer is collapsed to one paragraph and cut to `RENDER_PROMPT_MAX` at a word boundary; `maxOutputTokens` stops a runaway answer at the provider.

## Provenance is a snapshot, not a foreign key

`renders.evidence` is a jsonb array of `{ evidenceId, title }`, taken when the Render is requested.
With no foreign key, the card still says "Drafted from: ..." after the Evidence is renamed or deleted.
The ids that go with Generate are the ones the last successful draft read, not the current ticks.
Edits keep them, because editing the draft is the intended flow.
The form shows "Drafted from: ..." under the description with a Remove control, and clearing the description drops them too, so the PM decides when a rewritten description stops being attributed to Evidence.
The attribution is therefore the PM's claim, not a server-verified fact: `request` checks that each id is Evidence in the same Project and within the cap, not that a draft read it.

## No eval suite

The draft is a subjective description that a human always edits, so there is no right answer to grade against, unlike Decision extraction.
It is covered by unit tests with a fake drafter and a mock model: fencing, the 6,000-character cut, the output cap, refusals, and that nothing is written.

## Consequences

- An approved description may still carry Project facts the PM chose to keep; "approved" means the PM saw them, not that there are none.
- Drafting writes no row and no Activity Event; only Generate does, as before.
- `render_requested` gains `evidence_count`, and the draft call is traced under a new `render_draft` span with `project_id` and `evidence_count` only.
- The image provider's base URL can be overridden (`POLLINATIONS_BASE_URL`) so the e2e suite can stub it; nothing else reads it.
- There is no Assistant tool for drafting in this version; the entry point is the Renders form only.
