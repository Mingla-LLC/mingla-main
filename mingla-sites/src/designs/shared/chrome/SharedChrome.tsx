/* eslint-disable @next/next/no-img-element -- the logo is the site's own first-party, immutable media. */
import type { ArtifactV2 } from "../../../contracts/generated/artifactV2.ts";
import { HEADER_INLINE_CAPACITY, type FooterVariant, type HeaderVariant } from "../../../contracts/generated/designs.ts";
import { isSafeHref } from "../../../contracts/generated/safety.ts";
import { ConsentControl } from "../../../components/ConsentControl";
import { copyrightLine, SOCIAL_LABELS, SocialGlyph } from "../../voyage/VoyageFooter";
import { Arrow, Go, MinglaNote } from "../parts";
import { MoreMenu, PhoneMenu, ScrollState } from "./HeaderClient";

/*
 * #4453 §3.3 + v2.1 §1.4 — the shared header (`glass`, `center`, `pill`) and
 * footer (`giant`, `columns`).
 *
 * Header capacity: each variant shows HEADER_INLINE_CAPACITY items inline at
 * ≥ 1280 px and one less from 1100 to 1279 px; the rest sit under "More".
 * Below 1100 px the inline menu hides and the menu button opens the phone
 * menu. The split is CSS container queries over `data-cap` (no measuring,
 * no layout shift). Stored menus keep their order (M1).
 *
 * #4453 6b — two signature headers draw on the same bar, menu, "More" and
 * phone menu: `journal-mast` adds a dateline strip (the site's place) above
 * the bar and its stylesheet sets the nameplate on its own row; `grid-bar`
 * numbers each top-level item (01, 02 …, hidden from assistive tech). Their
 * look lives in the design's own stylesheet (`jr-` / `gr-` classes).
 *
 * Active state: exactly one top-level item is `aria-current="page"`, the one
 * whose href is the longest prefix of the current path; a page under "More"
 * lights "More" and its child. Home lights nothing; the wordmark is Home.
 */

export type ChromeNavItem = { label: string; href: string; children?: Array<{ label: string; href: string }> };

/**
 * #4453 final rework (Lighthouse link-text, SEO) — an owner's menu group
 * titled "More" (or another generic word) linking to a page reads, to search
 * engines and screen readers, as a link with no meaning. The visible label
 * stays the owner's; the link also carries the name of the page it opens,
 * taken from the owner's own sub-menu (only the child with the same address,
 * so the hidden name always matches the page the link opens), as visually
 * hidden text. No such child: no suffix. Never invented.
 */
const GENERIC_LINK_TEXT = new Set(["more", "read more", "learn more", "see more", "view more", "click here", "here", "details", "info", "more info"]);

export function descriptiveSuffix(item: ChromeNavItem): string | null {
  if (!GENERIC_LINK_TEXT.has(item.label.trim().toLowerCase())) return null;
  const children = item.children ?? [];
  const named = children.find((child) => child.href === item.href);
  const name = named?.label.trim();
  return name && !GENERIC_LINK_TEXT.has(name.toLowerCase()) ? name : null;
}

/** The owner's label, plus the page name for a generic one (visually hidden). */
function NavLabel({ item }: { item: ChromeNavItem }) {
  const suffix = descriptiveSuffix(item);
  return <>{item.label}{suffix ? <span className="mg-vh">{`: ${suffix}`}</span> : null}</>;
}

function prefixScore(href: string, path: string): number {
  if (!href.startsWith("/")) return -1;
  if (href === "/") return path === "/" ? 0 : -1;
  return path === href || path.startsWith(`${href}/`) ? href.length : -1;
}

/** The index of the current top-level item (longest prefix of the path), or -1 (Home lights nothing). */
export function activeIndex(items: readonly ChromeNavItem[], path: string): number {
  let best = -1;
  let bestScore = 0;
  items.forEach((item, index) => {
    const score = Math.max(prefixScore(item.href, path), ...(item.children ?? []).map((child) => prefixScore(child.href, path)));
    if (score > bestScore) {
      best = index;
      bestScore = score;
    }
  });
  return best;
}

