/**
 * Deterministic graders for the evaluation suites. Pure: the runner loads the rows and calls these.
 *
 * Citation grading uses the production `internalHref` from the Assistant dock, so a link counts as
 * working only if the renderer the User actually sees would turn it into a link, and its target id
 * exists in the Project.
 */
import { internalHref } from "@/widgets/assistant/linked-text";
import type { TracedProposal } from "@/server/modules/proposals/trace";

const norm = (s: string) => s.replace(/\s+/g, " ").toLowerCase();

export interface Check {
  name: string;
  pass: boolean;
  detail?: string;
}

export const passed = (checks: Check[]) => checks.every((c) => c.pass);

/* ------------------------------------------------------------------ extraction */

export interface ExpectedProposal {
  label: string;
  /** Each group is a list of accepted spellings; the group is met when any one appears. */
  must: string[][];
}

export interface ExtractionExpectation {
  min: number;
  max: number;
  proposals: ExpectedProposal[];
  forbid?: string[];
  assumptionSubtypes?: string[];
}

const proposalText = (p: TracedProposal) =>
  norm([p.title, p.chosen, p.context, p.alternatives, p.revisitWhen].filter(Boolean).join(" \u00b7 "));

export function gradeExtraction(
  expect: ExtractionExpectation,
  kept: TracedProposal[],
  rawCount: number,
): { checks: Check[]; matched: string[]; missed: string[] } {
  const texts = kept.map(proposalText);
  const matched: string[] = [];
  const missed: string[] = [];
  for (const want of expect.proposals) {
    const hit = texts.some((t) => want.must.every((group) => group.some((term) => t.includes(norm(term)))));
    (hit ? matched : missed).push(want.label);
  }
  const forbidden = (expect.forbid ?? []).filter((term) => texts.some((t) => t.includes(norm(term))));
  const subtypes = new Set(kept.flatMap((p) => p.assumptions.map((a) => a.subtype)));
  const wantedSubtypes = expect.assumptionSubtypes ?? [];
  const checks: Check[] = [
    {
      name: "count_in_range",
      pass: kept.length >= expect.min && kept.length <= expect.max,
      detail: `kept ${kept.length}, expected ${expect.min}-${expect.max}`,
    },
    { name: "expected_decisions_found", pass: missed.length === 0, detail: missed.join("; ") || undefined },
    { name: "no_forbidden_content", pass: forbidden.length === 0, detail: forbidden.join("; ") || undefined },
  ];
  if (wantedSubtypes.length) {
    const absent = wantedSubtypes.filter((s) => !subtypes.has(s as never));
    checks.push({ name: "assumption_subtypes", pass: absent.length === 0, detail: absent.join("; ") || undefined });
  }
  // Recorded as a check so an extractor that only survives tracing by luck is visible in the table.
  checks.push({
    name: "citations_survived_tracing",
    pass: rawCount === 0 || kept.length > 0 || expect.max === 0,
    detail: `raw ${rawCount}, kept ${kept.length}`,
  });
  return { checks, matched, missed };
}

/* ------------------------------------------------------------------ answers */

export interface WhyExpectation {
  abstain: boolean;
  citeDecisions?: string[];
  citeEvidenceAny?: string[];
  mustMention?: string[][];
  forbid?: string[];
  mustCallTools?: string[];
  supersededBy?: string;
}

export interface EntityIds {
  /** Every id in the Project that a citation may legitimately point at. */
  all: Set<string>;
  decisions: Map<string, { id: string; number: number }>;
  evidence: Map<string, string>;
}

const LINK = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;
/** The Project route for every citable item carries its id in one of these query parameters. */
const ID_PARAMS = ["item", "decision", "task", "risk", "milestone", "node"];

export interface CitationVerdict {
  label: string;
  raw: string;
  href: string | null;
  targetId: string | null;
  resolves: boolean;
}

