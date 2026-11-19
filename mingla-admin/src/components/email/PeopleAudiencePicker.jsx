// Issue #4226 Phase 2 (spec D8, D10, D11) — the Email audience built from the
// People filter.
//
//   Activation plays  ready-made groups, each a saved People filter with its
//                     live count (admin_people_filter_counts, the function
//                     People counts with). "Edit filters" opens a play in the
//                     builder.
//   Build a group     the same faceted filters as People: every option exists
//                     in the chosen track and shows its count; chips remove a
//                     filter; "Save as a group" adds it to the plays.
//
// The composer sends { mode: "people", people: <filter> } to admin-send-email,
// so the estimate's "matched" equals the People count for the same filter,
// then lists who the rules leave out.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "../ui/Button";
import { FilterSelect } from "../ui/FilterSelect";
import { LoadError } from "../ui/LoadError";
import { Spinner } from "../ui/Spinner";
import { getPeopleFacets, getPeopleFilterCounts } from "../../services/peopleService";
import {
  ACTIVATION_PLAYS,
  FILTER_LABELS,
  PLAY_GROUPS,
  TRACK_LABELS,
  cleanFilter,
  facetOptions,
  filterChips,
  peopleHrefFor,
  playForFilter,
  readSavedGroups,
  saveGroup,
  withoutKey,
} from "../../lib/peopleFilter";

/** The builder's filters, in order (track first). */
export const BUILDER_KEYS = Object.freeze([
  "explorer_stage", "host_next_step", "source", "activity_status", "country", "city",
  "payout_country", "bank_connected", "brand_id", "emails_ok", "joined_window",
]);

function browserStorage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