export function SharedHeader({ variant, items, path, logo, siteName, cta, place }: {
  variant: HeaderVariant;
  items: readonly ChromeNavItem[];
  path: string;
  logo: { url: string; width?: number; height?: number } | null;
  siteName: string;
  cta: { label: string; href: string } | null;
  place?: string;
}) {
  const capacity = HEADER_INLINE_CAPACITY[variant];
  const active = activeIndex(items, path);
  // Items from index capacity-1 may fold (1100–1279 px); only build "More" when something can fold.
  const foldable = items.length > capacity - 1;
  const link = (item: ChromeNavItem, index: number, inMore: boolean) => {
    const current = index === active;
    return (
      <li key={`${item.href}-${index}`} className="mg-nav__li" data-i={index} data-current={current ? "true" : undefined}>
        <Go href={item.href} className="mg-nav__a" aria-current={current ? "page" : undefined}>
          {variant === "grid-bar" && !inMore ? <small className="gr-n" aria-hidden="true">{String(index + 1).padStart(2, "0")}</small> : null}
          <NavLabel item={item} />
        </Go>
        {item.children?.length ? (
          <ul className={inMore ? "mg-nav__sub mg-nav__sub--inline" : "mg-nav__sub"}>
            {item.children.map((child, childIndex) => (
              <li key={`${child.href}-${childIndex}`}><Go href={child.href} className="mg-nav__a" aria-current={child.href === path ? "page" : undefined}>{child.label}</Go></li>
            ))}
          </ul>
        ) : null}
      </li>
    );
  };
  const wordmark = (
    <Go href="/" className="mg-mark" aria-label={`${siteName}, home`}>
      {logo && isSafeHref(logo.url) ? <img src={logo.url} alt="" width={logo.width} height={logo.height} /> : <span>{siteName}</span>}
    </Go>
  );
  const ctaButton = cta && isSafeHref(cta.href) ? <Go href={cta.href} className="mg-btn mg-hd__cta"><span>{cta.label}</span><Arrow /></Go> : null;
  return (
    <header className={`mg-hd mg-hd--${variant}`} data-mg-header="" data-cap={capacity}>
      <ScrollState />
      {variant === "journal-mast" && place ? <div className="jr-dateline"><div className="mg-wrap"><p>{place}</p></div></div> : null}
      <div className="mg-wrap mg-hd__wrap">
        <div className="mg-hd__bar">
          {variant !== "center" ? wordmark : null}
          <nav aria-label="Main" className="mg-nav">
            <ul className="mg-nav__ul">
              {items.map((item, index) => link(item, index, false))}
              {foldable ? (
                <MoreMenu current={active >= capacity - 1}>
                  {items.map((item, index) => (index >= capacity - 1 ? link(item, index, true) : null))}
                </MoreMenu>
              ) : null}
            </ul>
          </nav>
          {variant === "center" ? wordmark : null}
          <div className="mg-hd__end">
            {ctaButton}
            <PhoneMenu>
              <ol className="mg-pmenu__list">
                <li data-current={active < 0 && path === "/" ? "true" : undefined}><Go href="/" aria-current={path === "/" ? "page" : undefined}><span className="mg-pmenu__n">01</span>Home</Go></li>
                {items.map((item, index) => (
                  <li key={`${item.href}-${index}`} data-current={index === active ? "true" : undefined}>
                    <Go href={item.href} aria-current={index === active ? "page" : undefined}><span className="mg-pmenu__n">{String(index + 2).padStart(2, "0")}</span><NavLabel item={item} /></Go>
                    {item.children?.length ? (
                      <ul>{item.children.map((child, childIndex) => <li key={childIndex}><Go href={child.href}>{child.label}</Go></li>)}</ul>
                    ) : null}
                  </li>
                ))}
              </ol>
              <div className="mg-pmenu__foot">
                {ctaButton}
                <MinglaNote />
                {place ? <p className="mg-pmenu__place">{place}</p> : null}
              </div>
            </PhoneMenu>
          </div>
        </div>
      </div>
    </header>
  );
}

