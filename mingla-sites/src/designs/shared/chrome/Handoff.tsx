"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type MouseEvent, type ReactNode } from "react";
import { bookingBarHref, type BookingBarValues, type BookingTarget } from "../../../contracts/generated/availability.ts";
import { analyticsAllowed, sendSiteEvent, siteHandoffHref, type SiteEventContext } from "../../../lib/clientAnalytics";

/*
 * #4453 milestone 5 (spec v2 §5.8) — the checkout hand-off.
 *
 * Every Mingla action is a real `<a href="https://host.usemingla.com/...">`.
 * With JavaScript, a tap opens a small sheet (the item, the date or slot,
 * "From {price}" only from live data, "Continue in Mingla", "Booked through
 * Mingla"); with JavaScript off the link simply goes there. The sheet never
 * takes payment details or an email and never holds a slot. It is a real
 * dialog: focus moves in, Tab stays inside, Escape closes, and focus returns
 * to the link that opened it. Continue opens Mingla in the same tab with the
 * site's mc_click attribution; in the private preview it opens the real
 * Mingla page in a new tab and says so. Nothing is booked by previewing.
 */
export type HandoffDetail = {
  href: string;
  item: string;
  when?: string;
  from?: string;
  ctaKind: "offering" | "reservation" | "checkout";
};

const OPEN_EVENT = "mg:handoff";

function openHandoff(detail: HandoffDetail): void {
  window.dispatchEvent(new CustomEvent<HandoffDetail>(OPEN_EVENT, { detail }));
}

