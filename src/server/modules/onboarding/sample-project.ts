import { readFile } from "node:fs/promises";
import path from "node:path";
import { addDays, formatISO } from "date-fns";
import type { Ctx } from "@/server/core/context";
import { dependenciesService } from "@/server/modules/dependencies/service";
import { milestonesService } from "@/server/modules/milestones/service";
import { peopleService } from "@/server/modules/people/service";
import { projectsService } from "@/server/modules/projects/service";
import { rendersService } from "@/server/modules/renders/service";
import { risksService } from "@/server/modules/risks/service";
import { statusesService } from "@/server/modules/statuses/service";
import { tasksService } from "@/server/modules/tasks/service";

/**
 * The sample Project every new User starts with.
 *
 * It is a real Project owned by that User from the moment it exists, not a shared template:
 * they can edit it, and deleting it is an ordinary delete. That is the whole reason this is a
 * seeding function rather than a global row - a Project nobody owns would have to be let past
 * `assertOwnsProject`, which ADR 0002 keeps as the single authorization seam.
 *
 * The cost of the choice is that the sample cannot be updated centrally for Users who have
 * already signed up. That is accepted: it is an example, not a document of record.
 */

/** Dates are relative to signup, so the sample always looks like a project in flight. */
const d = (offset: number) => formatISO(addDays(new Date(), offset), { representation: "date" });

/**
 * Committed images with the description and seed that actually produced them, imported as
 * ready Renders. The seed is real so the displayed provenance reproduces the image.
 */
export const SAMPLE_RENDERS = [
  {
    file: "community-centre-exterior.jpg",
    seed: 101,
    prompt:
      "A two storey community centre with a pitched roof, red brick facade, large glazed entrance atrium and a paved forecourt",
  },
  {
    file: "community-centre-hall.jpg",
    seed: 202,
    prompt:
      "Interior of a double height community hall with clerestory windows, exposed timber ceiling beams, a small mezzanine gallery and rows of stacking chairs",
  },
  // Two scenario Renders: what an option under discussion looks like, not a prediction. The
  // first is the state the site would be handed over in if fit-out slips past the Structural
  // handover Milestone; the second is the descope the Design team costed. Both are things a
  // PM is choosing between, which is why a picture helps and why neither claims a date.
  {
    file: "community-centre-slip.jpg",
    seed: 303,
    prompt:
      "The site at structural handover if fit-out slips: the main hall enclosed and roofed, the activity room wing still a bare structural frame, site hoarding and a tower crane in place",
  },
  {
    file: "community-centre-descoped.jpg",
    seed: 404,
    prompt:
      "The descoped scheme with the glazed entrance atrium replaced by a plain recessed doorway in the brick facade and a smaller paved forecourt",
  },
];

/**
 * Read from `public/` rather than the network: signup must not depend on the image service,
 * and these bytes are committed. `next.config.ts` traces them into the deployed bundle.
 */
const sampleImage = (file: string) => readFile(path.join(process.cwd(), "public", "samples", "renders", file));

/**
 * Renders are the last step and the only one that touches the filesystem, so a missing or
 * unreadable image costs the sample its pictures and nothing else. A new User with a sample
 * Project and no renders is a far better outcome than a signup that fails.
 */
async function addRenders(ctx: Ctx, projectId: string) {
  for (const r of SAMPLE_RENDERS) {
    try {
      await rendersService.importReady(ctx, {
        projectId,
        prompt: r.prompt,
        seed: r.seed,
        bytes: await sampleImage(r.file),
        mimeType: "image/jpeg",
      });
    } catch (e) {
      console.error(`Sample render ${r.file} could not be imported`, e);
    }
  }
}

/**
 * A construction project, because a concept render is easiest to judge when the deliverable
 * is a building. Returns the Project so callers can report it.
 */
export async function seedSampleProject(ctx: Ctx) {
  const project = await projectsService.create(ctx, {
    name: "Bedok Community Centre",
    key: "BCC",
    description:
      "Design and build a two storey community centre with a main hall, four activity rooms and a public forecourt.",
    startDate: d(-90),
    targetDate: d(120),
  });
  const pid = project.id;
  const s = Object.fromEntries((await statusesService.list(ctx, pid)).map((x) => [`${x.scope}:${x.name}`, x.id]));

  const design = await peopleService.createTeam(ctx, { projectId: pid, name: "Design" });
  const build = await peopleService.createTeam(ctx, { projectId: pid, name: "Main contractor" });
  const mei = await peopleService.createPerson(ctx, {
    projectId: pid,
    name: "Mei Ling Tan",
    role: "Architect",
    teamId: design.id,
  });
  const rajesh = await peopleService.createPerson(ctx, {
    projectId: pid,
    name: "Rajesh Kumar",
    role: "Site manager",
    teamId: build.id,
  });

  const handover = await milestonesService.create(ctx, {
    projectId: pid,
    name: "Structural handover",
    dueDate: d(60),
    ownerId: rajesh.id,
  });
  await milestonesService.create(ctx, {
    projectId: pid,
    name: "Design freeze",
    dueDate: d(-5),
    ownerId: mei.id,
  });

  const scheme = await tasksService.create(ctx, {
    projectId: pid,
    title: "Agree scheme design with the town council",
    statusId: s["task:Done"],
    priority: "high",
    assigneeId: mei.id,
    startDate: d(-85),
    dueDate: d(-40),
  });
  const frame = await tasksService.create(ctx, {
    projectId: pid,
    title: "Erect structural frame",
    statusId: s["task:In Progress"],
    priority: "high",
    assigneeId: rajesh.id,
    milestoneId: handover.id,
    startDate: d(-20),
    dueDate: d(55),
  });
  await tasksService.create(ctx, {
    projectId: pid,
    title: "Fit out the main hall",
    statusId: s["task:Todo"],
    priority: "medium",
    assigneeId: rajesh.id,
    startDate: d(60),
    dueDate: d(100),
  });
  await dependenciesService.create(ctx, {
    projectId: pid,
    predecessorType: "task",
    predecessorId: scheme.id,
    successorType: "task",
    successorId: frame.id,
  });
  await risksService.create(ctx, {
    projectId: pid,
    title: "Council reads the concept render as a construction drawing",
    probability: "medium",
    impact: "high",
    ownerId: mei.id,
    mitigation: "Renders are captioned as indicative; issue dimensioned drawings separately",
  });

  await addRenders(ctx, pid);
  return project;
}
