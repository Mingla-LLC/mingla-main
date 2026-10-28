"use client";
/* eslint-disable @next/next/no-img-element -- the logo is the site's own first-party, immutable media. */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from "react";

/*
 * #2829 W7 — voyage's header.
 *
 * - Sticky, 64 px (76 px from 48rem). Its ground is a layer (::before) so the
 *   mobile drawer can still fill the viewport.
 * - TRANSPARENT over a full-viewport cover while the page is at the top: the
 *   stylesheet keys that off `html.js`, `data-stuck="false"` and a `.cover`
 *   inside #main, so the first paint is right with no flash, a page without a
 *   cover (the 404) keeps the solid bar, and a dead bundle falls back to the
 *   solid bar. `data-stuck` flips at scrollY > 8; the swap is instant (a
 *   cross-fade between two grounds of opposite polarity is unreadable).
 * - A nav item with children is a real disclosure: click/Enter/Space toggle,
 *   ArrowDown/ArrowUp open and move, Home/End, Escape closes and returns
 *   focus, Tab out or a press outside closes; pointer hover opens after
 *   100 ms and closes after 220 ms. Without JavaScript the stylesheet keeps
 *   hover/focus-within opening it.
 * - Below 64rem the menu is a native <details> drawer (works with no
 *   JavaScript); with JavaScript it gains a scrim, a close button, a focus
 *   trap, `inert` on the page behind, a scroll lock and Escape.
 */

export type VoyageNavChild = { label: string; href: string };
export type VoyageNavItem = { label: string; href: string; children?: VoyageNavChild[] };
export type VoyageLogo = { url: string; width: number; height: number } | null;

function isCurrent(pathname: string, href?: string | null): boolean {
  if (!href || !href.startsWith("/")) return false;
  const clean = href.replace(/\/+$/, "") || "/";
  return (pathname.replace(/\/+$/, "") || "/") === clean;
}

/**
 * The wordmark: the name as written, with any "&" set in the accent face.
 * The three parts concatenate to exactly the name, so the link's accessible
 * name is unchanged.
 */
export function wordmark(name: string): ReactNode {
  const at = name.indexOf("&");
  if (at < 0) return name;
  return (
    <>
      {name.slice(0, at)}
      <span className="amp">&amp;</span>
      {name.slice(at + 1)}
    </>
  );
}

