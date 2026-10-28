import type { Metadata } from "next";
import { headers } from "next/headers";
import { loadPublication, requestHost, resolveHostSite } from "../lib/publication";
import { loadPreviewArtifact, parsePreviewArtifactKey, PREVIEW_KEY_HEADER } from "../lib/previewArtifact";
import { isV2Artifact, siteLanguageOf, type SiteArtifact } from "../lib/siteArtifact";
import { SHARE_TOKEN, SHARE_TOKEN_HEADER, sharedPreviewForRequest } from "../lib/shareLinks";

/*
 * #2829 — no brand-specific words here. Each page sets its own title from its
 * artifact; the language comes from the site's settings (default "en").
 */
export const metadata: Metadata = { robots: { index: true, follow: true } };

/*
 * #2829 W3 — the artifact this request renders: the private preview's draft
 * (proxy.ts forwards its key) or the host's active publication. Read here so
 * <html> can carry the site's language and its design, which scopes the
 * design stylesheet; any failure renders a bare document (the page decides
 * the 404).
 */
async function documentArtifact(): Promise<SiteArtifact | null> {
  try {
    const incoming = await headers();
    const host = requestHost(incoming);
    const previewKey = parsePreviewArtifactKey(incoming.get(PREVIEW_KEY_HEADER));
    if (previewKey) return await loadPreviewArtifact(previewKey, await resolveHostSite(host));
    // #2829 W10 — a private share-preview link renders the site's newest preview.
    const shareToken = incoming.get(SHARE_TOKEN_HEADER);
    if (shareToken && SHARE_TOKEN.test(shareToken)) return (await sharedPreviewForRequest(host, shareToken)).artifact;
    return (await loadPublication(host)).artifact;
  } catch {
    return null;
  }
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const artifact = await documentArtifact();
  const v2 = artifact && isV2Artifact(artifact) ? artifact : null;
  return (
    // #2829 W7 — a design's head script marks <html> (`.js`, `data-reveal-ready`)
    // before React hydrates; those marks are expected, not a mismatch.
    <html
      suppressHydrationWarning
      lang={artifact ? siteLanguageOf(artifact) : "en"}
      data-design={v2 ? v2.design.key : undefined}
      data-motion={v2 ? v2.tokens.motion : undefined}
    >
      <body>{children}</body>
    </html>
  );
}
