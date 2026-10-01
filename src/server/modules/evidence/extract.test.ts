import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DOCX, PDF, XLSX, fileToTextInProcess } from "./extract";

const fixture = (name: string, type: string) => {
  const bytes = readFileSync(join(__dirname, "__fixtures__", name));
  return { name, type, size: bytes.length, bytes };
};

describe("fileToTextInProcess", () => {
  it("reads a Word document without markitdown or a model", async () => {
    const text = await fileToTextInProcess(fixture("minutes.docx", DOCX));

    expect(text).toContain("Sprint sync, 12 Sep");
    expect(text).toContain("We decided to ship web first and drop the Android build for launch.");
  });

  it("reads every sheet of a workbook as CSV rows under the sheet name", async () => {
    const text = await fileToTextInProcess(fixture("plan.xlsx", XLSX));

    expect(text).toBe(["## Milestones", "Milestone,Owner,Weeks", '"Beta ready, web only",Priya,3'].join("\n"));
  });

  it("reads a PDF's text layer", async () => {
    expect(await fileToTextInProcess(fixture("vendor-note.pdf", PDF))).toContain(
      "Vendor note: sandbox access slips to 7 Oct.",
    );
  });

  it("reads a text file as UTF-8", async () => {
    const bytes = Buffer.from("Milestone,Owner\nBeta,Priya\n");

    expect(await fileToTextInProcess({ name: "plan.csv", type: "text/csv", size: bytes.length, bytes })).toBe(
      "Milestone,Owner\nBeta,Priya",
    );
  });

  it("returns null instead of throwing for a corrupt file or a type it cannot read", async () => {
    const junk = Buffer.from("not really a document");

    expect(await fileToTextInProcess({ name: "x.docx", type: DOCX, size: junk.length, bytes: junk })).toBeNull();
    expect(await fileToTextInProcess({ name: "x.png", type: "image/png", size: junk.length, bytes: junk })).toBeNull();
  });
});