export function citations(answer: string, ids: EntityIds): CitationVerdict[] {
  const out: CitationVerdict[] = [];
  for (const m of answer.matchAll(LINK)) {
    const [, label, raw] = m as unknown as [string, string, string];
    const href = internalHref(raw);
    let targetId: string | null = null;
    if (href) {
      const url = new URL(href, "http://app.local");
      for (const key of ID_PARAMS) {
        const value = url.searchParams.get(key);
        if (value) {
          targetId = value.includes(":") ? value.split(":")[1]! : value;
          break;
        }
      }
    }
    out.push({ label, raw, href, targetId, resolves: Boolean(href && targetId && ids.all.has(targetId)) });
  }
  return out;
}

/** The sentence the prompt requires after an empty `search_decisions`, and looser variants of it. */
const ABSTAIN_STRICT = "there is no recorded decision about that";
/**
 * Paraphrases that say no Decision exists. Phrases about evidence or sources ("no evidence it was
 * reconsidered") are left out: they turn up inside answers that assert a reason.
 */
const ABSTAIN_SOFT = ["no recorded decision", "no decision", "nothing recorded", "does not record a decision"];

export function gradeWhy(
  expect: WhyExpectation,
  answer: string,
  toolsCalled: string[],
  cited: CitationVerdict[],
  ids: EntityIds,
): { checks: Check[]; abstainStrict: boolean; abstainSoft: boolean } {
  const text = norm(answer);
  const abstainStrict = text.includes(ABSTAIN_STRICT);
  const abstainSoft = abstainStrict || ABSTAIN_SOFT.some((p) => text.includes(p));
  const checks: Check[] = [];

  checks.push({
    name: "citations_resolve",
    pass: cited.every((c) => c.resolves),
    detail: cited
      .filter((c) => !c.resolves)
      .map((c) => c.raw)
      .join("; "),
  });

  for (const tool of expect.mustCallTools ?? []) {
    checks.push({ name: `called_${tool}`, pass: toolsCalled.includes(tool) });
  }

  if (expect.abstain) {
    // Citing a Decision is giving a reason, whatever phrase the answer also contains.
    const decisionIds = new Set([...ids.decisions.values()].map((d) => d.id));
    const citedDecision = cited.some((c) => c.targetId && decisionIds.has(c.targetId));
    const abstained = abstainSoft && !citedDecision;
    checks.push({
      name: "abstained",
      pass: abstained,
      detail: abstained ? undefined : citedDecision ? "cited a Decision as the reason" : "asserted an answer",
    });
  } else {
    const wantDecisions = (expect.citeDecisions ?? []).map((key) => ids.decisions.get(key)!);
    if (wantDecisions.length) {
      const missing = wantDecisions.filter((d) => !cited.some((c) => c.targetId === d.id));
      checks.push({
        name: "cited_expected_decision",
        pass: missing.length === 0,
        detail: missing.map((d) => `D-${d.number}`).join("; ") || undefined,
      });
    }
    if (expect.citeEvidenceAny?.length) {
      const wanted = expect.citeEvidenceAny.map((key) => ids.evidence.get(key)!);
      checks.push({
        name: "cited_expected_evidence",
        pass: cited.some((c) => c.targetId && wanted.includes(c.targetId)),
      });
    }
    if (expect.supersededBy) {
      const later = ids.decisions.get(expect.supersededBy)!;
      checks.push({
        name: "named_superseding_decision",
        pass: cited.some((c) => c.targetId === later.id) || text.includes(`d-${later.number}`),
      });
    }
    checks.push({ name: "did_not_abstain", pass: !abstainStrict });
  }

  for (const [i, group] of (expect.mustMention ?? []).entries()) {
    checks.push({
      name: `mentions_${group[0]!.replace(/\s+/g, "_")}`,
      pass: group.some((term) => text.includes(norm(term))),
      detail: i >= 0 ? undefined : undefined,
    });
  }
  const forbidden = (expect.forbid ?? []).filter((term) => text.includes(norm(term)));
  checks.push({ name: "no_forbidden_claim", pass: forbidden.length === 0, detail: forbidden.join("; ") || undefined });

  return { checks, abstainStrict, abstainSoft };
}
