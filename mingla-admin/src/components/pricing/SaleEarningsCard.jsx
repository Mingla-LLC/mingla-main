// Issue #4130 (Wave 2b) — Pricing › Fees › "What one sale earns".
// Pure display over lib/saleEarnings.js: the take portion being edited above
// (or the saved default) plus the 3% service portion, one ticket at a time.
import { useState } from "react";
import { SectionCard } from "../ui/Card";
import {
  PROCESSING_RATES,
  SALE_PRESETS,
  formatMinor,
  saleEarnings,
} from "../../lib/saleEarnings";

export function SaleEarningsCard({ takeBps }) {
  const [presetId, setPresetId] = useState(SALE_PRESETS[0].id);
  const preset = SALE_PRESETS.find((p) => p.id === presetId) ?? SALE_PRESETS[0];
  const result = saleEarnings({ ticketMinor: preset.ticketMinor, takeBps, currency: preset.currency });
  const m = (minor) => formatMinor(minor, preset.currency);

  return (
    <SectionCard
      title="What one sale earns"
      action={
        <div className="flex flex-wrap gap-1" role="group" aria-label="Ticket price">
          {SALE_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={p.id === presetId}
              onClick={() => setPresetId(p.id)}
              className={[
                "rounded-lg px-2.5 py-1 text-xs font-medium cursor-pointer",
                p.id === presetId
                  ? "bg-[var(--color-brand-500)] text-white"
                  : "bg-[var(--color-background-secondary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-background-tertiary)]",
              ].join(" ")}
            >
              {p.label}
            </button>
          ))}
        </div>
      }
    >
      {result === null ? (
        <p className="text-sm text-[var(--color-text-secondary)]">Enter a valid take portion above to see what a sale earns.</p>
      ) : (
        <div className="space-y-3">
          <table className="w-full text-sm tabular-nums">
            <tbody>
              <tr><td className="py-1">Ticket price · host gets</td><td className="py-1 text-right">{m(result.ticket)}</td></tr>
              <tr><td className="py-1">Mingla fee ({(result.feeBps / 100).toFixed(2).replace(/\.?0+$/, "")}%)</td><td className="py-1 text-right">{m(result.fee)}</td></tr>
              <tr className="font-semibold"><td className="py-1">Buyer pays</td><td className="py-1 text-right">{m(result.buyerPays)}</td></tr>
              <tr className="text-[var(--color-text-secondary)]"><td className="py-1">Card processing Mingla pays ({PROCESSING_RATES[preset.currency].provider})</td><td className="py-1 text-right">−{m(result.processing)}</td></tr>
              <tr className="border-t border-[var(--gray-200)] font-semibold">
                <td className="py-1.5">Mingla profit on this sale</td>
                <td className={`py-1.5 text-right ${result.profit < 0 ? "text-[var(--color-error-700)]" : "text-[var(--color-success-700)]"}`}>
                  {result.profit < 0 ? "−" : ""}{m(Math.abs(result.profit))}
                  {result.keptShare !== null && (
                    <span className="ml-1 text-xs font-normal text-[var(--color-text-tertiary)]">
                      {Math.round(result.keptShare * 100)}% of the fee
                    </span>
                  )}
                </td>
              </tr>
            </tbody>
          </table>
          <p className="text-xs text-[var(--color-text-tertiary)]">
            Processing uses {PROCESSING_RATES[preset.currency].label}. Real charges vary by card, so treat this as a guide.
          </p>
        </div>
      )}
    </SectionCard>
  );
}
