import { ArrowLeft } from "lucide-react";

// Issue #3802 (admin shell): the ONE page header. Every page starts with it,
// so the title is the same size, weight and place on every page.
// Invariant: I-3802-ADMIN-SHELL-ONE-FRAME (docs/INVARIANT_REGISTRY.md).
//
//   title        the page's name (the only <h1> on the page)
//   description  one line under the title (optional)
//   meta         small things that belong beside the title: a count, a state
//                badge (optional)
//   actions      buttons, right-aligned; they wrap under the title when the
//                page is narrow (optional)
//   back         { label, onClick }: a way back, above the title (optional)
//   tabs         the page's <Tabs>; it sits on the divider under the header
//                (optional)
//   titleId      an id for the <h1>, when a section is labelled by it
//
// A page puts nothing around this: no outer padding, width or centring. The
// shell sets those once (components/layout/AppShell.jsx).
export function PageHeader({ title, description, meta, actions, back, tabs, titleId }) {
  return (
    <header className="flex min-w-0 flex-col gap-3">
      {back && (
        <button
          type="button"
          onClick={back.onClick}
          className="-ml-1 inline-flex w-fit items-center gap-1.5 rounded-md px-1 py-0.5 text-[13px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors duration-150 cursor-pointer"
        >
          <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
          {back.label}
        </button>
      )}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <h1
              id={titleId}
              className="break-words text-[22px] font-semibold leading-7 tracking-[-0.02em] text-[var(--color-text-primary)]"
            >
              {title}
            </h1>
            {meta}
          </div>
          {description && (
            <p className="mt-0.5 max-w-[64ch] text-[13.5px] leading-5 text-[var(--color-text-secondary)]">
              {description}
            </p>
          )}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {tabs && <div className="min-w-0">{tabs}</div>}
    </header>
  );
}
