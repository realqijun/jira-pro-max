/**
 * Builds the milestones write-up PDF from docs/submission/*.md.
 *
 *   GROUP=12 REPO_URL=https://github.com/<owner>/<repo> node scripts/build-milestones-pdf.mjs
 *
 * Writes docs/submission/group-<GROUP>-milestones.pdf (KEEP_HTML=1 keeps the intermediate .html).
 * Relative links to repository files become links into REPO_URL; images are embedded.
 */
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { micromark } from "micromark";
import { gfm, gfmHtml } from "micromark-extension-gfm";
import { chromium } from "@playwright/test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dir = resolve(root, "docs/submission");
const group = process.env.GROUP || "05";
const repoUrl = (process.env.REPO_URL || "https://github.com/BrandonLYS/CS3216-Assignment-3").replace(/\/$/, "");
const liveUrl = process.env.LIVE_URL || "https://jira-pro-max.vercel.app";

/** [file, heading]; a null file is a milestone answered inline. */
const sections = [
  ["m0.md", "Milestone 0 - The problem"],
  ["m1.md", "Milestone 1 - Competitors"],
  ["m2.md", "Milestone 2 - Application, objectives and user stories"],
  ["m3.md", "Milestone 3 - Secret sauce and moat"],
  ["m4.md", "Milestone 4 - Target users and acquisition"],
  ["m5.md", "Milestone 5 - MVP and future features"],
  ["m6.md", "Milestone 6 - Monetization and pricing"],
  ["m7.md", "Milestone 7 - How we use LLMs"],
  ["m8-prompts.md", "Milestone 8 - Prompts and how they were designed"],
  ["m9-model-bakeoff.md", "Milestone 9 - Choice of model, provider and parameters"],
  ["m10-interaction-patterns.md", "Milestone 10 - AI interaction patterns"],
  ["m11-evals.md", "Milestone 11 - Evaluation dataset and strategy"],
  ["m11-item-evals.md", "Milestone 11 addendum - Task and Milestone extraction evals"],
  ["m12-optimization.md", "Milestone 12 - Production optimization"],
  ["m13-safety.md", "Milestone 13 - Risks and safeguards"],
  ["m14.md", "Milestone 14 - Product name and logo"],
  ["m15-stack.md", "Milestone 15 - Choice of technologies"],
  ["m16-workflows.md", "Milestone 16 - Three common workflows"],
  ["m17-ai-ui.md", "Milestone 17 - UI decisions for an AI application"],
  ["m18-landing.md", "Milestone 18 - Landing page"],
  ["m19-analytics.md", "Milestone 19 - Analytics"],
  ["m20-product-hunt.md", "Milestone 20 - Product Hunt launch"],
  ["m21-advanced-rag.md", "Milestone 21 (optional) - Advanced RAG"],
  [null, "Milestone 22 (optional) - Multi-agent orchestration"],
  ["m23-mcp.md", "Milestone 23 (optional) - MCP"],
];

const m22 = `Not attempted.
PrismPM runs one bounded tool loop per turn rather than several coordinating agents (M10).
Every task we tried - planning a launch, answering "why", logging Risks - completed in at most 3 of the 8 permitted steps on every model (M12), so a planner and worker split would add latency, cost and a second place for errors without a measured problem to solve.
The two background model calls (Decision and item extraction) run side by side on the same sources but do not coordinate, so we do not present them as a multi-agent system.`;

