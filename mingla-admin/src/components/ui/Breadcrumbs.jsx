import { ChevronRight } from "lucide-react";

// `items` is [{ label, onClick? }]; the last one is where you are.
//   - an earlier item WITH onClick is a link back (detail views use this)
//   - an earlier item WITHOUT onClick is words only. The admin header uses
//     this for "Group › Page" (issue #3802): the group is not a control, so it
//     is never drawn as one.
// `oneLine` keeps the trail on a single line and cuts a long last item short
// (the header, which has a fixed height); without it the trail is as before.
export function Breadcrumbs({ items, oneLine = false }) {
  return (
    <nav aria-label="Breadcrumb" className={oneLine ? "min-w-0" : undefined}>
      <ol className={oneLine ? "flex min-w-0 items-center gap-0 whitespace-nowrap text-[13px]" : "flex items-center gap-0 text-sm"}>
        {items.map((item, i) => {
          const isLast = i === items.length - 1;
          return (
            <li key={`${i}-${item.label}`} className={!oneLine ? "flex items-center" : isLast ? "flex min-w-0 items-center" : "flex shrink-0 items-center"}>
              {i > 0 && (
                <ChevronRight aria-hidden="true" className="mx-1.5 h-3 w-3 shrink-0 text-[var(--gray-400)]" />
              )}
              {isLast ? (
                <span className={`${oneLine ? "truncate " : ""}font-medium text-[var(--color-text-primary)]`} aria-current="page">
                  {item.label}
                </span>
              ) : item.onClick ? (
                <button
                  type="button"
                  onClick={item.onClick}
                  className="text-[var(--color-text-tertiary)] hover:text-[var(--color-brand-500)] transition-colors duration-150 cursor-pointer"
                >
                  {item.label}
                </button>
              ) : (
                <span className="text-[var(--color-text-tertiary)]">{item.label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
