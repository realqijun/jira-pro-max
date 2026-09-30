# Milestone 20 - Product Hunt launch

We prepared the launch as if submitting today, and have not launched for real: the analytics in M19 show a small tester audience, and we want the model error rate fixed and a production-only PostHog project in place first, so launch-day data is readable.

## Listing

| Field        | Content                                                                         |
| ------------ | ------------------------------------------------------------------------------- |
| Name         | PrismPM                                                                         |
| Tagline (60) | Project management that remembers why you decided                               |
| Link         | https://jira-pro-max.vercel.app                                                 |
| Topics       | Productivity, Project Management, Artificial Intelligence, Meetings             |
| Pricing      | Free (research preview)                                                         |
| Thumbnail    | The prism logo on black (animated: the beam splitting into the six tag colours) |

**Description (260 characters)**

> Paste your meeting notes. PrismPM proposes the Decisions, Tasks and Milestones in them, quoting the exact line. Accept with one click. Months later, ask "why did we...?" and get the answer with a link to the source - or an honest "nothing recorded".

## Gallery (in order)

1. **Hero, 1270 x 760:** "Your project's memory" over the Overview with Proposal cards. ([source](../../artifacts/after-item-proposal-cards.png))
2. **The 30-second loop (video):** paste notes, Proposals appear, accept, ask "why", click the citation. Recorded from `flows/01-citation-and-abstention.webm` and the Proposal flow.
3. **"Why did we...?" answered with sources.** ([source](flows/assistant-answer-with-citation.png))
4. **"There is no recorded decision about that."** Caption: _An assistant that knows when it doesn't know._ ([source](flows/assistant-no-recorded-decision.png))
5. **Approve every change.** The approval card. Caption: _The AI proposes. You decide._ ([source](flows/tool-approval-card.png))
6. **From brief to concept image.** Render drafted from Evidence. ([source](../../artifacts/after-renders-drafted-from.png))
7. **Works in Claude Desktop and Cursor.** The MCP config snippet from the README.

## Maker's first comment

> Hi Product Hunt!
>
> Every project handover I've seen goes the same way: the new PM gets the task list, and none of the reasons. Why did we pick this vendor? Why is the security review split into two half-days? The answer is in a meeting transcript somewhere, and nobody has time to find it.
>
> Decision logs fix this in theory. In practice nobody keeps them, because typing up decisions after every meeting is a chore.
>
> **PrismPM makes the log write itself - and keeps you in charge of it.**
>
> - Drop in meeting notes, transcripts or PDFs. PrismPM proposes the Decisions, Tasks and Milestones they contain, each quoting the exact sentence it came from. You accept, edit or reject.
> - Ask the Assistant "why did we...?" and it answers only from Decisions you confirmed, with a link to the source. If nothing was recorded, it says so instead of making something up.
> - When a date slips or a person leaves, PrismPM flags which Decisions rested on that assumption.
> - The Assistant can plan and update the project for you, but every change shows up as a card you approve.
>
> We measured all of this rather than hoping: 42 evaluation cases for extraction and answers, a three-model bake-off, and a prompt injection test that one popular model fails (details in our write-up).
>
> It's a free research preview. We'd love to hear: **what's the decision you most wish your team had written down?**

## Launch plan

| When        | Action                                                                                                                                                   |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2 weeks out | Create the upcoming page; collect followers from the CS3216 cohort, NUS project-management and builder communities, and the testers from M19             |
| 1 week out  | Line up a hunter; prepare the gallery and a 45-second video; separate production analytics (M19 next step 1) and add a `ref=producthunt` landing variant |
| Launch day  | Go live at 12:01 am PT (3:01 pm SGT). Makers answer every comment within the hour; post the first comment immediately                                    |
| Launch day  | Share in LinkedIn, X, Reddit r/projectmanagement (as a discussion of decision logs, not an ad), and relevant Discord and Slack groups                    |
| Day after   | Thank-you post with what we learned; follow up every sign-up that created a Project but no Evidence                                                      |

## What we will measure

Using the M19 events, split by `ref=producthunt`:

- Visit to sign-up, and sign-up to first Evidence (the activation step that matters).
- Proposals generated to accepted, and how many were edited first.
- Assistant questions to completed turns (the reliability metric M19 flagged).
- Day-7 return: did the User come back to ask a question about a Decision?

## Prepared replies to likely questions

- **"How is this different from Notion AI or ClickUp Brain?"** Those answer from everything they can see. PrismPM answers "why" only from Decisions a person confirmed, cites them, and says when nothing exists. It's a record, not a guess.
- **"Is my data used to train models?"** No. Bring your own model key if you prefer, and the image service only ever sees text you approved.
- **"What if the AI extracts something wrong?"** Nothing enters the project until you accept it, and every Proposal quotes its source so checking takes seconds.
