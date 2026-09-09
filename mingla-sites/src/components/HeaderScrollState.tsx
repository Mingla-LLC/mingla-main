"use client";

import { useEffect } from "react";

/**
 * #3149 — the header's scrolled state.
 *
 * The header is TRANSPARENT over the hero and gains `stuck` once the page has
 * moved, at which point its `::before` panel fades in and the header shrinks
 * from 85px to 72px. Both the threshold and the class name are the reference's
 * own.
 *
 * Written the way `RevealOnScroll` is — a client component that renders
 * nothing and drives a class on an element the SERVER rendered — so the header
 * itself stays server-rendered markup with server-rendered links. Making the
 * header a client component to hold one boolean would have taken the whole
 * navigation off the server with it.
 *
 * FAIL-VISIBLE, like the reveal. With no JavaScript the header simply stays in
 * its transparent state: every link is still there, still keyboard-reachable,
 * still readable against the hero it was designed to sit on. Nothing is
 * hidden and nothing becomes unreachable.
 *
 * `prefers-reduced-motion` is honoured in CSS, which drops the transitions and
 * leaves the state change instant — reduced motion means no animation, not a
 * header that never becomes legible.
 */
const STUCK_AFTER_PX = 40;

export function HeaderScrollState() {
  useEffect(() => {
    const header = document.querySelector<HTMLElement>(".site-header");
    if (!header) return;
    let frame = 0;
    let pending = false;
    const apply = () => {
      header.classList.toggle("stuck", window.scrollY > STUCK_AFTER_PX);
    };
    const onScroll = () => {
      /*
       * One class write per frame. A scroll handler is the hottest callback on
       * the page and this one reads layout.
       *
       * The latch is a BOOLEAN set before scheduling, not the frame id. Where
       * the callback runs synchronously the returned id is assigned AFTER the
       * callback has already finished, so a latch that clears itself inside
       * the callback is immediately overwritten by that id and every later
       * scroll is dropped — the header sticks in whatever state it first
       * reached and never comes back. Caught by running it, not by reading it.
       */
      if (pending) return;
      pending = true;
      frame = window.requestAnimationFrame(() => {
        pending = false;
        apply();
      });
    };
    /*
     * Applied ONCE before any scroll event. A reload part-way down a page — or
     * a browser restoring the previous scroll position — would otherwise paint
     * a transparent header over ordinary page content until the visitor
     * happened to scroll.
     */
    apply();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
      header.classList.remove("stuck");
    };
  }, []);
  return null;
}
