// Issue #3872 (decision 2) — budget ranges per currency and level. Hosts and
// creators see a real money range for a gig's budget level once its currency
// has one here; an empty level shows the 4-step level indicator only.
// Amounts are typed in whole currency and stored in minor units.

import { useMemo, useState } from "react";
import { useProgramLoad } from "../../hooks/useProgramLoad";
// Each row is keyed by currency and its saved values, so a reload starts it
// from what was saved.
import { Button } from "../../components/ui/Button";
import { AlertCard, SectionCard } from "../../components/ui/Card";
import { Input } from "../../components/ui/Input";
import { useToast } from "../../context/ToastContext";
import { listBudgetBands, saveBudgetBand } from "../../services/creatorProgramsService";
import {
  BUDGET_BANDS,
  DEFAULT_BUDGET_CURRENCIES,
  budgetGridFromRows,
  programErrorMessage,
  validateBudgetBand,
} from "../../lib/creatorPrograms";

function CurrencyRow({ currency, saved, onSaved }) {
  const { addToast } = useToast();
  const [draft, setDraft] = useState(saved);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [rowError, setRowError] = useState("");

  const changed = BUDGET_BANDS.filter((b) => draft[b.id].min !== saved[b.id].min || draft[b.id].max !== saved[b.id].max);

  const set = (band, field, value) => {
    setDraft((d) => ({ ...d, [band]: { ...d[band], [field]: value } }));
    setErrors((e) => ({ ...e, [`${band}.${field}`]: undefined }));
    setRowError("");
  };

  const save = async () => {
    const nextErrors = {};
    const checked = [];
    for (const band of changed) {
      const result = validateBudgetBand(draft[band.id], currency);
      if (!result.ok) nextErrors[`${band.id}.${result.field}`] = result.error;
      else checked.push({ band: band.id, ...result });
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    setSaving(true);
    try {
      for (const item of checked) {
        await saveBudgetBand({ currency, band: item.band, minMinor: item.min_minor, maxMinor: item.max_minor });
      }
      addToast({ variant: "success", title: `${currency} budget ranges saved.` });
      onSaved();
    } catch (cause) {
      if (cause?.field === "min_minor" || cause?.field === "max_minor") {
        setRowError(programErrorMessage(cause));
      } else {
        setRowError(programErrorMessage(cause, "Couldn't save these ranges. Try again."));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <tr className="border-t border-[var(--gray-200)] align-top">
      <th scope="row" className="whitespace-nowrap py-3 pr-3 text-left text-sm font-semibold text-[var(--color-text-primary)]">{currency}</th>
      {BUDGET_BANDS.map((band) => (
        <td key={band.id} className="min-w-44 py-3 pr-3">
          <div className="grid grid-cols-2 gap-1.5">
            <Input
              aria-label={`${currency} ${band.label} lowest`}
              placeholder="From"
              inputMode="numeric"
              value={draft[band.id].min}
              onChange={(e) => set(band.id, "min", e.target.value)}
              error={errors[`${band.id}.min`]}
            />
            <Input
              aria-label={`${currency} ${band.label} highest`}
              placeholder="To"
              inputMode="numeric"
              value={draft[band.id].max}
              onChange={(e) => set(band.id, "max", e.target.value)}
              error={errors[`${band.id}.max`]}
            />
          </div>
          {!draft[band.id].min && !draft[band.id].max ? <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">Level only</p> : null}
        </td>
      ))}
      <td className="py-3">
        <Button size="sm" disabled={!changed.length} loading={saving} onClick={() => void save()}>Save</Button>
        {rowError ? <p role="alert" className="mt-1 max-w-48 text-xs text-[var(--color-error-700)]">{rowError}</p> : null}
      </td>
    </tr>
  );
}

export function BudgetBandsEditor() {
  const bands = useProgramLoad(listBudgetBands);
  const [added, setAdded] = useState([]);
  const [newCurrency, setNewCurrency] = useState("");
  const [newCurrencyError, setNewCurrencyError] = useState("");
  const grid = useMemo(
    () => (bands.data ? budgetGridFromRows(bands.data, [...DEFAULT_BUDGET_CURRENCIES, ...added]) : null),
    [bands.data, added],
  );
  const error = bands.error ? programErrorMessage(bands.error, "Couldn't load budget ranges. Try again.") : "";
  const reload = bands.reload;

  const addCurrency = () => {
    const code = newCurrency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) { setNewCurrencyError("Use a three-letter currency code, like GBP."); return; }
    if (grid?.[code]) { setNewCurrencyError(`${code} is already in the table.`); return; }
    setAdded((list) => [...list, code]);
    setNewCurrency("");
  };

  return (
    <SectionCard
      title="Budget ranges"
      subtitle="Whole amounts, per currency. Leave a level empty to show the level only."
    >
      {error ? <AlertCard variant="error" title="Couldn't load budget ranges">{error}</AlertCard> : null}
      {grid ? (
        <div className="space-y-4">
          <div className="admin-control-scroll overflow-x-auto">
            <table className="w-full min-w-[820px]">
              <thead>
                <tr>
                  <th scope="col" className="pb-2 text-left text-xs font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">Currency</th>
                  {BUDGET_BANDS.map((band) => (
                    <th key={band.id} scope="col" className="pb-2 text-left text-xs font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">{band.label}</th>
                  ))}
                  <th scope="col"><span className="sr-only">Save</span></th>
                </tr>
              </thead>
              <tbody>
                {Object.keys(grid).sort().map((currency) => (
                  <CurrencyRow key={`${currency}:${JSON.stringify(grid[currency])}`} currency={currency} saved={grid[currency]} onSaved={reload} />
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-start gap-2">
            <div className="w-40">
              <Input
                aria-label="Add a currency"
                placeholder="Add currency"
                maxLength={3}
                value={newCurrency}
                onChange={(e) => { setNewCurrency(e.target.value); setNewCurrencyError(""); }}
                error={newCurrencyError || undefined}
              />
            </div>
            <Button variant="secondary" onClick={addCurrency}>Add</Button>
          </div>
        </div>
      ) : !error ? <p className="text-sm text-[var(--color-text-secondary)]">Loading…</p> : null}
    </SectionCard>
  );
}
