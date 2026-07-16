/**
 * ISSUE-864 WP4 — AdPreview (SPEC §4.1): the sticky Facebook-style preview
 * rail. Updates on every keystroke (SC-6); empty fields render muted
 * placeholders so the frame never collapses. This is OUR mock — the real
 * platform previews (Meta GET /{ad_id}/previews etc.) need an endpoint that
 * doesn't exist yet (flags.API_AD_PREVIEWS_ENABLED).
 */

import { PUBLIC_WEB_ORIGIN } from "../../services/adDestinationsService";

export function AdPreview({ brandName, primary, headline, cta, imageUrl, destUrl }) {
  // QA P1-1: the placeholder host derives from the SAME origin constant the
  // destination URLs are built from — never a divergent literal.
  const fallbackHost = new URL(PUBLIC_WEB_ORIGIN).hostname.toUpperCase();
  const host = (() => {
    try {
      return destUrl ? new URL(destUrl).hostname.toUpperCase() : fallbackHost;
    } catch {
      return fallbackHost;
    }
  })();

  const muted = "text-[var(--color-text-tertiary)] italic";

  return (
    <div
      aria-label="Ad preview (Facebook mobile feed approximation)"
      className="bg-[var(--color-background-primary)] border border-[var(--gray-200)] rounded-xl overflow-hidden shadow-[var(--shadow-sm)]"
    >
      <div className="px-3 py-2 flex items-center gap-2 border-b border-[var(--gray-100)]">
        <div aria-hidden="true" className="w-8 h-8 rounded-full bg-[var(--color-brand-100)]" />
        <div>
          <p className="text-xs font-semibold">
            {brandName || <span className={muted}>Brand name</span>}
          </p>
          <p className="text-[10px] text-[var(--color-text-tertiary)]">Sponsored</p>
        </div>
      </div>
      <div className="px-3 py-2 text-xs whitespace-pre-wrap break-words min-h-8">
        {primary || <span className={muted}>Primary text appears here…</span>}
      </div>
      {imageUrl ? (
        <img src={imageUrl} alt="Ad creative" className="w-full aspect-square object-cover" />
      ) : (
        <div
          aria-hidden="true"
          className="w-full aspect-square bg-[var(--gray-100)] flex items-center justify-center text-xs text-[var(--color-text-tertiary)]"
        >
          Creative preview
        </div>
      )}
      <div className="px-3 py-2 flex items-center justify-between gap-2 bg-[var(--gray-50)]">
        <div className="min-w-0">
          <p className="text-[10px] text-[var(--color-text-tertiary)] truncate">{host}</p>
          <p className="text-xs font-semibold truncate">
            {headline || <span className={muted}>Headline</span>}
          </p>
        </div>
        <span className="shrink-0 text-[10px] font-semibold px-2.5 py-1.5 rounded-md bg-[var(--gray-200)] text-[var(--color-text-primary)]">
          {(cta || "LEARN_MORE").replaceAll("_", " ")}
        </span>
      </div>
    </div>
  );
}
