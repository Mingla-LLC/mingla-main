import type { ArtifactV2, FooterSocialNetwork } from "../../contracts/generated/artifactV2.ts";
import { isSafeHref } from "../../contracts/generated/safety.ts";
import { ConsentControl } from "../../components/ConsentControl";
import { SiteLink } from "./parts";

/*
 * #2829 W7 — voyage's footer: a four-column grid (1.4fr 1fr 1fr 1fr from
 * 64rem), the tagline with its first line in the accent face, where the brand
 * is and its email, up to four columns of links, the social accounts as
 * 44 px circles, and a bottom bar with the copyright line and Mingla's
 * credit. Every word is the owner's except "Follow Us" over the socials and
 * "Powered by Mingla" (A1.1: every site shows it, in the place a builder's
 * credit would sit). A column the owner has not filled is not drawn.
 */

const SOCIAL_LABELS: Readonly<Record<FooterSocialNetwork, string>> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  facebook: "Facebook",
  x: "X",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  threads: "Threads",
  whatsapp: "WhatsApp",
};

/** 24×24 glyphs drawn by Mingla (no icon font, no third-party request). */
const SOCIAL_PATHS: Readonly<Record<FooterSocialNetwork, string>> = {
  tiktok: "M16.5 3a5.6 5.6 0 0 0 4 3.3v3a8.6 8.6 0 0 1-4-1.2v6.2a5.9 5.9 0 1 1-5.1-5.9v3.1a2.8 2.8 0 1 0 2 2.7V3h3.1Z",
  instagram: "M12 8.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8Zm0-2.2c1.9 0 2.1 0 2.9.05 2.1.1 3.1 1.1 3.2 3.2 0 .8.05 1 .05 2.9s0 2.1-.05 2.9c-.1 2.1-1.1 3.1-3.2 3.2-.8.05-1 .05-2.9.05s-2.1 0-2.9-.05c-2.1-.1-3.1-1.1-3.2-3.2C5.85 14.1 5.85 13.9 5.85 12s0-2.1.05-2.9c.1-2.1 1.1-3.1 3.2-3.2.8-.05 1-.05 2.9-.05Z",
  facebook: "M13.5 21v-8h2.7l.4-3.1h-3.1V7.9c0-.9.25-1.5 1.55-1.5h1.65V3.6A22 22 0 0 0 14.3 3.5c-2.4 0-4 1.45-4 4.1v2.3H7.6V13h2.7v8h3.2Z",
  x: "M17.8 3h3.1l-6.8 7.8L22 21h-6.3l-4.9-6.4L5.2 21H2.1l7.3-8.3L2 3h6.4l4.4 5.9L17.8 3Zm-1.1 16.2h1.7L7.4 4.7H5.6l11.1 14.5Z",
  youtube: "M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4A2.5 2.5 0 0 0 2.4 7.2 26 26 0 0 0 2 12a26 26 0 0 0 .4 4.8 2.5 2.5 0 0 0 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8A26 26 0 0 0 22 12a26 26 0 0 0-.4-4.8ZM10 15V9l5.2 3L10 15Z",
  linkedin: "M5.4 8.6H2.3V21h3.1V8.6ZM3.9 3a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6Zm17.8 10.9c0-3.3-.7-5.6-4.6-5.6-1.8 0-3 1-3.5 1.9V8.6h-3V21h3.1v-6.1c0-1.6.3-3.2 2.3-3.2s2 1.9 2 3.3v6h3.1v-7.1Z",
  threads: "M12 3a9 9 0 1 0 4.6 16.7l-1-1.7A7 7 0 1 1 19 12v.9c0 1-.6 1.6-1.4 1.6s-1.4-.6-1.4-1.6V8h-1.9v.8A4.3 4.3 0 0 0 12 7.7a4.3 4.3 0 1 0 3 7.4 3.2 3.2 0 0 0 2.6 1.3c1.9 0 3.4-1.5 3.4-3.5V12a9 9 0 0 0-9-9Zm0 11.4a2.4 2.4 0 1 1 0-4.8 2.4 2.4 0 0 1 0 4.8Z",
  whatsapp: "M12 3a9 9 0 0 0-7.8 13.5L3 21l4.6-1.2A9 9 0 1 0 12 3Zm4.4 12.6c-.2.5-1 1-1.5 1-.4.1-.9.1-1.5-.1a12 12 0 0 1-4.5-3.9 5 5 0 0 1-1.1-2.7c0-1.3.7-1.9.9-2.1.3-.3.6-.3.8-.3h.6c.2 0 .4 0 .6.5l.8 2c.1.2.1.4 0 .5l-.4.6-.4.4c-.1.1-.3.3-.1.6a7.6 7.6 0 0 0 3.8 3.3c.3.1.4.1.6-.1l.8-1c.2-.2.4-.2.6-.1l1.9.9c.2.1.4.2.4.3.1.1.1.6-.1 1.1Z",
};

