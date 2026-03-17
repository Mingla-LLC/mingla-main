import { ChevronRight } from "lucide-react";

export function Breadcrumbs({ items }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex items-center gap-0 text-sm">
        {items.map((item, i) => {
          const isLast = i === items.length - 1;
          return (
            <li key={item.label} className="flex items-center">
              {i > 0 && (
                <ChevronRight className="h-3 w-3 mx-1.5 text-[var(--gray-400)]" />
              )}
              {isLast ? (
                <span className="font-medium text-[var(--color-text-primary)]" aria-current="page">
                  {item.label}
                </span>
              ) : (
                <button
                  onClick={item.onClick}
                  className="text-[var(--color-text-tertiary)] hover:text-[#f97316] transition-colors duration-150 cursor-pointer"
                >
                  {item.label}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
