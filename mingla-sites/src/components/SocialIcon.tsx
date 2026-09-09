/*
 * #3149 wave 4 — the round buttons in the footer's first column.
 *
 * Same rule as the stat cards' drawings, for the same reasons: an icon that
 * arrived as markup is a script tag waiting to happen, and one that arrived as
 * a URL is a third-party request on a page that makes none. These are drawings
 * this app ships.
 *
 * THE ICON IS DERIVED FROM THE DESTINATION, never typed beside it. A brand
 * types a link; the scheme or the host says what it is. That way a footer can
 * never show a WhatsApp badge over a link to somewhere else, and a brand that
 * publishes no WhatsApp number simply gets no WhatsApp button — nothing is
 * invented to fill the row out to three.
 */
export const SOCIAL_ICONS = ["instagram", "whatsapp", "phone"] as const;

export type SocialIcon = (typeof SOCIAL_ICONS)[number];

const PATHS: Record<SocialIcon, React.ReactNode> = {
  instagram: (
    <>
      <rect x="3.2" y="3.2" width="17.6" height="17.6" rx="5" />
      <circle cx="12" cy="12" r="4.1" />
      <circle cx="17.2" cy="6.8" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
  whatsapp: (
    <>
      <path d="M20.2 11.7a8.2 8.2 0 0 1-12.2 7.2L3.8 20.2l1.3-4.1a8.2 8.2 0 1 1 15.1-4.4Z" />
      <path d="M9.1 8.4c.6-.1.9 0 1.1.5l.6 1.4a.8.8 0 0 1-.2.9l-.5.5a6 6 0 0 0 2.8 2.8l.5-.5a.8.8 0 0 1 .9-.2l1.4.6c.5.2.6.5.5 1.1a1.7 1.7 0 0 1-1.7 1.2 8.6 8.6 0 0 1-6.6-6.6A1.7 1.7 0 0 1 9.1 8.4Z" />
    </>
  ),
  phone: (
    <path d="M7.2 3.5 9 3.2a1 1 0 0 1 1.1.6l1.2 2.9a1 1 0 0 1-.3 1.2l-1.4 1a12.4 12.4 0 0 0 5.5 5.5l1-1.4a1 1 0 0 1 1.2-.3l2.9 1.2a1 1 0 0 1 .6 1.1l-.3 1.8a1.6 1.6 0 0 1-1.6 1.4A16.4 16.4 0 0 1 5.8 5.1a1.6 1.6 0 0 1 1.4-1.6Z" />
  ),
};

/*
 * Which drawing a link deserves, or null for a link that is simply a link.
 *
 * Host-matched rather than substring-matched: `instagram.com.example.net` is
 * not Instagram, and a footer that believed it was would put a brand's badge
 * on a stranger's domain.
 */
export function socialIconFor(href: string): SocialIcon | null {
  if (href.startsWith("tel:")) return "phone";
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "instagram.com") return "instagram";
  if (host === "wa.me" || host === "api.whatsapp.com" || host === "whatsapp.com") {
    return "whatsapp";
  }
  return null;
}

export function SocialGlyph({ name }: { name: SocialIcon }) {
  return (
    <svg
      className="social-icon"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