function plainClick(event: MouseEvent): boolean {
  return !event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

/** A Mingla booking link that opens the hand-off sheet (a plain link without JavaScript). */
export function HandoffLink({ detail, className, children, label }: { detail: HandoffDetail; className?: string; children: ReactNode; label?: string }) {
  return (
    <a
      href={detail.href}
      className={className}
      aria-label={label}
      data-mg-handoff=""
      data-mingla-tracked="1"
      onClick={(event) => {
        if (!plainClick(event)) return;
        event.preventDefault();
        openHandoff(detail);
      }}
    >
      {children}
    </a>
  );
}

/**
 * The hero booking bar's form. Without JavaScript it is a plain GET to the
 * target's own Mingla page (the CSP allows host.usemingla.com as a form
 * action); with it, the pre-fill URL is built from the contract (bad values
 * dropped) and handed to the sheet. No availability call on submit.
 */
export function HeroBookingForm({ target, children, submitLabel, from }: { target: BookingTarget; children: ReactNode; submitLabel: string; from?: string }) {
  const tab = target.kind === "venue_table" ? "book" : target.kind === "stay" ? "stay" : null;
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const values: BookingBarValues = {};
    for (const name of ["date", "time", "party", "checkin", "checkout", "guests"] as const) {
      const value = data.get(name);
      if (typeof value === "string" && value) values[name] = value;
    }
    const when = [values.date ?? values.checkin, values.time, values.checkout ? `to ${values.checkout}` : ""].filter(Boolean).join(" ");
    openHandoff({ href: bookingBarHref(target, values), item: target.title, when: when || undefined, from, ctaKind: target.kind === "venue_table" ? "reservation" : "checkout" });
  };
  return (
    <form action={target.base_url} method="get" className="mg-bk mg-bk--book" aria-label={`Book ${target.title} on Mingla`} onSubmit={onSubmit} data-mg-in="">
      {tab ? <input type="hidden" name="tab" value={tab} /> : null}
      {children}
      <button type="submit" className="mg-btn mg-btn--accent"><span>{submitLabel}</span></button>
    </form>
  );
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The one hand-off sheet a page mounts. `preview` is decided on the server
 * from the artifact being rendered (ctx.preview, #4453 milestone 3 fix), never
 * from a browser-only API during render.
 */
export function MinglaHandoff({ context, preview = false }: { context: SiteEventContext; preview?: boolean }) {
  const [detail, setDetail] = useState<HandoffDetail | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const onOpen = (event: Event) => {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setDetail((event as CustomEvent<HandoffDetail>).detail);
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  const close = useCallback(() => {
    setDetail(null);
    const back = opener.current;
    opener.current = null;
    // Focus returns to what opened the sheet (after the sheet unmounts).
    window.setTimeout(() => back?.focus(), 0);
  }, []);

  useEffect(() => {
    if (!detail) {
      delete document.documentElement.dataset.mgHandoff;
      return;
    }
    document.documentElement.dataset.mgHandoff = "open";
    const node = dialog.current;
    node?.querySelector<HTMLElement>("[data-mg-handoff-go]")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab" || !node) return;
      const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (!items.length) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (!node.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      // Never leave the page marked "sheet open" (the sticky bar reads it).
      delete document.documentElement.dataset.mgHandoff;
    };
  }, [detail, close]);

  const go = async (event: MouseEvent<HTMLAnchorElement>) => {
    if (!detail || !plainClick(event)) return;
    if (preview) return; // the preview link opens the real page in a new tab (target=_blank)
    event.preventDefault();
    const target = siteHandoffHref(detail.href);
    if (analyticsAllowed()) {
      await sendSiteEvent(context, detail.ctaKind === "offering" ? "book_click" : "cta_click", {
        cta_kind: detail.ctaKind,
        page_path: window.location.pathname,
      });
    }
    window.location.assign(target);
  };

  if (!detail) return null;
  return (
    <div className="mg-handoff" data-mg-handoff-layer="">
      <div className="mg-handoff__scrim" aria-hidden="true" onClick={close} />
      <div ref={dialog} className="mg-handoff__sheet" role="dialog" aria-modal="true" aria-labelledby="mg-handoff-title" aria-describedby="mg-handoff-note">
        <p className="mg-label">Booked through Mingla</p>
        <h2 id="mg-handoff-title" className="mg-handoff__title">{detail.item}</h2>
        {detail.when ? <p className="mg-handoff__when">{detail.when}</p> : null}
        {detail.from ? <p className="mg-handoff__from">{detail.from}</p> : null}
        <p id="mg-handoff-note" className="mg-handoff__note">
          {preview ? "This opens the real Mingla page. Nothing is booked by previewing." : "You'll finish on Mingla, where your place is confirmed and paid for."}
        </p>
        <div className="mg-handoff__acts">
          <a
            href={detail.href}
            className="mg-btn mg-btn--accent"
            data-mg-handoff-go=""
            data-mingla-tracked="1"
            onClick={go}
            {...(preview ? { target: "_blank", rel: "noopener" } : {})}
          >
            <span>Continue in Mingla</span>
          </a>
          <button type="button" className="mg-btn mg-btn--ghost" onClick={close}><span>Close</span></button>
        </div>
      </div>
    </div>
  );
}

/**
 * #4453 milestone 5 (§5.7) — the sticky phone bar: below 721 px (CSS), shown
 * once 70% of the page's first section has scrolled past, hidden while the
 * hand-off sheet, the phone menu or any form field has focus. One Mingla
 * action. Server-rendered hidden; without JavaScript it never shows (the
 * hero's own buttons stay).
 */
export function StickyBookingBar({ children }: { children: ReactNode }) {
  const bar = useRef<HTMLDivElement>(null);
  const [past, setPast] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const hero = document.querySelector("#main > section, #main > div > section");
    if (!hero) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry) return;
      // Past once less than 30% of the first section is still on screen, below it.
      setPast(entry.boundingClientRect.top < 0 && entry.intersectionRatio < 0.3);
    }, { threshold: [0, 0.3, 0.6, 1] });
    observer.observe(hero);
    const sync = () => {
      const active = document.activeElement;
      const field = active instanceof HTMLElement && active.matches("input, textarea, select, [contenteditable='true']");
      const menu = document.querySelector('[aria-controls="mg-phone-menu"][aria-expanded="true"]') !== null;
      // #4453 M5 tester P1-2 — never cover the analytics choice: while the
      // consent banner is showing, the bar stays away; it returns once the
      // visitor has chosen (the banner leaves the page).
      const consent = document.querySelector("aside.consent") !== null;
      setBusy(field || menu || consent || document.documentElement.dataset.mgHandoff === "open");
    };
    const syncSoon = () => window.setTimeout(sync, 0);
    sync();
    document.addEventListener("focusin", sync);
    document.addEventListener("focusout", syncSoon);
    const mutations = new MutationObserver(sync);
    mutations.observe(document.documentElement, { attributes: true, attributeFilter: ["data-mg-handoff"], subtree: false });
    const menuButton = document.querySelector('[aria-controls="mg-phone-menu"]');
    if (menuButton) mutations.observe(menuButton, { attributes: true, attributeFilter: ["aria-expanded"] });
    // The consent banner mounts and unmounts anywhere in the page.
    const pageChanges = new MutationObserver(sync);
    pageChanges.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      mutations.disconnect();
      pageChanges.disconnect();
      document.removeEventListener("focusin", sync);
      document.removeEventListener("focusout", syncSoon);
    };
  }, []);
  const shown = past && !busy;
  return (
    <div ref={bar} className="mg-sticky" data-mg-sticky-shown={shown ? "true" : "false"} hidden={!shown} aria-hidden={shown ? undefined : true}>
      {children}
    </div>
  );
}
