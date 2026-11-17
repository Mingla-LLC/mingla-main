/**
 * #4453 — whether a publication is a Draft preview (the team's preview or a
 * shared preview link): its id starts with `preview-`. A plain module (no client
 * directive), so server components may call it while rendering; the client
 * analytics module re-exports it. Server render passes the answer down as
 * `ctx.preview` (decided once per page from the artifact being rendered).
 */
export function isPreviewPublication(publicationId: string): boolean {
  return typeof publicationId === "string" && publicationId.startsWith("preview-");
}

/**
 * #4453 M8 — a SHARED preview (the private link a client opens) is a preview
 * for analytics and forms, but it is not the team's Draft: it never draws the
 * owner's "no upcoming trips yet" hints, and it leaves out pages a person has
 * not reviewed yet. The share page re-labels the artifact's publication id
 * with this prefix (still `preview-…`, so nothing is counted and no consent
 * banner shows); the render context reads it on the server.
 */
export const SHARED_PUBLICATION_PREFIX = "preview-shared-";

export function isSharedPreviewPublication(publicationId: string): boolean {
  return typeof publicationId === "string" && publicationId.startsWith(SHARED_PUBLICATION_PREFIX);
}

export function sharedViewPublicationId(publicationId: string): string {
  if (isSharedPreviewPublication(publicationId)) return publicationId;
  return `${SHARED_PUBLICATION_PREFIX}${publicationId.replace(/^preview-/, "")}`;
}

/** Whether a render draws the Draft-only hints: the team's preview does, a shared link never does. */
export function showsDraftHints(publicationId: string): boolean {
  return isPreviewPublication(publicationId) && !isSharedPreviewPublication(publicationId);
}