function SocialGlyph({ network }: { network: FooterSocialNetwork }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
      <path d={SOCIAL_PATHS[network]} />
    </svg>
  );
}

const MINGLA_CREDIT_HREF = "https://usemingla.com/host";

/** The owner's copyright line with {year} (in the site's own time zone) and {site_name} filled in. */
export function copyrightLine(template: string, artifact: Pick<ArtifactV2, "timezone" | "brand">, now = new Date()): string {
  let year = String(now.getUTCFullYear());
  try {
    year = new Intl.DateTimeFormat("en-US", { timeZone: artifact.timezone || "UTC", year: "numeric" }).format(now);
  } catch {
    // An unknown zone keeps the UTC year.
  }
  return template.replaceAll("{year}", year).replaceAll("{site_name}", artifact.brand.display_name);
}

export function VoyageFooter({ artifact }: { artifact: ArtifactV2 }) {
  const footer = artifact.footer;
  const tagline = footer.tagline_lines ?? [];
  const columns = (footer.columns ?? []).filter((column) => column.links.length > 0);
  const socials = (footer.socials ?? []).filter((social) => isSafeHref(social.url));
  const copyright = footer.copyright ? copyrightLine(footer.copyright, artifact) : footer.legal_text ?? "";
  return (
    <footer className="site-footer on-dark v-footer">
      <div className="shell v-footer-grid">
        <div>
          {tagline.length ? (
            <p className="v-footer-tagline">
              {tagline.map((line, index) => <span key={index} className={index === 0 ? "footer-script" : "v-block"}>{line}</span>)}
            </p>
          ) : <p className="v-footer-tagline"><span className="v-block">{artifact.brand.display_name}</span></p>}
          {footer.location ? <p className="v-footer-location">{footer.location}</p> : null}
          {footer.email ? <a href={`mailto:${footer.email}`} className="footer-link v-footer-email">{footer.email}</a> : null}
        </div>
        {columns.map((column, index) => (
          <div key={`${column.heading}-${index}`}>
            <h2 className="footer-heading">{column.heading}</h2>
            <ul className="v-footer-list">
              {column.links.map((link, linkIndex) => (
                <li key={`${link.href}-${linkIndex}`}><SiteLink href={link.href} className="footer-link">{link.label}</SiteLink></li>
              ))}
            </ul>
          </div>
        ))}
        {socials.length ? (
          <div>
            <h2 className="footer-heading">Follow Us</h2>
            <ul className="v-footer-socials">
              {socials.map((social, index) => (
                <li key={`${social.network}-${index}`}>
                  <a href={social.url} target="_blank" rel="noopener noreferrer" aria-label={SOCIAL_LABELS[social.network]} className="footer-social">
                    <SocialGlyph network={social.network} />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      <div className="v-footer-bar">
        <div className="shell v-footer-bar__inner">
          <p>{copyright}</p>
          <div className="v-footer-bar__end">
            <ConsentControl siteId={artifact.site_id} brandId={artifact.brand_id} publicationId={artifact.publication_id} subject={artifact.brand.display_name} />
            <a href={MINGLA_CREDIT_HREF} target="_blank" rel="noopener noreferrer" className="footer-link footer-credit">
              Powered by Mingla<span className="sr-only"> (opens in a new tab)</span>
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
