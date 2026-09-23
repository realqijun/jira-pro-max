---
status: accepted
---

# Every new User is seeded their own sample Project

A new account lands on an empty dashboard, which is the worst moment to judge a project management tool: nothing to look at and a blank form to fill in.
Signing up now creates one populated Project, the Bedok Community Centre, owned by that User from the moment it exists.
`seedSampleProject` in `src/server/modules/onboarding/sample-project.ts` builds it through the ordinary services, and a Better Auth `databaseHooks.user.create.after` hook calls it.

## Why a copy per User and not one shared Project

The alternative considered was a single global sample Project that every User sees, which deleting only hides and editing silently forks into a personal copy.
It was rejected on cost, and the cost is concentrated in the places this codebase can least afford to disturb.

**It breaks the one authorization seam.**
`assertOwnsProject` resolves through `findByIdForOwner`, which matches `owner_id` to the viewer.
A Project owned by nobody fails that check for everyone, so globals would need an exception inside the single function that ADR 0002 nominates as the place all future sharing goes.
Seeding a real Project needs no exception at all.

**There is no single place an edit happens.**
"Editing forks it" sounds like one interception point, but editing is roughly forty service methods across tasks, risks, milestones, dependencies, comments, evidence, decisions, people, statuses, labels, rooms and renders.
`mutate` cannot do it generically: it never sees a `projectId`, and a fork would have to rewrite the ids in the input it was handed so the write lands on the copy.

**The fork is a deep clone of 25 tables.**
There are 47 `project_id` columns and foreign keys into `projects`.
Tasks point at statuses, milestones, people and labels; dependencies at tasks and milestones; decision edges and sources at decisions, assumptions, evidence, comments and Activity Events; evidence links at three item types; rooms at people.
Cloning means a full id remap in foreign-key order plus copying Evidence and Render blobs.

**Cloned history would misattribute.**
`activity_events.actor_id` is a foreign key to a User.
Copying the sample's history into a new account either credits its author's actions to someone who never performed them, or drops the history and leaves a Project whose Activity feed begins from nothing.

Against all that, the seeded copy needs no new concept: it is a Project like any other, delete is delete, and edit is edit.

## Consequences

- The sample cannot be updated centrally for Users who already signed up. Accepted: it is an example, not a document of record. Changing it changes what the next signup receives.
- Each account carries its own rows (a few dozen) and its own copies of four render images in storage. Negligible at this scale, and the thing to revisit first if it ever is not.
- The hook never rethrows. An account that could not be created because its sample Project failed would be a much worse outcome than an account without one, and the User can always create a Project.
- It is awaited rather than deferred to `after()`, because signup redirects straight to the dashboard and a dashboard that is empty on first paint and populated on the next is worse than the delay.
- Render images are read from `public/samples/renders` with `process.cwd()`, so `next.config.ts` traces them into the server bundle. A missing image costs the sample its pictures and nothing else.
- There is no longer an empty-workspace state for a new account, so the `auth` documentation flow captures `starter-workspace` instead.
- `npm run db:seed` signs the demo account up and therefore fires the hook; it clears that account's Projects immediately afterwards so the demo data is exactly what the script builds.
