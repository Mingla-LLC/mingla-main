// Issue #4270 (Wave 7) — the side panel beside a Brand group's chat. Whatever
// is linked (a plan item, the host card, a Work card, an event, a post, the
// brand, the brand's Calendar) opens here; nothing in a Brand group navigates
// away. A link inside the panel stacks: the trail reads "Brand › A › B", the
// panel's Back returns to A, and Close clears the stack.
//
// The item itself is the same drawer every other page shows (SidePanel), drawn
// docked through PanelSlotContext; links inside it come back through
// PanelLinksContext as openInside. #4270 W7 rework (D-1): the drawers also get
// `onOpenSide(kind, id)`, so their links to other pages open here or show as
// plain words; nothing in the panel changes the page except the explicit
// "Open full page" links.
import { useCallback, useMemo, useState } from "react";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { PanelLinksContext, PanelSlotContext } from "../ui/PanelStack";
import { FullPageLink, SidePanel } from "../panels/SidePanel";
import { BrandCalendarSide } from "./BrandCalendarSide";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";

/** The trail's words: [brand, ...earlier titles, current]. */
export function panelTrailWords(brandName, trail, currentTitle) {
  return [brandName || "Brand group", ...(Array.isArray(trail) ? trail : []).map((t) => t.title || "Item"), currentTitle || "Item"];
}

export function BrandGroupSidePanel({ stack, side, brandName, onClose, onChanged, onOpenInside, onOpenSide = null, onBackToChat }) {
  const [currentTitle, setCurrentTitle] = useState("");
  const titles = stack?.titles;
  const register = useCallback((entry) => {
    const title = entry?.title || "";
    // The stack's titles feed its Back words (the same write PanelStack.jsx makes).
    // eslint-disable-next-line react-hooks/immutability
    if (titles) titles.current[2] = title;
    setCurrentTitle(title);
  }, [titles]);
  const trail = Array.isArray(stack?.trail) ? stack.trail : [];
  const top = trail.length ? trail[trail.length - 1] : null;
  const backLabel = top ? `Back to ${top.title || "the last item"}` : "";
  const goBack = stack?.back;
  const slot = useMemo(() => ({
    slot: 2,
    register,
    back: backLabel ? { label: backLabel, onClick: goBack } : null,
  }), [register, backLabel, goBack]);
  const links = useMemo(() => ({ openSide: onOpenInside }), [onOpenInside]);
  if (!side) return null;
  const words = panelTrailWords(brandName, trail, currentTitle);
  return (
    <section data-side-panel={`${side.kind}:${side.id}`} aria-label="Linked item" className="flex min-h-0 flex-1 flex-col bg-[var(--color-background-primary)]">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--gray-100)] px-3 py-2">
        <button type="button" onClick={onBackToChat} className={`inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-[13px] font-semibold text-[var(--color-brand-700)] hover:bg-[var(--color-brand-50)] lg:hidden ${FOCUS}`}>
          <ArrowLeft aria-hidden="true" className="h-4 w-4" /> Back to the chat
        </button>
        <nav aria-label="Panel trail" className="min-w-0 flex-1">
          <ol className="flex min-w-0 flex-wrap items-center gap-1 text-[12px] text-[var(--color-text-tertiary)]">
            {words.map((word, i) => {
              const last = i === words.length - 1;
              const trailIndex = i - 1; // 0 is the brand
              return (
                <li key={`${i}-${word}`} className="flex min-w-0 items-center gap-1">
                  {i > 0 && <ChevronRight aria-hidden="true" className="h-3 w-3 shrink-0" />}
                  {last ? (
                    <span aria-current="page" className="truncate font-semibold text-[var(--color-text-primary)]">{word}</span>
                  ) : trailIndex >= 0 ? (
                    <button type="button" onClick={() => stack.backTo(trailIndex)} className={`min-h-8 truncate rounded px-1 hover:underline ${FOCUS}`}>{word}</button>
                  ) : (
                    <span className="truncate">{word}</span>
                  )}
                </li>
              );
            })}
          </ol>
        </nav>
        {side.kind === "brand" && <FullPageLink side={side} />}
      </div>
      <div className="min-h-0 flex-1" data-scroll="side">
        <PanelLinksContext.Provider value={links}>
          <PanelSlotContext.Provider value={slot}>
            {side.kind === "calendar"
              ? <BrandCalendarSide key={side.id} side={side} brandName={brandName} onClose={onClose} />
              : <SidePanel side={side} onClose={onClose} onChanged={onChanged} onOpenSide={onOpenSide} />}
          </PanelSlotContext.Provider>
        </PanelLinksContext.Provider>
      </div>
    </section>
  );
}
