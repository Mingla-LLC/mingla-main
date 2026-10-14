// Issue #3802 (Wave 4) — what "City missing?" opens, under the region menu.
//
// Regions are the Launch Cities list. An owner or admin adds a city in Place
// Pool (it is added as not live, and shows here straight away); everyone
// else is told who can. Nothing on the pipeline pages creates a city. Place
// Pool opens in a new tab, so nothing typed on this page is lost.
import { useEffect, useRef } from "react";
import { Button } from "../ui/Button";
import { missingCityWords } from "../../lib/crmModel";

export function MissingCityLayer({ canAddRegion, onClose, onRefresh }) {
  const words = missingCityWords(canAddRegion);
  const firstRef = useRef(null);
  useEffect(() => {
    firstRef.current?.focus();
  }, []);
  return (
    <div
      role="group"
      aria-label="City missing?"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
      className="flex w-full min-w-0 flex-col gap-2 rounded-lg border border-[var(--gray-200)] bg-[var(--gray-50)] p-3 sm:col-span-2"
    >
      <p className="text-[13px] font-semibold text-[var(--color-text-primary)]">City missing?</p>
      <p className="text-[13px] text-[var(--color-text-secondary)]">{words.text}</p>
      <div className="flex flex-wrap gap-2">
        {canAddRegion ? (
          <>
            <Button
              ref={firstRef}
              type="button"
              className="max-sm:h-11"
              onClick={() => {
                // A new tab: the form behind this keeps everything typed in it.
                window.open(`${window.location.pathname}${window.location.search}#/placepool`, "_blank", "noopener");
              }}
            >
              {words.primary}
            </Button>
            {onRefresh && (
              <Button type="button" variant="secondary" className="max-sm:h-11" onClick={onRefresh}>
                {words.refresh}
              </Button>
            )}
            <Button type="button" variant="ghost" className="max-sm:h-11" onClick={onClose}>
              {words.secondary}
            </Button>
          </>
        ) : (
          <Button ref={firstRef} type="button" variant="secondary" className="max-sm:h-11" onClick={onClose}>
            {words.primary}
          </Button>
        )}
      </div>
    </div>
  );
}
