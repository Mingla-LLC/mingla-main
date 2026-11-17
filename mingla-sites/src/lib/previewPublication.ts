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
