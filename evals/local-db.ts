/**
 * The evaluation scripts write fixtures and read Project rows, and `.env` may point `DATABASE_URL`
 * at a shared database; `dotenv` only fills a variable the shell left unset, so a forgotten
 * `DATABASE_URL=` prefix would silently run against it. Both scripts refuse anything not local.
 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function assertLocalDatabase(url = process.env.DATABASE_URL) {
  let host: string | null = null;
  try {
    host = url ? new URL(url).hostname : null;
  } catch {
    host = null;
  }
  if (!host || !LOCAL_HOSTS.has(host))
    throw new Error(
      `DATABASE_URL must point at a local evaluation database (got ${host ?? "none"}); prefix the command with DATABASE_URL=postgres://pm:pm@localhost:5433/pm_eval_20260928`,
    );
}
