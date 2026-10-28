"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";

export interface SiteNavLink {
  label: string;
  href: string;
  current: boolean;
  /** #2829 W2 — up to eight dropdown links (no grandchildren). */
  children?: Array<Omit<SiteNavLink, "children">>;
}

/*
 * #2830 — the site navigation, and on phones the only way to reach any page.
 *
 * The mobile nav used to be `display: none` with no control anywhere to reveal
 * it. At two pages that was survivable because the hero CTA covered it; the
 * moment the seed adds a Menu page it hides the single thing most visitors came
 * for, on the surface most of them use.
 *
 * Every link is in the server-rendered HTML whether the panel is open or not,
 * so crawlers and "find in page" see the whole navigation.
 */
export function SiteNav({ links }: { links: SiteNavLink[] }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      close();
      // Escape must land the caret back where it started, not nowhere.
      buttonRef.current?.focus();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      close();
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, close]);

  useEffect(() => {
    // Moving focus into the panel is what makes this usable with a keyboard or
    // a screen reader; without it the panel opens somewhere the user is not.
    if (open) panelRef.current?.querySelector("a")?.focus();
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="nav-burger"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={open ? "Close menu" : "Menu"}
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true" className={open ? "burger-bars open" : "burger-bars"}>
          <span />
          <span />
          <span />
        </span>
      </button>
      <div
        id={panelId}
        ref={panelRef}
        className={open ? "nav-panel open" : "nav-panel"}
        data-open={open ? "true" : "false"}
      >
        <nav aria-label="Main navigation">
          {links.map((link) =>
            link.children?.length ? (
              /*
               * #2829 W2 — a menu item with dropdown children. The parent
               * stays a real link; the children are an ordinary list that is
               * always in the HTML (crawlers, find-in-page, no-JS), shown on
               * hover or keyboard focus on wide screens and indented in the
               * phone panel. An item without children renders exactly as it
               * always has.
               */
              <div className="nav-group" key={link.href}>
                <Link
                  href={link.href}
                  aria-current={link.current ? "page" : undefined}
                  onClick={close}
                >
                  {link.label}
                </Link>
                <ul className="nav-children" aria-label={`${link.label} pages`}>
                  {link.children.map((child) => (
                    <li key={child.href}>
                      <Link
                        href={child.href}
                        aria-current={child.current ? "page" : undefined}
                        onClick={close}
                      >
                        {child.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <Link
                key={link.href}
                href={link.href}
                aria-current={link.current ? "page" : undefined}
                onClick={close}
              >
                {link.label}
              </Link>
            ))}
        </nav>
      </div>
    </>
  );
}
