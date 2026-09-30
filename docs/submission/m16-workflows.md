# Milestone 16 - Three common workflows

The three workflows below are the product loop from M5: capture reasoning, retrieve it, and act on the Project.
Each is shown as a PM performs it, with the reason it was designed that way rather than an obvious alternative.

## 1. Meeting notes become reviewed Decisions, Tasks and Milestones

**Steps**

1. The PM pastes kickoff notes or uploads a transcript on the Evidence tab, and saves.
2. The save returns immediately; a background pass reads the new text and proposes the Decisions, Tasks and Milestones it records.
3. On the Overview, **Needs attention** shows one card per Proposal: the proposed item, the Source it came from and the exact sentence quoted from it, plus owner, Milestone and dates for Tasks.
4. The PM clicks **Accept**, **Edit and accept** (a pre-filled dialog), or **Reject**. Accepting creates the item, links the cited Evidence, and records it in History as created "via Assistant".

![Proposed Milestone and Task on the Overview, each with its Source and verbatim excerpt](../../artifacts/after-item-proposal-cards.png)

**Why this design over the alternatives**

| Alternative                                        | Why not                                                                                                                                                                                                                         |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The PM types Decisions into a log by hand          | This is what every competitor offers, and it is exactly the habit nobody keeps. The value of a Decision Memory depends on it being filled without effort.                                                                       |
| The model writes Decisions and Tasks directly      | Extraction is right about 9 times in 10 at best (M11). A wrong Decision cited later as "the reason" is worse than no Decision, and one prompt injection could plant one (M13). A pending queue costs the PM one click per item. |
| A "Generate" button the PM must remember to press  | Kept as **Propose from evidence** for re-runs, but the default is automatic: the pass runs on save in `after()`, and content hashing makes a repeat pass free (M12), so there is no cost reason to make the PM ask.             |
| Cards without the quote, only the extracted fields | The PM cannot judge a Proposal without seeing where it came from. The verbatim excerpt turns review into a two-second check rather than re-reading the notes.                                                                   |

## 2. "Why did we...?" gets a cited answer, or an honest "nothing recorded"

**Steps**

1. The PM opens the Assistant dock on any Project page and asks, for example, "Why did we choose to freeze the legacy gateway on 1 October?"
2. The dock shows **Searched decisions** while the model calls `search_decisions`.
3. The answer states the reason and ends each claim with a link to its Source, then the Decision itself. Clicking a link opens that Evidence or Decision in place.
4. If no Decision covers the question, the answer says "There is no recorded decision about that." and links the nearest Evidence so the PM can look themselves.

![A cited answer: the Decision and the Sprint review notes it rests on, both clickable](flows/assistant-answer-with-citation.png)

![No Decision recorded: the Assistant abstains instead of inventing a reason](flows/assistant-no-recorded-decision.png)

**Why this design over the alternatives**

| Alternative                                 | Why not                                                                                                                                                                                           |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plain semantic search over all text         | A similar-sounding paragraph is not a Decision. Routing "why" questions to confirmed Decisions only is what lets the answer be trusted (M10, pattern 4).                                          |
| A separate search page with a results list  | The question arises mid-task, on the page the PM is already on. The dock keeps context and turns results into one sentence with sources, which is what the PM actually wanted.                    |
| Let the model answer from general knowledge | A plausible invented reason is the most damaging output possible during a handover. The abstention sentence is required by the prompt and graded by four eval cases (`w04`, `w05`, `w12`, `w14`). |

## 3. Plan or change the Project in one sentence, with approval

**Steps**

1. The PM asks the Assistant "Plan a two-month launch with UAT in week 6" or "Move the pilot readout to next Friday".
2. The model reads the Project summary, then proposes each write as a tool call.
3. Each write pauses at an approval card that names the tool and its arguments. Deletes and Project-level changes name the exact target ("Delete Task PM-12 'Write test plan'?").
4. The PM chooses **Allow once**, **Always allow** (for this tool, in this scope) or **Deny**. The tool runs through the same service as the UI, and the answer summarises what changed in one or two sentences.

![Approval card for update_task with its arguments and Deny / Always allow / Allow once](flows/tool-approval-card.png)

**Why this design over the alternatives**

| Alternative                                       | Why not                                                                                                                                                                                                              |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A form-based "create Milestones and Tasks" wizard | Planning a launch is a dozen dependent items with dates; a wizard needs a dozen screens. One sentence plus a few approvals is faster.                                                                                |
| Fully autonomous agent, no approval               | A model misreading "next Friday" silently moves a date the whole team relies on. Approval turns a silent error into a visible one, and "Always allow" lets a PM remove the friction for tools they trust, per scope. |
| A single "approve the whole plan" step            | One bad item hidden in twelve would get approved with the rest. Per-call approval keeps each change reviewable; the cards stack as the loop runs, so the PM is not waiting between them.                             |

## Automated coverage

These workflows are exercised end to end in CI by Playwright:

| Workflow                             | Spec                                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------------------- |
| Evidence to Decision Proposals       | `e2e/flows.spec.ts` (proposals), `e2e/propose-review.spec.ts`                               |
| Evidence to Task/Milestone Proposals | `e2e/item-proposals.spec.ts`                                                                |
| Cited answers                        | `e2e/citations.proof.spec.ts`                                                               |
| Approval cards                       | unit tests in `assistant/tools.test.ts`; recorded flow `flows/03-approval-and-history.webm` |
| Render drafted from Evidence         | `e2e/renders-draft.spec.ts` (stubbed model and image provider)                              |
