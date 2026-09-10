import type { StatsIcon } from "../contracts/artifact";

/*
 * #3149 wave 4 — SIX DRAWINGS THIS APP OWNS.
 *
 * The reference draws the icon on each of its cards with a third-party icon
 * font, naming glyphs out of a stylesheet loaded from a CDN. A published site
 * here cannot do that: it would be a request to a stranger on a page that
 * makes none, and a font that failed to arrive would leave four empty squares
 * where the meaning was.
 *
 * So the block carries a NAME from a closed list — the contract's STATS_ICONS
 * — and the drawing lives here, inline, in the brand's own accent colour. A
 * name that is not on the list never reaches this file: the artifact refuses
 * to publish it.
 *
 * Every one is `aria-hidden`. The icon repeats what the figure beside it
 * already says, and a screen reader reading "clock, open 24 hours" is reading
 * a decoration as content.
 */
const PATHS: Record<StatsIcon, React.ReactNode> = {
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5.2l3.4 2" />
    </>
  ),
  bowl: (
    <>
      <path d="M3 11.5h18a9 9 0 0 1-18 0Z" />
      <path d="M9 7.5c0-1.4 1.2-1.6 1.2-3" />
      <path d="M13.5 7.5c0-1.4 1.2-1.6 1.2-3" />
    </>
  ),
  music: (
    <>
      <circle cx="7" cy="17" r="2.6" />
      <circle cx="17.4" cy="14.8" r="2.6" />
      <path d="M9.6 17V6.4l10.4-2.2v10.6" />
    </>
  ),
  card: (
    <>
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="M3 10.5h18" />
      <path d="M6.5 14.5h4" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21.2s6.8-6.1 6.8-10.6a6.8 6.8 0 1 0-13.6 0C5.2 15.1 12 21.2 12 21.2Z" />
      <circle cx="12" cy="10.4" r="2.5" />
    </>
  ),
  phone: (
    <path d="M7.2 3.5 9 3.2a1 1 0 0 1 1.1.6l1.2 2.9a1 1 0 0 1-.3 1.2l-1.4 1a12.4 12.4 0 0 0 5.5 5.5l1-1.4a1 1 0 0 1 1.2-.3l2.9 1.2a1 1 0 0 1 .6 1.1l-.3 1.8a1.6 1.6 0 0 1-1.6 1.4A16.4 16.4 0 0 1 5.8 5.1a1.6 1.6 0 0 1 1.4-1.6Z" />
  ),
};

export function StatIcon({ name }: { name: StatsIcon }) {
  return (
    <svg
      className="stat-icon"
      viewBox="0 0 24 24"
      width="28"
      height="28"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
