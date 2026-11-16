"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/*
 * #4453 v2.1 §1.4 — the header's only JavaScript: the "More" disclosure
 * (`aria-expanded`), the phone menu (a full-screen dialog: focus trap,
 * Escape closes it, focus returns to the button, the page behind does not
 * scroll) and the `scrolled` state the glass bar turns solid on. Which items
 * sit under "More" is decided by CSS container queries, never by measuring,
 * so the header never shifts.
 */

export function MoreMenu({ current, children }: { current: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (event instanceof MouseEvent && ref.current?.contains(event.target as Node)) return;
      setOpen(false);
      if (event instanceof KeyboardEvent) ref.current?.querySelector("button")?.focus();
    };
    document.addEventListener("keydown", close);
    document.addEventListener("click", close);
    return () => {
      document.removeEventListener("keydown", close);
      document.removeEventListener("click", close);
    };
  }, [open]);
  return (
    <li ref={ref} className="mg-more" data-current={current ? "true" : undefined}>
      <button type="button" className="mg-nav__a mg-more__btn" aria-expanded={open} aria-controls="mg-more-list" onClick={() => setOpen((value) => !value)}>
        More<svg viewBox="0 0 24 24" aria-hidden="true" className="mg-ico"><path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="1.8" /></svg>
      </button>
      <ul id="mg-more-list" className="mg-more__list" hidden={!open}>{children}</ul>
    </li>
  );
}

export function PhoneMenu({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = document.documentElement;
    if (!open) {
      root.removeAttribute("data-mg-menu-open");
      return;
    }
    root.setAttribute("data-mg-menu-open", "");
    const panel = dialog.current;
    const focusable = () => [...(panel?.querySelectorAll<HTMLElement>("a[href], button:not([disabled])") ?? [])];
    focusable()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        button.current?.focus();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      root.removeAttribute("data-mg-menu-open");
    };
  }, [open]);
  return (
    <>
      <button ref={button} type="button" className="mg-menu-btn" aria-haspopup="dialog" aria-expanded={open} aria-controls="mg-phone-menu" onClick={() => setOpen(true)}>
        <span className="mg-sr">Menu</span>
        <svg viewBox="0 0 24 24" aria-hidden="true" className="mg-ico"><path d="M4 7h16M4 12h16M4 17h16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
      </button>
      <div ref={dialog} id="mg-phone-menu" className="mg-pmenu" role="dialog" aria-modal="true" aria-label="Menu" hidden={!open}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("a[href]")) setOpen(false);
        }}>
        <button type="button" className="mg-pmenu__x" aria-label="Close the menu" onClick={() => {
          setOpen(false);
          button.current?.focus();
        }}>{"×"}</button>
        {children}
      </div>
    </>
  );
}

/** Marks the header `data-scrolled` once the page has moved (the glass bar turns solid). */
export function ScrollState() {
  useEffect(() => {
    const header = document.querySelector<HTMLElement>("[data-mg-header]");
    if (!header) return;
    const update = () => header.toggleAttribute("data-scrolled", window.scrollY > 24);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);
  return null;
}
