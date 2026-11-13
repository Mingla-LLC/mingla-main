// Issue #4419 — the label is the promise: a preview, the exact copy, or a
// rebuild, and why a send stopped, in plain words.
import { AlertTriangle, Ban, Check, Clock, Eye, Info, Layers } from "lucide-react";
import { bannersFor } from "./campaignModel";

const TONES = {
  info: "bg-[var(--color-info-50)] text-[var(--color-info-700)]",
  ok: "bg-[var(--color-success-50)] text-[var(--color-success-700)]",
  warn: "bg-[var(--color-warning-50)] text-[var(--color-warning-700)]",
  err: "bg-[var(--color-error-50)] text-[var(--color-error-700)]",
  neutral: "bg-[var(--gray-100)] text-[var(--color-text-secondary)]",
};
const ICONS = { eye: Eye, clock: Clock, check: Check, alert: AlertTriangle, ban: Ban, layers: Layers, info: Info };

export function EmailViewBanner({ detail }) {
  return bannersFor(detail).map((banner) => {
    const Icon = ICONS[banner.icon] || Info;
    return (
      <div key={banner.title} data-banner={banner.tone} role={banner.tone === "err" ? "alert" : "status"} className={`flex items-start gap-3 rounded-xl px-4 py-3 text-[13px] ${TONES[banner.tone] || TONES.neutral}`}>
        <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <b className="block font-semibold">{banner.title}</b>
          <p className="opacity-90">{banner.text}</p>
        </div>
      </div>
    );
  });
}