const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** Rewrites a relative href or src found in `file` to an absolute target. */
function rewrite(target, file, kind) {
  if (/^([a-z]+:|#|mailto:)/i.test(target)) return target;
  const [path, hash] = target.split("#");
  const abs = resolve(dirname(file), decodeURIComponent(path));
  if (kind === "src") return existsSync(abs) ? pathToFileURL(abs).href : target;
  const rel = relative(root, abs);
  if (rel.startsWith("..")) return target;
  const inPdf = sections.find(([f]) => f && resolve(dir, f) === abs);
  if (inPdf) return `#${slug(inPdf[1])}`;
  return `${repoUrl}/blob/main/${rel}${hash ? `#${hash}` : ""}`;
}

function render(file, heading) {
  const md = readFileSync(file, "utf8").replace(/^# .*\n/, ""); // the PDF supplies its own H1
  let html = micromark(md, { extensions: [gfm()], htmlExtensions: [gfmHtml()], allowDangerousHtml: true });
  html = html.replace(/(href|src)="([^"]+)"/g, (_, attr, v) => `${attr}="${rewrite(v, file, attr)}"`);
  return `<section class="milestone"><h1 id="${slug(heading)}">${heading}</h1>${html}</section>`;
}

const body = sections
  .map(([f, h]) =>
    f
      ? render(resolve(dir, f), h)
      : `<section class="milestone"><h1 id="${slug(h)}">${h}</h1>${micromark(m22)}</section>`,
  )
  .join("\n");

const toc = sections.map(([, h]) => `<li><a href="#${slug(h)}">${h}</a></li>`).join("");
const logo = pathToFileURL(resolve(dir, "screenshots/logo.png")).href;

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>PrismPM - Milestones</title>
<style>
  @page { size: A4; margin: 16mm 14mm 18mm; }
  :root { --ink:#16181d; --muted:#5b6170; --line:#dfe2e8; --accent:#5e6ad2; --code:#f4f5f7; }
  * { box-sizing: border-box; }
  body { font: 10pt/1.5 -apple-system, "Segoe UI", Inter, Helvetica, Arial, sans-serif; color: var(--ink); margin: 0; }
  a { color: var(--accent); text-decoration: none; word-break: break-word; }
  h1 { font-size: 19pt; margin: 0 0 10pt; padding-bottom: 6pt; border-bottom: 2px solid var(--accent); }
  h2 { font-size: 13.5pt; margin: 16pt 0 6pt; }
  h3 { font-size: 11.5pt; margin: 12pt 0 4pt; }
  h4 { font-size: 10.5pt; margin: 10pt 0 4pt; }
  h2, h3, h4 { break-after: avoid; }
  p, li { orphans: 3; widows: 3; }
  .milestone { break-before: page; }
  table { border-collapse: collapse; width: 100%; margin: 8pt 0 10pt; font-size: 8.4pt; line-height: 1.35; }
  th, td { border: 1px solid var(--line); padding: 3.5pt 5pt; text-align: left; vertical-align: top; overflow-wrap: break-word; hyphens: auto; }
  td code, th code { overflow-wrap: anywhere; word-break: normal; }
  th { background: #f0f1f5; }
  tr { break-inside: avoid; }
  code { font: 8.6pt/1.4 ui-monospace, "SF Mono", Menlo, Consolas, monospace; background: var(--code); padding: 0 2pt; border-radius: 2pt; word-break: break-word; }
  pre { background: var(--code); padding: 7pt 9pt; border-radius: 4pt; white-space: pre-wrap; word-break: break-word; font-size: 8.2pt; break-inside: avoid; }
  pre code { background: none; padding: 0; font-size: inherit; }
  blockquote { margin: 8pt 0; padding: 2pt 10pt; border-left: 3px solid var(--line); color: var(--muted); }
  img { max-width: 100%; max-height: 118mm; display: block; margin: 8pt auto; border: 1px solid var(--line); border-radius: 4pt; break-inside: avoid; }
  td img { max-height: 60mm; }
  .cover { height: 250mm; display: flex; flex-direction: column; justify-content: center; }
  .cover img { border: 0; margin: 0 0 18pt; width: 220px; background: #000; border-radius: 8pt; }
  .cover h1 { font-size: 30pt; border: 0; margin: 0 0 4pt; padding: 0; }
  .cover .sub { font-size: 13pt; color: var(--muted); margin-bottom: 26pt; }
  .cover dl { display: grid; grid-template-columns: 34mm 1fr; gap: 5pt 10pt; font-size: 11pt; margin: 0; }
  .cover dt { color: var(--muted); }
  .cover dd { margin: 0; }
  .toc { break-before: page; }
  .toc ol { list-style: none; padding: 0; columns: 1; }
  .toc li { padding: 3pt 0; border-bottom: 1px dotted var(--line); }
</style></head><body>
<section class="cover">
  <img src="${logo}" alt="PrismPM logo">
  <h1>PrismPM</h1>
  <div class="sub">Project management with a memory - CS3216 Assignment 3 milestones</div>
  <dl>
    <dt>Group</dt><dd>${group}</dd>
    <dt>Live application</dt><dd><a href="${liveUrl}">${liveUrl}</a></dd>
    <dt>GitHub repository</dt><dd><a href="${repoUrl}">${repoUrl}</a></dd>
    <dt>Release</dt><dd>main at <code>${process.env.RELEASE || "34be9db"}</code>, deployed to the live URL</dd>
    <dt>Date</dt><dd>${new Date().toISOString().slice(0, 10)}</dd>
  </dl>
</section>
<section class="toc"><h1>Contents</h1><ol>${toc}</ol></section>
${body}
</body></html>`;

const out = resolve(dir, `group-${group}-milestones`);
writeFileSync(`${out}.html`, html);

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(pathToFileURL(`${out}.html`).href, { waitUntil: "load" });
await page.pdf({
  path: `${out}.pdf`,
  format: "A4",
  printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: "<span></span>",
  footerTemplate: `<div style="width:100%;font-size:7pt;color:#8a8f9c;padding:0 14mm;display:flex;justify-content:space-between"><span>PrismPM - Group ${group} milestones</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
  margin: { top: "16mm", bottom: "18mm", left: "14mm", right: "14mm" },
});
await browser.close();
if (!process.env.KEEP_HTML) unlinkSync(`${out}.html`);
console.log(`Wrote ${relative(root, out)}.pdf`);
