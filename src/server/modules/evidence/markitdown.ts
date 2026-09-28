import { execFile } from "node:child_process";
import type { UploadedFile } from "./service";

const DEFAULT_MAX_CHARS = 100_000;
const TIMEOUT_MS = 60_000;

/**
 * An uploaded file as Markdown via the `markitdown` CLI (Microsoft's converter; install with
 * `pip install "markitdown[all]"`, point `MARKITDOWN_BIN` at the binary). Bytes go to stdin so no
 * temp file is needed. Returns null when the binary is missing, times out or the format has no
 * converter - the caller keeps the file and simply has no Markdown to send downstream.
 */
export function fileToMarkdown(file: UploadedFile): Promise<string | null> {
  const bin = process.env.MARKITDOWN_BIN || "markitdown";
  return new Promise((resolve) => {
    const child = execFile(
      bin,
      { timeout: TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024, killSignal: "SIGKILL" },
      (err, stdout) => {
        if (err) {
          console.error(`markitdown could not convert ${file.name} (${file.type}): ${err.message.split("\n")[0]}`);
          resolve(null);
          return;
        }
        const text = stdout.trim();
        if (!text) return resolve(null);
        const max = Number(process.env.EVIDENCE_EXTRACT_MAX_CHARS) || DEFAULT_MAX_CHARS;
        resolve(text.slice(0, max));
      },
    );
    child.stdin?.end(file.bytes);
  });
}