export function PeopleAudiencePicker({ mode, filter, playId, onChoose, onEditFilters, onUseMessage }) {
  const [savedGroups, setSavedGroups] = useState(() => readSavedGroups(browserStorage()));
  const plays = useMemo(() => [...ACTIVATION_PLAYS, ...savedGroups], [savedGroups]);
  const [playCounts, setPlayCounts] = useState(null);
  const [countsError, setCountsError] = useState(null);
  const [countsAttempt, setCountsAttempt] = useState(0);
  const [facets, setFacets] = useState(null);
  const [facetsError, setFacetsError] = useState(null);
  const [facetsAttempt, setFacetsAttempt] = useState(0);
  const [saveName, setSaveName] = useState("");
  const [saveNote, setSaveNote] = useState(null);
  const clean = useMemo(() => cleanFilter(filter), [filter]);
  const filterKey = JSON.stringify(clean);
  const playsKey = plays.map((p) => `${p.id}:${JSON.stringify(p.filter)}`).join("|");

  // Live counts for every play, in one server pass.
  useEffect(() => {
    if (mode !== "plays") return undefined;
    let live = true;
    getPeopleFilterCounts(Object.fromEntries(plays.map((p) => [p.id, p.filter])))
      .then((counts) => { if (live) { setPlayCounts(counts); setCountsError(null); } })
      .catch((err) => { if (live) { setPlayCounts(null); setCountsError(err?.message || "Couldn't count the plays."); } });
    return () => { live = false; };
    // playsKey stands for the plays and their filters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, playsKey, countsAttempt]);

  // Facets for the builder: options that exist, with counts.
  useEffect(() => {
    if (mode !== "people") return undefined;
    let live = true;
    getPeopleFacets(JSON.parse(filterKey))
      .then((result) => { if (live) { setFacets(result); setFacetsError(null); } })
      .catch((err) => { if (live) { setFacets(null); setFacetsError(err?.message || "Couldn't load the filter options."); } });
    return () => { live = false; };
  }, [mode, filterKey, facetsAttempt]);

  const brandNames = useMemo(() => {
    const out = {};
    for (const o of facets?.facets?.brand_id || []) out[o.value] = o.label;
    return out;
  }, [facets]);

  const setKey = useCallback((key, value) => {
    const next = { ...clean };
    if (value) next[key] = value;
    else delete next[key];
    onChoose(next, null);
  }, [clean, onChoose]);

  const doSave = () => {
    const storage = browserStorage();
    if (!storage) {
      setSaveNote({ ok: false, text: "This browser won't save groups (private mode?). Copy the filters instead." });
      return;
    }
    try {
      const next = saveGroup(storage, savedGroups, { name: saveName, filter: clean });
      setSavedGroups(next);
      setSaveName("");
      setSaveNote({ ok: true, text: "Saved. It now appears under Your saved groups in Activation plays (this browser only for now)." });
    } catch (err) {
      setSaveNote({ ok: false, text: err?.message || "Couldn't save this group." });
    }
  };

  if (mode === "plays") {
    const groups = [...PLAY_GROUPS, ...(savedGroups.length ? ["Your saved groups"] : [])];
    // The card, message and starting point follow the filter that is selected,
    // never an id left over from an earlier choice.
    const current = playForFilter(plays, clean, playId);
    return (
      <div className="flex flex-col gap-4" data-activation-plays>
        <p className="text-xs text-[var(--color-text-secondary)]">
          Ready-made groups of people one step from their next stage. Each is a People filter: the count here is the People count, and "Edit filters" opens it in the builder.
        </p>
        {countsError && <LoadError title="Couldn't count the plays" message={countsError} onRetry={() => setCountsAttempt((n) => n + 1)} />}
        {groups.map((group) => (
          <section key={group} className="flex flex-col gap-2" aria-label={group}>
            <h4 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">{group}</h4>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {plays.filter((p) => p.group === group).map((p) => {
                const on = current ? p.id === current.id : false;
                const count = playCounts && Number.isFinite(Number(playCounts[p.id])) ? Number(playCounts[p.id]) : null;
                return (
                  <button
                    key={p.id}
                    type="button"
                    aria-pressed={on}
                    data-play={p.id}
                    onClick={() => onChoose(p.filter, p.id)}
                    className={`flex flex-col gap-1 rounded-xl border px-3 py-3 text-left transition ${on ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)]" : "border-[var(--gray-200)] bg-[var(--color-background-primary)] hover:border-[var(--gray-300)]"}`}
                  >
                    <span className="flex items-baseline justify-between gap-2">
                      <strong className="text-sm text-[var(--color-text-primary)]">{p.name}</strong>
                      <span className="text-sm font-semibold tabular-nums text-[var(--color-text-primary)]">
                        {count === null ? (countsError ? "—" : <Spinner size="xs" />) : count.toLocaleString()}
                      </span>
                    </span>
                    <span className="text-xs text-[var(--color-text-secondary)]">{p.who}</span>
                    <span className="text-xs text-[var(--color-text-tertiary)]">Goal: {p.goal}</span>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
        {current && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--gray-200)] bg-[var(--gray-50)] px-3 py-2.5 text-sm">
            <span className="min-w-0 flex-1 text-[var(--color-text-secondary)]">
              {current.message ? <>Suggested message: <em>{current.message}</em></> : "Write a message that fits this group."}
            </span>
            <Button variant="secondary" size="sm" onClick={() => onUseMessage(current)}>Use as a starting point</Button>
            <Button variant="secondary" size="sm" onClick={() => onEditFilters(current.filter)}>Edit filters</Button>
            <a href={peopleHrefFor(current.filter)} className="text-xs font-semibold text-[var(--color-brand-700)] hover:underline">See these people in People</a>
          </div>
        )}
      </div>
    );
  }

  // Build a group.
  const chips = filterChips(clean, brandNames);
  const trackOptions = Object.entries(TRACK_LABELS)
    .filter(([value]) => value !== "internal")
    .map(([value, label]) => ({ value, label }));
  return (
    <div className="flex flex-col gap-3" data-people-builder>
      <p className="text-xs text-[var(--color-text-secondary)]">
        The same filters as People. They combine with AND, and each option shows how many people it gives with the other filters kept.
      </p>
      {facetsError && <LoadError title="Couldn't load the filter options" message={facetsError} onRetry={() => setFacetsAttempt((n) => n + 1)} />}
      <div className="flex flex-wrap gap-3">
        <FilterSelect
          name="track"
          label={FILTER_LABELS.track}
          value={clean.track || ""}
          options={[{ value: "", label: "Everyone we can email" }, ...trackOptions]}
          onChange={(value) => setKey("track", value)}
        />
        {BUILDER_KEYS.map((key) => {
          const options = facetOptions(key, facets?.facets);
          const value = clean[key] || "";
          if (!options.length && !value) return null;
          const withValue = value && !options.some((o) => o.value === value) ? [{ value, label: `${value} (0)` }, ...options] : options;
          return (
            <FilterSelect
              key={key}
              name={key}
              label={FILTER_LABELS[key]}
              value={value}
              options={[{ value: "", label: "Any" }, ...withValue]}
              onChange={(next) => setKey(key, next)}
            />
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2" aria-label="Active filters">
        {chips.length === 0 ? (
          <span className="text-xs text-[var(--color-text-tertiary)]">No filters yet: this is everyone we can email.</span>
        ) : chips.map((chip) => (
          chip.removable ? (
            <button
              key={chip.key}
              type="button"
              aria-label={`Remove filter ${chip.label}`}
              onClick={() => onChoose(withoutKey(clean, chip.key), null)}
              className="rounded-full border border-[var(--color-brand-300)] bg-[var(--color-brand-50)] px-3 py-1 text-xs font-medium text-[var(--color-brand-700)]"
            >
              {chip.label} ×
            </button>
          ) : (
            <span key={chip.key} className="rounded-full border border-[var(--gray-200)] px-3 py-1 text-xs text-[var(--color-text-secondary)]">{chip.label}</span>
          )
        ))}
      </div>
      {facets && facets.total === 0 && chips.length > 0 && (
        <p className="text-sm text-[var(--color-text-secondary)]" role="status">Nobody has all of these at once. Remove a filter above.</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={saveName}
          onChange={(e) => setSaveName(e.target.value)}
          placeholder="Name this group"
          aria-label="Group name"
          className="h-9 w-48 rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-2 text-xs text-[var(--color-text-primary)]"
        />
        <Button variant="secondary" size="sm" onClick={doSave} disabled={chips.length === 0}>Save as a group</Button>
        {chips.length > 0 && <Button variant="ghost" size="sm" onClick={() => onChoose({}, null)}>Clear all filters</Button>}
        {chips.length > 0 && <a href={peopleHrefFor(clean)} className="text-xs font-semibold text-[var(--color-brand-700)] hover:underline">See these people in People</a>}
        {saveNote && (
          <span role="status" className={`text-xs ${saveNote.ok ? "text-emerald-700" : "text-[var(--color-error-700)]"}`}>{saveNote.text}</span>
        )}
      </div>
    </div>
  );
}
