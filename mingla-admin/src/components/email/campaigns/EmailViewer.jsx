// Issue #4419 — the email in an inbox frame. The HTML is shown exactly as
// stored, in a sandboxed iframe like the composer's preview (no scripts, no
// same-origin); the plain text is a text node, never HTML.
import { useState } from "react";
import { AlignLeft, Eye, Monitor, Smartphone } from "lucide-react";
import { viewLabel } from "./campaignModel";

function Seg({ label, options, value, onChange }) {
  return (
    <div role="group" aria-label={label} className="inline-flex gap-0.5 rounded-lg bg-[var(--gray-100)] p-[3px]">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          aria-label={o.aria || undefined}
          onClick={() => onChange(o.id)}
          className={`inline-flex min-h-[30px] items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold ${value === o.id ? "bg-[var(--color-background-primary)] text-[var(--color-text-primary)] shadow-sm" : "text-[var(--color-text-tertiary)]"}`}
        >
          <o.icon className="h-3.5 w-3.5" aria-hidden="true" />{o.text}
        </button>
      ))}
    </div>
  );
}

export function EmailViewer({ detail, initialMode = "design", initialWidth = "desktop" }) {
  const [mode, setMode] = useState(initialMode);
  const [width, setWidth] = useState(initialWidth);
  const view = detail?.view || {};
  const c = detail?.campaign || {};
  const from = c.from ? `${c.from.name} <${c.from.email}>` : "";
  return (
    <section aria-label="The email" className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-[var(--gray-200)] bg-[var(--color-background-primary)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--gray-200)] px-4 py-3">
        <span data-view-label={view.kind} className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-text-tertiary)]">{viewLabel(view.kind)}</span>
        <div className="flex flex-wrap gap-2">
          <Seg label="View" value={mode} onChange={setMode} options={[{ id: "design", text: "Design", icon: Eye }, { id: "text", text: "Plain text", icon: AlignLeft }]} />
          <Seg label="Width" value={width} onChange={setWidth} options={[{ id: "desktop", text: "", icon: Monitor, aria: "Desktop width" }, { id: "mobile", text: "", icon: Smartphone, aria: "Mobile width" }]} />
        </div>
      </div>
      <dl className="m-0 grid grid-cols-[64px_minmax(0,1fr)] gap-x-3 gap-y-1 border-b border-[var(--gray-200)] px-5 py-3.5 text-[13px]">
        <dt className="text-[var(--color-text-tertiary)]">From</dt><dd className="m-0 break-words text-[var(--color-text-primary)]">{from}</dd>
        <dt className="text-[var(--color-text-tertiary)]">To</dt><dd className="m-0 text-[var(--color-text-primary)]">Maya (sample recipient)</dd>
        <dt className="text-[var(--color-text-tertiary)]">Subject</dt><dd className="m-0 break-words font-semibold text-[var(--color-text-primary)]">{view.subject}</dd>
        <dt className="text-[var(--color-text-tertiary)]">Preview</dt><dd className="m-0 break-words text-[var(--color-text-secondary)]">{view.preheader || "—"}</dd>
      </dl>
      <div className="flex min-h-[420px] justify-center overflow-x-auto bg-[var(--gray-100)] px-4 py-6">
        {mode === "design" ? (
          <div className={`w-full overflow-hidden rounded-xl bg-white transition-[max-width] duration-200 motion-reduce:transition-none ${width === "mobile" ? "max-w-[360px]" : "max-w-[640px]"}`}>
            <iframe title="Email as sent" sandbox="allow-popups" srcDoc={view.html || ""} className="h-[900px] w-full border-0 bg-white" />
          </div>
        ) : (
          <pre data-plain-text="" className={`m-0 w-full whitespace-pre-wrap break-words rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] p-5 font-mono text-[13px] leading-relaxed text-[var(--color-text-primary)] ${width === "mobile" ? "max-w-[360px]" : "max-w-[640px]"}`}>{`Subject: ${view.subject || ""}\n\n${view.text || ""}`}</pre>
        )}
      </div>
    </section>
  );
}