function Chevron() {
  return (
    <svg className="nav-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

function CloseGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function NavDisclosure({ item, pathname }: { item: VoyageNavItem; pathname: string }) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const children = item.children ?? [];

  const clearTimers = useCallback(() => {
    if (openTimer.current) clearTimeout(openTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    openTimer.current = null;
    closeTimer.current = null;
  }, []);
  useEffect(() => clearTimers, [clearTimers]);

  // A panel left open across a navigation is a ghost.
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setOpen(false);
  }

  const close = useCallback((returnFocus: boolean) => {
    clearTimers();
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, [clearTimers]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close(true);
      }
    };
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open, close]);

  const items = () => Array.from(rootRef.current?.querySelectorAll<HTMLAnchorElement>("[data-nav-item]") ?? []);
  const focusItem = (index: number) => {
    const list = items();
    if (!list.length) return;
    list[((index % list.length) + list.length) % list.length]?.focus();
  };

  // The panel becomes visible over its first frames (visibility transition),
  // so focus moves on the frame after next, when it can take focus.
  const focusWhenOpen = (index: number) => requestAnimationFrame(() => requestAnimationFrame(() => focusItem(index)));

  const onTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      focusWhenOpen(0);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      focusWhenOpen(-1);
    }
  };

  const onPanelKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const list = items();
    const index = list.indexOf(document.activeElement as HTMLAnchorElement);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusItem(index + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusItem(index - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusItem(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusItem(-1);
    }
  };

  const onBlurCapture = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget as Node | null;
    if (!next || rootRef.current?.contains(next)) return;
    setOpen(false);
  };

  const canHover = () => typeof window.matchMedia === "function" && window.matchMedia("(hover: hover)").matches;
  const pointerOpen = () => {
    if (!canHover()) return;
    clearTimers();
    openTimer.current = setTimeout(() => setOpen(true), 100);
  };
  const pointerClose = () => {
    if (!canHover()) return;
    clearTimers();
    closeTimer.current = setTimeout(() => setOpen(false), 220);
  };

  return (
    <div ref={rootRef} className="nav-disclosure" onPointerEnter={pointerOpen} onPointerLeave={pointerClose} onBlurCapture={onBlurCapture}>
      <button
        ref={triggerRef}
        type="button"
        className="nav-link"
        aria-expanded={open}
        aria-controls={panelId}
        aria-haspopup="true"
        onClick={() => setOpen((was) => !was)}
        onKeyDown={onTriggerKeyDown}
      >
        {item.label}
        <Chevron />
      </button>
      <div id={panelId} className="nav-panel on-light" data-open={open} onKeyDown={onPanelKeyDown}>
        {children.map((child, index) => (
          <Link
            key={`${child.href}-${index}`}
            data-nav-item=""
            href={child.href}
            className="nav-item"
            tabIndex={open ? undefined : -1}
            aria-current={isCurrent(pathname, child.href) ? "page" : undefined}
            onClick={() => setOpen(false)}
          >
            {child.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

export function MobileDrawer({ items, pathname, logo, siteName }: { items: VoyageNavItem[]; pathname: string; logo: VoyageLogo; siteName: string }) {
  const [open, setOpen] = useState(false);
  // <details> drops its children the instant `open` flips off; `mounted`
  // keeps it open for the exit slide (instant under reduced motion).
  const [mounted, setMounted] = useState(false);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panelId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const summaryRef = useRef<HTMLElement>(null);

  const setDrawer = useCallback((next: boolean) => {
    if (exitTimer.current) clearTimeout(exitTimer.current);
    if (next) {
      setMounted(true);
      requestAnimationFrame(() => setOpen(true));
      return;
    }
    setOpen(false);
    const instant = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (instant) {
      setMounted(false);
      return;
    }
    exitTimer.current = setTimeout(() => setMounted(false), 250);
  }, []);

  useEffect(() => () => {
    if (exitTimer.current) clearTimeout(exitTimer.current);
  }, []);

  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setOpen(false);
    setMounted(false);
  }

  const close = useCallback((returnFocus: boolean) => {
    setDrawer(false);
    if (returnFocus) summaryRef.current?.focus();
  }, [setDrawer]);

  useEffect(() => {
    if (!open) return;
    const body = document.body;
    const previousOverflow = body.style.overflow;
    body.style.overflow = "hidden";
    // The page behind a modal drawer is out of reach for Tab and screen readers.
    const behind = [document.getElementById("main"), document.querySelector("footer.site-footer")]
      .filter((element): element is HTMLElement => Boolean(element));
    for (const element of behind) element.setAttribute("inert", "");
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close(true);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])');
      if (!focusable?.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    requestAnimationFrame(() => panelRef.current?.querySelector<HTMLElement>("a[href], button")?.focus());
    return () => {
      document.removeEventListener("keydown", onKey);
      body.style.overflow = previousOverflow;
      for (const element of behind) element.removeAttribute("inert");
    };
  }, [open, close]);

  // A parent with children contributes its children; one without, itself.
  const links = items.flatMap((item) => (item.children?.length ? item.children : [{ label: item.label, href: item.href }]));

  return (
    <details
      className="v-drawer"
      open={mounted}
      onToggle={(event) => {
        const isOpen = (event.currentTarget as HTMLDetailsElement).open;
        if (isOpen !== mounted) setDrawer(isOpen);
      }}
    >
      <summary
        ref={summaryRef as RefObject<HTMLElement>}
        className="btn btn--icon v-drawer__toggle"
        tabIndex={0}
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        aria-controls={panelId}
      >
        {open ? <CloseGlyph /> : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        )}
      </summary>
      <div className="drawer-scrim" data-open={open} aria-hidden="true" onClick={() => close(false)} />
      <div id={panelId} ref={panelRef} className="drawer-panel on-light" data-open={open}>
        <div className="v-drawer__head">
          <Link href="/" className="logo-lockup" aria-label={`${siteName} — home`} onClick={() => close(false)}>
            {logo ? <img src={logo.url} alt="" width={36} height={36} /> : <span>{wordmark(siteName)}</span>}
          </Link>
          <button type="button" className="btn btn--icon drawer-close" aria-label="Close menu" onClick={() => close(true)}>
            <CloseGlyph />
          </button>
        </div>
        {links.map((link, index) => (
          <Link key={`${link.href}-${index}`} href={link.href} className="drawer-item" aria-current={isCurrent(pathname, link.href) ? "page" : undefined}>
            {link.label}
          </Link>
        ))}
      </div>
    </details>
  );
}

export function VoyageHeader({ items, logo, siteName, cta }: {
  items: VoyageNavItem[];
  logo: VoyageLogo;
  siteName: string;
  cta: { label: string; href: string } | null;
}) {
  const pathname = usePathname() ?? "/";
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    const onScroll = () => setStuck(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className="site-header" data-stuck={stuck}>
      <div className="shell v-header__inner">
        <Link href="/" className="logo-lockup">
          {logo ? <img src={logo.url} alt="" width={34} height={34} /> : null}
          <span>{wordmark(siteName)}</span>
        </Link>
        <nav aria-label="Main" className="v-nav">
          {items.map((item, index) =>
            item.children?.length ? (
              <NavDisclosure key={`${item.label}-${index}`} item={item} pathname={pathname} />
            ) : (
              <Link key={`${item.href}-${index}`} href={item.href} className="nav-link" aria-current={isCurrent(pathname, item.href) ? "page" : undefined}>
                {item.label}
              </Link>
            ))}
        </nav>
        {cta ? (
          <Link href={cta.href} className="btn btn--primary btn--sm v-header-cta">
            {cta.label}
            <span className="btn__ic" aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
              </svg>
            </span>
          </Link>
        ) : null}
        <MobileDrawer items={items} pathname={pathname} logo={logo} siteName={siteName} />
      </div>
    </header>
  );
}
