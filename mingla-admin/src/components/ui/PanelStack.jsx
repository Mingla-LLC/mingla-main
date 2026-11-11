// Issue #4255 — two side panels docked on the right, shared by Work, the
// Calendar and Hosts and creators.
//
//   * Not modal: there is no scrim and no focus trap, so the page behind
//     stays usable (scroll the board, open another card).
//   * Panel one is the page's own item. Panel two is a linked item (a host
//     from a work card, a card from an event...). Opening another linked item
//     replaces panel two and keeps a Back trail.
//   * Panel one is never unmounted while panel two opens, closes or changes,
//     so whatever is typed in it stays exactly as it was. Text typed in a
//     panel is also kept per item (lib/panelDrafts.js), so it survives the
//     panel closing; reloading the page with unsaved text asks first.
//   * Esc leaves a field first, then closes the top panel.
//   * D10: below 1024px panel two covers panel one and shows a Back button.
//
// Each panel's content is an ordinary <Drawer>: inside a panel it draws
// itself as a docked panel (components/ui/Drawer.jsx reads PanelSlotContext)
// instead of a full-screen modal.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { hasPanelDrafts } from "../../lib/panelDrafts";
import { PANEL_NARROW_PX, sideHref } from "../../lib/panelStack";

/** The panel a Drawer is drawn in: { slot, register, back }. */
export const PanelSlotContext = createContext(null);

/** How a link inside a panel opens its item in panel two: { openSide }. */
export const PanelLinksContext = createContext(null);

export function usePanelLinks() {
  return useContext(PanelLinksContext);
}

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";

/**
 * A link to a linked item. Inside a page with panels it opens the item in
 * panel two (a button, nothing leaves the page); anywhere else it is the
 * plain link it always was.
 */
export function SideLink({ side, href, className = "", children, ...rest }) {
  const links = usePanelLinks();
  if (links?.openSide && side) {
    return (
      <button type="button" data-side-link={`${side.kind}:${side.id}`} className={`text-left ${className}`} onClick={() => links.openSide(side)} {...rest}>
        {children}
      </button>
    );
  }
  return (
    <a href={href || sideHref(side)} className={className} {...rest}>
      {children}
    </a>
  );
}

/**
 * #4270 W7 rework (D-1): a link to another admin page inside a drawer. A page
 * that must not change (the Brand group side panel) passes the drawer an
 * `onOpenSide(kind, id)` opener; with it, the link opens its item in that
 * panel when it has a side kind (`side`) the opener allows, shows its words as
 * plain text otherwise, or nothing at all with `hide`. Without the opener it
 * is the plain link it always was, so every other page behaves as before.
 */
export function PageLink({ href, side = null, onOpenSide = null, hide = false, className = "", textClassName = "", children, ...rest }) {
  if (typeof onOpenSide !== "function") {
    return (
      <a href={href} className={className} {...rest}>
        {children}
      </a>
    );
  }
  const allowed = side && (typeof onOpenSide.allows !== "function" || onOpenSide.allows(side.kind));
  if (allowed) {
    return (
      <button type="button" data-side-link={`${side.kind}:${side.id}`} className={`text-left ${className}`} onClick={() => onOpenSide(side.kind, side.id)}>
        {children}
      </button>
    );
  }
  if (hide) return null;
  return <span data-page-link-text="" className={textClassName}>{children}</span>;
}

/** "Draft kept · not saved yet", with a Discard that asks first. */
export function DraftKeptNote({ kept, onDiscard, className = "" }) {
  const [asking, setAsking] = useState(false);
  if (!kept) return null;
  return (
    <span data-draft-kept="" role="status" className={`inline-flex min-w-0 flex-wrap items-center gap-1.5 text-[12px] font-semibold text-[var(--color-warning-700)] ${className}`}>
      Draft kept · not saved yet
      {onDiscard && (asking ? (
        <>
          <span className="font-normal text-[var(--color-text-secondary)]">Throw it away?</span>
          <button type="button" onClick={() => { setAsking(false); onDiscard(); }} className={`min-h-8 rounded px-1.5 text-[var(--color-error-700)] underline ${FOCUS}`}>Discard</button>
          <button type="button" onClick={() => setAsking(false)} className={`min-h-8 rounded px-1.5 text-[var(--color-text-secondary)] underline ${FOCUS}`}>Keep</button>
        </>
      ) : (
        <button type="button" onClick={() => setAsking(true)} className={`min-h-8 rounded px-1.5 font-normal text-[var(--color-text-secondary)] underline ${FOCUS}`}>Discard draft</button>
      ))}
    </span>
  );
}

// Reloading or leaving the admin with unsaved panel text asks first. One
// listener for the whole app: the text outlives any one page.
if (typeof window !== "undefined" && !window.__minglaPanelDraftGuard) {
  window.__minglaPanelDraftGuard = true;
  window.addEventListener("beforeunload", (event) => {
    if (!hasPanelDrafts()) return;
    event.preventDefault();
    event.returnValue = "";
  });
}

