/*
 * #2829 W9f (A18 item 2) — the runtime's private preview may be framed by
 * Business web production (host.usemingla.com), Mingla Studio and, locally,
 * loopback origins. A Business web Vercel PREVIEW deployment cannot be named
 * in a CSP pattern, so it names itself: `fa=<its origin>` travels with the
 * preview link (Studio forwards it, the runtime adds that one exact origin
 * when it matches this pattern). Every other origin adds nothing.
 */
export const BUSINESS_PREVIEW_ORIGIN_PATTERN =
  /^https:\/\/mingla-business-[a-z0-9-]+\.vercel\.app$/;

export function previewUrlForFrame(previewUrl: string, frameOrigin: string | null | undefined): string {
  if (typeof frameOrigin !== "string" || !BUSINESS_PREVIEW_ORIGIN_PATTERN.test(frameOrigin)) {
    return previewUrl;
  }
  return `${previewUrl}${previewUrl.includes("?") ? "&" : "?"}fa=${encodeURIComponent(frameOrigin)}`;
}

/**
 * #2829 W9r — the scaled preview frames the DRAFT ITSELF (not Studio's
 * preview chrome), so the simulated width is the page's real width and the
 * Website design can post unsaved colours into it. A preview link
 * (`<studio>/preview?token=…`) becomes Studio's preview redirect
 * (`<studio>/api/mingla/previews?site_id=…&token=…&path=…`), which builds the
 * draft and redirects to the runtime's private /preview. Anything that is
 * not a preview link is returned unchanged.
 */
export function previewFrameSource(
  previewUrl: string,
  siteId: string,
  pagePath: string,
  frameOrigin: string | null | undefined,
): string {
  let url: URL;
  try {
    url = new URL(previewUrl);
  } catch {
    return previewUrl;
  }
  const token = url.searchParams.get("token");
  if (url.pathname !== "/preview" || !token) return previewUrl;
  const query = new URLSearchParams({ site_id: siteId, token });
  const clean = pagePath.replace(/^\/+|\/+$/g, "");
  if (clean) query.set("path", clean);
  if (typeof frameOrigin === "string" && BUSINESS_PREVIEW_ORIGIN_PATTERN.test(frameOrigin)) query.set("fa", frameOrigin);
  return `${url.origin}/api/mingla/previews?${query.toString()}`;
}

/** The runtime origin the frame ends up on is not known in advance: post to "*" only token CSS (no secrets). */
export const PREVIEW_TOKENS_MESSAGE = "mingla:preview-tokens";
