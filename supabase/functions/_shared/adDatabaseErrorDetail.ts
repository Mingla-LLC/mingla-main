/**
 * #4238 P2-a: database error text never reaches a Host.
 *
 * Postgres and PostgREST messages ("canceling statement due to statement
 * timeout", "duplicate key value violates ...", "invalid input syntax for
 * type uuid: ...") are engineering text and can carry row values. Our own
 * RPCs raise machine codes instead (`plan_version_stale`,
 * `audience_country_mismatch:NG`), and the apps map those codes to copy.
 *
 * So a response detail keeps the database message only when it is one of
 * those code-shaped tokens. Anything else is replaced by a neutral code and
 * logged on the server with quoted values and key tuples redacted.
 */

export const NEUTRAL_DATABASE_DETAIL = "database_operation_failed";

/** `snake_code`, optionally followed by `:qualifier` parts with no spaces. */
const RAISED_CODE = /^[a-z][a-z0-9_]{2,80}(?::[A-Za-z0-9_.\-]{1,80}){0,4}$/;

/** Strip values that could identify a person before a message is logged. */
export function redactDatabaseMessage(message: string): string {
  return message
    .replace(/\(([^()]*)\)=\(([^()]*)\)/g, "($1)=([redacted])")
    .replace(/"[^"]*"/g, '"[redacted]"')
    .replace(/'[^']*'/g, "'[redacted]'")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[redacted-email]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[uuid]")
    .slice(0, 300);
}

/** True when the text is a code one of our own RPCs raised on purpose. */
export function isRaisedDatabaseCode(message: unknown): message is string {
  return typeof message === "string" && RAISED_CODE.test(message.trim());
}

/**
 * The detail a response may carry for a database error: the raised code, or
 * `fallback` (a neutral code) with the raw text kept in the server log only.
 */
export function hostSafeDatabaseDetail(
  error: unknown,
  context: string,
  fallback: string = NEUTRAL_DATABASE_DETAIL,
): string {
  const fields = error !== null && typeof error === "object"
    ? error as { message?: unknown; code?: unknown }
    : { message: error === undefined || error === null ? "" : String(error) };
  const message = typeof fields.message === "string" ? fields.message.trim() : "";
  if (isRaisedDatabaseCode(message)) return message;
  if (error !== null && error !== undefined) {
    const code = typeof fields.code === "string" ? fields.code : "unknown";
    console.error(
      `[${context}] database error withheld from response: code=${code} message=${
        redactDatabaseMessage(message || "(none)")
      }`,
    );
  }
  return fallback;
}