const MINGLA_CREDIT_HREF = "https://usemingla.com/host";

/**
 * The shared footer: the owner's columns when set (an owner-set footer wins),
 * else Visit, Pages (Home and every menu item, children included, at most 8),
 * Follow, and Mingla. `giant` adds the brand's name set huge.
 */
export function SharedFooter({ variant, artifact, items }: { variant: FooterVariant; artifact: ArtifactV2; items: readonly ChromeNavItem[] }) {
  const footer = artifact.footer;
  const owner = (footer.columns ?? []).filter((column) => column.links.length > 0);
  // #4453 final rework — a generic group label ("More") whose page is already
  // one of its children is not repeated as its own "More" link.
  const pages = [{ label: "Home", href: "/" }, ...items.flatMap((item) => [
    ...(descriptiveSuffix(item) && (item.children ?? []).some((child) => child.href === item.href) ? [] : [{ label: item.label, href: item.href }]),
    ...(item.children ?? []),
  ])].slice(0, 8);
  const socials = (footer.socials ?? []).filter((social) => isSafeHref(social.url));
  const copyright = footer.copyright ? copyrightLine(footer.copyright, artifact) : footer.legal_text ?? `© ${artifact.brand.display_name}`;
  const visit = [footer.location, footer.address, footer.hours_summary].filter((line): line is string => Boolean(line));
  return (
    <footer className={`mg-foot mg-foot--${variant}`}>
      <div className="mg-wrap">
        <div className="mg-fcols">
          {visit.length || footer.email ? (
            <div>
              <h2 className="mg-fcols__h">Visit</h2>
              <ul>
                {visit.map((line, index) => <li key={index}>{line}</li>)}
                {footer.email ? <li><a href={`mailto:${footer.email}`}>{footer.email}</a></li> : null}
              </ul>
            </div>
          ) : null}
          {owner.length ? owner.map((column, index) => (
            <div key={`${column.heading}-${index}`}>
              <h2 className="mg-fcols__h">{column.heading}</h2>
              <ul>{column.links.map((link, linkIndex) => <li key={linkIndex}><Go href={link.href}>{link.label}</Go></li>)}</ul>
            </div>
          )) : (
            <div>
              <h2 className="mg-fcols__h">Pages</h2>
              <ul>{pages.map((link, index) => <li key={index}><Go href={link.href}>{link.label}</Go></li>)}</ul>
            </div>
          )}
          {socials.length ? (
            <div>
              <h2 className="mg-fcols__h">Follow</h2>
              <ul className="mg-socials">
                {socials.map((social) => (
                  <li key={social.network}><a href={social.url} target="_blank" rel="noopener noreferrer"><SocialGlyph network={social.network} /><span>{SOCIAL_LABELS[social.network]}</span></a></li>
                ))}
              </ul>
            </div>
          ) : null}
          <div>
            <h2 className="mg-fcols__h">Mingla</h2>
            <ul>
              <li><a href={MINGLA_CREDIT_HREF} target="_blank" rel="noopener noreferrer">Powered by Mingla<span className="mg-sr"> (opens in a new tab)</span></a></li>
            </ul>
          </div>
        </div>
        {variant === "giant" ? <p className="mg-giant" aria-hidden="true">{artifact.brand.display_name}</p> : null}
        <div className="mg-legal">
          <span>{copyright}</span>
          <ConsentControl siteId={artifact.site_id} brandId={artifact.brand_id} publicationId={artifact.publication_id} subject={artifact.brand.display_name} />
          <MinglaNote>Bookings and payments by Mingla</MinglaNote>
        </div>
      </div>
    </footer>
  );
}
