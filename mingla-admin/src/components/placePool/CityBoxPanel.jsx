// Issue #4276 U1, B1, B2, T8, T9: a city's geo box and whether we are missing places.
//
// B1: Google's box applies on its own (the larger of Google's and the stored box on each
// edge). A person is asked only when Google returns a state or region, or the seed
// estimate passes $500. A hand-adjusted box always asks. Before anything changes, the
// panel says how many active places sit outside the current box and would sit outside
// the proposed one; nothing is ever deleted for being outside.

import { useCallback, useEffect, useState } from "react";
import { MapPinned, RefreshCw, Search } from "lucide-react";
import { SectionCard, AlertCard } from "../ui/Card";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import { Spinner } from "../ui/Spinner";
import { Modal, ModalBody, ModalFooter } from "../ui/Modal";
import { useToast } from "../../context/ToastContext";
import { seeding } from "../../services/cityPipelineService";
import { completenessSummary, count, usd } from "../../lib/cityPipeline";

const ASK_REASON_TEXT = {
  state_or_region_result: "Google returned a state or region, not a city",
  seed_estimate_over_limit: "Seeding this box is estimated over $500",
};

const EDGE_WORD = { swLat: "south", swLng: "west", neLat: "north", neLng: "east" };

const inputClass =
  "h-10 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 text-sm text-[var(--color-text-primary)] tabular-nums";

function boxText(b) {
  if (!b) return "none";
  const f = (v) => Number(v).toFixed(4);
  return `${f(b.swLat)}, ${f(b.swLng)} to ${f(b.neLat)}, ${f(b.neLng)}`;
}

function OutsideLine({ label, row }) {
  if (!row) return null;
  const active = Number(row.outside_active ?? 0);
  return (
    <p className={`text-sm ${active > 0 ? "text-[var(--color-warning-700)]" : "text-[var(--color-text-secondary)]"}`}>
      {label}: {count(active)} active places outside{active > 0 ? `, ${count(row.outside_servable)} of them seen by Explorers` : ""}.
    </p>
  );
}

function Check({ ok, text, bad = false }) {
  return (
    <div className="grid grid-cols-[62px_minmax(0,1fr)] items-start gap-2 border-t border-[var(--color-border)] py-2 text-sm first:border-t-0">
      <Badge variant={bad ? "error" : ok === null ? "default" : ok ? "success" : "warning"}>{bad ? "Failed" : ok === null ? "?" : ok ? "Yes" : "No"}</Badge>
      <span className={bad ? "font-medium text-[var(--color-error-700)]" : ""}>{text}</span>
    </div>
  );
}

