/**
 * #4238 — the error code in a 2xx edge-function body, only when it is a
 * non-empty string. Edge envelopes carry `error: null` on success, and
 * admin-ad-creative-prepare carries an error OBJECT beside `state: "failed"`
 * so the caller can retry; neither is a failed request.
 */
export function edgeErrorCode(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const value = (data as { error?: unknown }).error;
  return typeof value === "string" && value.trim() !== "" ? value : null;
}
