import { isSlug } from "../contracts/generated/routes.ts";

/**
 * #2829 W2 — a shape-checked page path for a draft preview, or null (home).
 * Only lowercase slug segments (at most four) travel; the runtime resolves the
 * path inside the SAME preview artifact, so it can never reach anything else.
 */
export function previewPagePath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const path = raw.replace(/^\/+|\/+$/g, "");
  if (!path || path.length > 300) return null;
  const segments = path.split("/");
  return segments.length <= 4 && segments.every(isSlug) ? path : null;
}
