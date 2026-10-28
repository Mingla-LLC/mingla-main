import type { Metadata } from "next";
import { headers } from "next/headers";
import { SiteDocument } from "../components/v2/SiteDocument";
import { loadPublication, requestHost } from "../lib/publication";
import { isV2Artifact } from "../lib/siteArtifact";
import { DESIGN_RENDERERS } from "../designs/registry";
import type { ArtifactV2 } from "../contracts/generated/artifactV2.ts";

// #2829 — an unknown or unavailable host gets a generic page: no brand data,
// never indexed.
export const metadata: Metadata = {
  title: "Website not available",
  robots: { index: false, follow: false },
};

/*
 * #2829 W3 — the generic page carries its own few rules: the stylesheets are
 * per design now (public/designs/*), and an unknown host has no design.
 */
const NOT_FOUND_CSS =
  "body{margin:0;background:#101013;color:#f0eee9;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;line-height:1.55}" +
  ".not-found{min-height:100vh;display:grid;place-items:center;padding:2rem}.not-found>div{max-width:560px}" +
  ".not-found .eyebrow{text-transform:uppercase;letter-spacing:.18em;font-size:.75rem;color:#cda052}";

/*
 * #2829 W7 — a published site's own 404: an address this host's site does
 * not have gets the site's design (header, its 404 page, footer). Any
 * failure, an unknown host or a v1 site gets the generic page.
 */
async function siteFor404(): Promise<{ artifact: ArtifactV2; nonce?: string } | null> {
  try {
    const incoming = await headers();
    const { artifact } = await loadPublication(requestHost(incoming));
    return isV2Artifact(artifact) && DESIGN_RENDERERS[artifact.design.key]?.drawsNotFound
      ? { artifact, nonce: incoming.get("x-nonce") ?? undefined }
      : null;
  } catch {
    return null;
  }
}

export default async function NotFound() {
  const site = await siteFor404();
  if (site) return <SiteDocument artifact={site.artifact} nonce={site.nonce} notFound />;
  return <main className="not-found"><style>{NOT_FOUND_CSS}</style><div><p className="eyebrow">Mingla Sites</p><h1>This website isn’t available.</h1><p>Check the address or try again later.</p></div></main>;
}