function useNarrow() {
  const query = `(max-width: ${PANEL_NARROW_PX - 0.02}px)`;
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    const media = window.matchMedia(query);
    const update = () => setNarrow(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, [query]);
  return narrow;
}

const FIELD_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/**
 * #4255 W3: panel one's width. `card` is the 720px work card (it gives way to
 * its thread on a narrower screen), `full` fills the page (focus mode, the
 * sprint planner), `default` is the 440px panel every other page uses.
 */
function panelWidth(size, both, narrow, fallback) {
  if (size === "full") return both && !narrow ? "w-[calc(100vw-400px)]" : "w-screen";
  if (size === "card") return both && !narrow ? "w-[min(720px,calc(100vw-400px))]" : "w-screen sm:w-[720px] sm:max-w-[100vw]";
  return fallback;
}

/**
 * `stack` comes from hooks/usePanelStack.js; `first` and `second` are the two
 * panels' contents (each normally a <Drawer>), either may be null. `narrow`
 * forces the narrow layout (tests); otherwise the screen width decides.
 */
export function PanelStack({ stack = null, first = null, second = null, narrow: forceNarrow, firstSize = "default" }) {
  const screenNarrow = useNarrow();
  const narrow = forceNarrow ?? screenNarrow;
  const rootRef = useRef(null);
  const entries = useRef({ 1: null, 2: null });
  const [titles, setTitles] = useState({ 1: "", 2: "" });
  const hasFirst = !!first;
  const hasSecond = !!second;

  const registerFor = useCallback(
    (slot) => (entry) => {
      entries.current[slot] = entry;
      const title = entry?.title || "";
      if (stack?.titles) stack.titles.current[slot] = title;
      setTitles((prev) => (prev[slot] === title ? prev : { ...prev, [slot]: title }));
    },
    [stack]
  );
  const registerFirst = useMemo(() => registerFor(1), [registerFor]);
  const registerSecond = useMemo(() => registerFor(2), [registerFor]);

  // Esc: a field lets go first (it saves on blur); then the top panel closes.
  // A dialog opened over a panel has its own Esc, so the panels wait.
  useEffect(() => {
    if (!hasFirst && !hasSecond) return undefined;
    const onKeyDown = (e) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      const root = rootRef.current;
      const active = document.activeElement;
      if (active && (FIELD_TAGS.has(active.tagName) || active.isContentEditable)) {
        if (!root || !root.contains(active)) return;
        active.blur();
        active.closest("[data-panel-focus]")?.focus?.();
        return;
      }
      const top = hasSecond ? entries.current[2] : entries.current[1];
      if (top?.onClose) {
        e.preventDefault();
        top.onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [hasFirst, hasSecond]);

  const trailTop = stack?.trail?.length ? stack.trail[stack.trail.length - 1] : null;
  const secondBack = trailTop
    ? { label: `Back to ${trailTop.title || "the last item"}`, onClick: stack.back }
    : narrow && hasFirst && stack?.closeSide
      ? { label: `Back to ${titles[1] || "the first panel"}`, onClick: stack.closeSide }
      : null;
  const firstSlot = useMemo(() => ({ slot: 1, register: registerFirst, back: null }), [registerFirst]);
  const secondSlot = useMemo(() => ({ slot: 2, register: registerSecond, back: secondBack }), [registerSecond, secondBack?.label, secondBack?.onClick]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!hasFirst && !hasSecond) return null;
  const both = hasFirst && hasSecond;
  const width = both && !narrow ? "w-[min(440px,50vw)]" : "w-full sm:w-[440px]";
  // #4255 W3: a work card is 720px wide (its thread beside it at 400px), and
  // focus mode or the sprint planner fills the page.
  const firstWidth = panelWidth(firstSize, both, narrow, width);
  const secondWidth = firstSize === "default" ? width : both && !narrow ? "w-[400px] max-w-[45vw]" : "w-screen sm:w-[440px]";
  return (
    <div
      ref={rootRef}
      data-panel-stack={both ? (narrow ? "covered" : "side-by-side") : "one"}
      className="pointer-events-none fixed inset-y-0 right-0 flex max-w-full justify-end"
      style={{ zIndex: "var(--z-overlay)" }}
    >
      {hasFirst && (
        <div data-panel-slot="1" aria-hidden={both && narrow ? "true" : undefined} className={`pointer-events-auto h-full min-w-0 ${firstWidth} ${both && narrow ? "hidden" : ""}`} data-panel-size={firstSize === "default" ? undefined : firstSize}>
          <PanelSlotContext.Provider value={firstSlot}>{first}</PanelSlotContext.Provider>
        </div>
      )}
      {hasSecond && (
        <div data-panel-slot="2" className={`pointer-events-auto h-full min-w-0 ${secondWidth}`}>
          <PanelSlotContext.Provider value={secondSlot}>{second}</PanelSlotContext.Provider>
        </div>
      )}
    </div>
  );
}
