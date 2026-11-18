/*
 * #4453 milestone 11 — what a rendered page's own asset URLs (media, offering
 * covers, map squares, fonts) carry.
 *
 * The owner's private preview carries its preview key (`?k=`), which also opens
 * `/preview`. A share link must never carry that key anywhere it can be read
 * (HTML, image URLs, the RSC payload): its assets carry the share token itself
 * (`?s=`), which a share viewer already holds. The asset routes accept `?s=`
 * for that share's own media only, re-checked against Core on every lookup, so
 * it dies with the share. `/preview` never accepts it. A bare string is the
 * owner's preview key (the shape every owner-side caller already passes).
 */
export type AssetCredential = string | { readonly share: string };

/** The query (without `?` or `&`) an asset URL carries for this credential. */
export function assetQuery(credential: AssetCredential): string {
  return typeof credential === "string"
    ? `k=${encodeURIComponent(credential)}`
    : `s=${encodeURIComponent(credential.share)}`;
}
