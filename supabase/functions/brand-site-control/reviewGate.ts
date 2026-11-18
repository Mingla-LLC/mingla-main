/**
 * #4453 (spec v1 §4.3) — Studio's UNREVIEWED_SECTIONS refusal, answered as
 * owner-fixable: VALIDATION_FAILED (409) with the reason code, the plain
 * instruction and which pages hold Draft sections (address, title, count;
 * never their content). Never SERVICE_TEMPORARILY_UNAVAILABLE, which would
 * mark the publish ambiguous and tell the owner to retry.
 */
import { sitesJson } from "../_shared/sitesContracts.ts";
import { UNREVIEWED_SECTIONS, UNREVIEWED_SECTIONS_MESSAGE } from "../_shared/siteContracts/publishChecks.ts";

type JsonObject = Record<string, unknown>;

function safePages(value: unknown): JsonObject[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.slice(0, 50).filter((row) => row && typeof row === "object").map((row) => {
    const page = row as JsonObject;
    return {
      path: typeof page.path === "string" ? page.path.slice(0, 200) : null,
      title: typeof page.title === "string" ? page.title.slice(0, 120) : "Page",
      count: Number.isInteger(page.count) && (page.count as number) > 0 ? page.count : 1,
    };
  });
}

export function unreviewedRefusal(error: unknown, operationId: string | null = null): Response | null {
  const body = error && typeof error === "object" ? error as JsonObject : {};
  if (body.code !== UNREVIEWED_SECTIONS) return null;
  const pages = safePages(body.pages);
  return sitesJson({
    ok: false,
    error: {
      code: "VALIDATION_FAILED",
      message: UNREVIEWED_SECTIONS_MESSAGE,
      retryable: false,
      operation_id: operationId,
      reason_code: UNREVIEWED_SECTIONS,
      ...(pages ? { pages } : {}),
    },
  }, 409);
}