export function CityBoxPanel({ city, onChanged }) {
  const { addToast } = useToast();
  const cityId = city.city_id;
  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState(null);
  const [outside, setOutside] = useState(undefined);
  const [history, setHistory] = useState(null);
  const [plan, setPlan] = useState(null);
  const [planError, setPlanError] = useState(null);
  const [planning, setPlanning] = useState(false);
  const [manual, setManual] = useState(null);
  const [confirm, setConfirm] = useState(null); // { kind: "google" | "manual" | "completeness" }
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setStatusError(null);
    const [s, o, h] = await Promise.allSettled([
      seeding("city_search_status", { cityId }),
      seeding("places_outside_box", { cityId }),
      seeding("retired_tile_history", { cityId }),
    ]);
    if (s.status === "fulfilled") setStatus(s.value); else setStatusError(s.reason.message);
    setOutside(o.status === "fulfilled" ? (o.value.report ?? []).find((r) => r.city_id === cityId) ?? null : null);
    setHistory(h.status === "fulfilled" ? h.value.history ?? [] : []);
  }, [cityId]);

  useEffect(() => {
    // A server read; its state changes happen when it answers.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStatus(null); setOutside(undefined); setHistory(null); setPlan(null); setPlanError(null); setManual(null);
    load();
  }, [load]);

  const askGoogle = async () => {
    setPlanning(true);
    setPlanError(null);
    try {
      const p = await seeding("plan_city_box", { cityId });
      setPlan(p);
      setManual({ ...p.box });
    } catch (err) {
      setPlanError(err.message);
    } finally {
      setPlanning(false);
    }
  };

  const apply = async (kind) => {
    setBusy(true);
    try {
      const body = kind === "manual"
        ? { cityId, manualBox: Object.fromEntries(Object.entries(manual).map(([k, v]) => [k, Number(v)])), confirm: true }
        : { cityId, confirm: plan && !plan.autoApply ? true : undefined };
      const res = await seeding("apply_city_box", body);
      if (!res.applied) {
        addToast({ variant: "info", title: "The box is already right", description: "Google's box adds nothing to it." });
      } else {
        const out = Number(res.placesOutside?.outside_active ?? 0);
        addToast({
          variant: out > 0 ? "warning" : "success",
          title: `Box saved: ${count(res.tileCount)} tiles, ${count(res.retiredTiles)} retired`,
          description: out > 0 ? `${count(out)} active places sit outside the new box. Nothing was deleted.` : undefined,
        });
      }
      setConfirm(null);
      setPlan(null);
      await load();
      onChanged();
    } catch (err) {
      addToast({ variant: "error", title: "The box was not saved", description: err.message });
    } finally {
      setBusy(false);
    }
  };

  const runCompleteness = async () => {
    setBusy(true);
    try {
      const res = await seeding("run_completeness_check", { cityId, confirm: true });
      const summary = completenessSummary(res);
      addToast(summary.failed
        ? { variant: "error", title: summary.text, description: res.error_message ?? undefined }
        : { variant: "success", title: "Completeness check done", description: summary.text });
      setConfirm(null);
      await load();
    } catch (err) {
      addToast({ variant: "error", title: "The check did not run", description: err.message });
    } finally {
      setBusy(false);
    }
  };

  const manualValid = manual && ["swLat", "swLng", "neLat", "neLng"].every((k) => Number.isFinite(Number(manual[k])))
    && Number(manual.swLat) < Number(manual.neLat) && Number(manual.swLng) < Number(manual.neLng);
  const manualChanged = manual && plan && ["swLat", "swLng", "neLat", "neLng"].some((k) => Number(manual[k]) !== Number(plan.box[k]));
  const checks = status?.checks ?? {};
  const last = status?.last_completeness_check;

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <SectionCard title="Geo box" subtitle="Google's box applies on its own unless it needs a person.">
        <div className="flex flex-col gap-3">
          {outside === undefined ? (
            <div className="flex items-center gap-2 text-sm text-[var(--color-text-tertiary)]"><Spinner size="sm" /> Checking places against the box…</div>
          ) : outside === null ? (
            <p className="text-sm text-[var(--color-text-tertiary)]">Couldn't count places outside the box.</p>
          ) : (
            <OutsideLine label="Current box" row={outside} />
          )}

          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" icon={MapPinned} onClick={askGoogle} loading={planning}>Ask Google for this city's box</Button>
          </div>
          {planError && <AlertCard variant="error" title="Couldn't get Google's box">{planError}</AlertCard>}

          {plan && (
            <div className="flex flex-col gap-2 rounded-lg border border-[var(--color-border)] p-3 text-sm">
              <p><span className="text-[var(--color-text-secondary)]">Google ({plan.query}):</span> {boxText(plan.google?.box)}</p>
              <p><span className="text-[var(--color-text-secondary)]">Stored:</span> {boxText(plan.stored)}</p>
              <p><span className="text-[var(--color-text-secondary)]">Proposed:</span> {boxText(plan.box)}{plan.grewEdges?.length ? ` (grows to the ${plan.grewEdges.map((e) => EDGE_WORD[e] ?? e).join(", ")})` : ""}</p>
              <p className="tabular-nums">{count(plan.tiles)} tiles · seeding about {usd(plan.estimatedSeedCostUsd)}</p>
              <OutsideLine label="Proposed box" row={plan.placesOutside} />
              {Array.isArray(plan.overlaps) && plan.overlaps.length > 0 && (
                <p className="text-[var(--color-text-secondary)]">Overlaps {plan.overlaps.map((o) => o.name ?? o.city_name).join(", ")}. Allowed when updating.</p>
              )}
              {!plan.changed ? (
                <Badge variant="success">Nothing to change</Badge>
              ) : plan.autoApply ? (
                <Button size="sm" onClick={() => apply("google")} loading={busy && confirm === null}>Apply Google's box</Button>
              ) : (
                <>
                  <AlertCard variant="warning" title="This box needs a person">{(plan.askReasons ?? []).map((r) => ASK_REASON_TEXT[r] ?? r).join(". ")}.</AlertCard>
                  <Button size="sm" onClick={() => setConfirm({ kind: "google" })}>Review and apply</Button>
                </>
              )}

              <details className="mt-2">
                <summary className="cursor-pointer text-[var(--color-text-secondary)]">Adjust by hand</summary>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {[["swLat", "South edge (lat)"], ["swLng", "West edge (lng)"], ["neLat", "North edge (lat)"], ["neLng", "East edge (lng)"]].map(([k, label]) => (
                    <label key={k} className="flex flex-col gap-1 text-xs font-medium text-[var(--color-text-secondary)]">
                      {label}
                      <input className={inputClass} inputMode="decimal" value={manual?.[k] ?? ""} onChange={(e) => setManual((m) => ({ ...m, [k]: e.target.value }))} />
                    </label>
                  ))}
                </div>
                <p className="mt-2 text-xs text-[var(--color-text-tertiary)]">Saving retires the old tiles and keeps their search history. Places outside are counted after saving; nothing is deleted.</p>
                <Button className="mt-2" size="sm" variant="secondary" disabled={!manualValid || !manualChanged} onClick={() => setConfirm({ kind: "manual" })}>Save this box</Button>
              </details>
            </div>
          )}

          {Array.isArray(history) && history.length > 0 && (
            <div className="text-sm">
              <div className="mb-1 font-medium">Retired tiles</div>
              <ul className="flex flex-col gap-1 text-xs tabular-nums text-[var(--color-text-secondary)]">
                {history.map((h) => (
                  <li key={h.retired_at}>{new Date(h.retired_at).toLocaleDateString()}: {count(h.tiles)} tiles, {count(h.searches)} searches, {count(h.places_new)} new places, {usd(h.cost_usd)}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </SectionCard>

      <SectionCard
        title="Are we missing places here?"
        action={<Button size="sm" variant="ghost" icon={RefreshCw} onClick={load} aria-label="Check again" />}
      >
        {statusError ? (
          <AlertCard variant="error" title="Couldn't read this city's searches">{statusError}</AlertCard>
        ) : !status ? (
          <div className="flex justify-center py-6"><Spinner /></div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm font-semibold">{status.complete ? "Searched completely, with a completeness check on record." : "Not complete yet."}</p>
            <div>
              <Check ok={checks.noUncoveredArea ?? null} text={`No area outside every tile${status.uncoveredTiles ? ` (${count(status.uncoveredTiles)} tiles needed)` : ""}`} />
              <Check ok={checks.noUnfinishedSearch ?? null} text={`Every search finished${status.unfinished?.total ? ` (${count(status.unfinished.never_searched)} never run, ${count(status.unfinished.failed)} failed)` : ""}`} />
              <Check ok={checks.noOpenCappedSearch ?? null} text={`No search left at the 20-result cap${status.capped_open ? ` (${count(status.capped_open)} capped)` : ""}${status.unresolved?.length ? `; ${count(status.unresolved.length)} unresolved at the smallest size` : ""}`} />
              {completenessSummary(last).failed ? (
                <Check ok={false} bad text={completenessSummary(last).text} />
              ) : (
                <Check ok={checks.completenessCheckOnRecord ?? null} text={last ? completenessSummary(last).text : "A completeness check on record"} />
              )}
            </div>
            <p className="text-xs text-[var(--color-text-tertiary)]">
              Dropped at seed: {count(status.dropped_at_seed?.no_photos)} with no photo, {count(status.dropped_at_seed?.closed_permanently)} permanently closed. They are not added, because Explorer cards need photos.
            </p>
            {last?.unknown_types?.length > 0 && (
              <p className="text-xs text-[var(--color-text-secondary)]">Types no search asks for: {last.unknown_types.slice(0, 12).map((t) => t.type ?? t).join(", ")}</p>
            )}
            <div>
              <Button size="sm" variant="secondary" icon={Search} onClick={() => setConfirm({ kind: "completeness" })}>Run a completeness check</Button>
            </div>
          </div>
        )}
      </SectionCard>

      <Modal open={!!confirm} onClose={busy ? () => {} : () => setConfirm(null)} title={confirm?.kind === "completeness" ? "Run a completeness check?" : `Change ${city.city_name}'s box?`}>
        <ModalBody>
          <div className="flex flex-col gap-2 text-sm text-[var(--color-text-secondary)]">
            {confirm?.kind === "completeness" ? (
              <p>20 paid Google searches at random points in the box, the same price as 20 seeding searches. It measures what share of places Google knows here is missing from the pool.</p>
            ) : (
              <>
                <p>New box: {boxText(confirm?.kind === "manual" ? Object.fromEntries(Object.entries(manual ?? {}).map(([k, v]) => [k, Number(v)])) : plan?.box)}</p>
                <p>Old tiles are retired with their search history kept. New area stays unsearched until the next run.</p>
                {confirm?.kind === "google" && <p>{(plan?.askReasons ?? []).map((r) => ASK_REASON_TEXT[r] ?? r).join(". ")}.</p>}
                {confirm?.kind === "google" && Number(plan?.placesOutside?.outside_active ?? 0) > 0 && (
                  <p className="text-[var(--color-warning-700)]">{count(plan.placesOutside.outside_active)} active places would sit outside. Nothing is deleted.</p>
                )}
              </>
            )}
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setConfirm(null)} disabled={busy}>Keep as is</Button>
          <Button loading={busy} onClick={() => (confirm?.kind === "completeness" ? runCompleteness() : apply(confirm.kind))}>
            {confirm?.kind === "completeness" ? "Run the check" : "Save the box"}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
