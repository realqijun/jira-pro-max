import { CalendarRange, FileText, GitBranch, History, MessageSquare, TriangleAlert } from "lucide-react";
import { ProductShowcase } from "./product-showcase";
import { Reveal } from "./reveal";

const capabilities = [
  {
    icon: History,
    title: "Field-level history",
    body: "Every change is an Activity Event: which field, from what, to what, by whom, when. Immutable, and the same whether a person or the Assistant made it.",
  },
  {
    icon: FileText,
    title: "Evidence and passages",
    body: "Upload a plan, minutes or a transcript. Transcripts are stored as ordered Passages so a citation can point at the sentence that mattered.",
  },
  {
    icon: GitBranch,
    title: "Dependencies that surface",
    body: "A directed edge saying one item cannot proceed until another is done - with late dependencies rolled up where you will see them.",
  },
  {
    icon: TriangleAlert,
    title: "A risk register, not a label",
    body: "Risks carry probability, impact and an owner, and sit apart from the blocked status so the two never get confused.",
  },
  {
    icon: CalendarRange,
    title: "Timeline and calendar",
    body: "Tasks with dates and Milestones they roll up to, across one Project or the whole workspace.",
  },
  {
    icon: MessageSquare,
    title: "Assistant, and MCP",
    body: "Converse in the app, or point your own client at the same tools over a Streamable HTTP endpoint with a personal token.",
  },
];

export function LandingCapabilities() {
  return (
    <section id="capabilities" className="mx-auto max-w-[1280px] px-6 py-32">
      <Reveal>
        <span data-reveal className="text-eyebrow font-medium tracking-[0.4px] text-ink-tertiary uppercase">
          Capabilities
        </span>
        <h2 data-reveal className="mt-5 max-w-2xl text-display-md text-balance text-ink">
          Made to be looked at closely
        </h2>
        <p data-reveal className="mt-6 max-w-xl text-body-lg text-pretty text-ink-subtle">
          An intelligence layer is only as good as the record beneath it. PrismPM keeps that record strict enough to
          reason over.
        </p>

        <div data-reveal className="mt-14">
          <ProductShowcase />
        </div>

        {/* Hairlines rather than six floating boxes: the grid reads as one structure. */}
        <div className="mt-16 grid gap-px bg-hairline sm:grid-cols-2 lg:grid-cols-3">
          {capabilities.map(({ icon: Icon, title, body }) => (
            <article
              key={title}
              data-reveal
              className="group bg-canvas p-8 transition-colors duration-300 hover:bg-surface-1"
            >
              <Icon className="size-4 text-ink-tertiary transition-colors duration-300 group-hover:text-primary" />
              <h3 className="mt-6 text-subhead font-medium text-ink">{title}</h3>
              <p className="mt-3 text-body-sm text-pretty text-ink-subtle">{body}</p>
            </article>
          ))}
        </div>
      </Reveal>
    </section>
  );
}
