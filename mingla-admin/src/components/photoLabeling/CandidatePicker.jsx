/**
 * CandidatePicker — ORCH-0708 Phase 0
 *
 * Modal that fetches candidate places from `place_pool` and lets the operator
 * pick one to label. Two modes:
 *
 *   mode="anchor", category="upscale_steakhouse" | ... | "adult_venue"
 *     - Runs the per-category SQL filter from ANCHOR_CANDIDATE_FILTERS.
 *     - Special case: adult_venue has no automatic filter — swap to a debounced
 *       name-search input (ilike '%text%').
 *
 *   mode="fixture", city="Raleigh" | "Cary" | "Durham"
 *     - Runs the broader fixture query: is_servable=true AND is_active=true
 *       AND city=$1 ORDER BY review_count DESC LIMIT 50.
 *
 * Five states: idle (initial fetch in flight) | loading | error | empty | populated.
 *
 * Spec §24.4 (anchor candidate queries) + §24.3 (fixture broader query).
 */

import { useEffect, useState, useCallback } from "react";
import { Search, RefreshCw } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { Modal, ModalBody, ModalFooter } from "../ui/Modal";
import { AlertCard } from "../ui/Card";
import { Button } from "../ui/Button";
import { Spinner } from "../ui/Spinner";
import { Input } from "../ui/Input";
import {
  ANCHOR_CANDIDATE_FILTERS,
  FIXTURE_CITIES,
  ANCHOR_CATEGORIES,
} from "../../constants/photoLabeling";

const FIXTURE_LIMIT = 50;
const ANCHOR_LIMIT = 10;
const NAME_SEARCH_DEBOUNCE_MS = 250;

const PLACE_POOL_COLUMNS =
  "id, name, primary_type, types, rating, review_count, address, city, stored_photo_urls";

// ── Card thumbnail strip ────────────────────────────────────────────────────

function CandidateCard({ place, onPick, picking, anyPicking }) {
  const photos = (place.stored_photo_urls || []).slice(0, 5);
  const isThis = picking === place.id;

  return (
    <div className="border border-[var(--gray-200)] rounded-lg p-3 bg-[var(--color-background-primary)] hover:border-[var(--color-brand-300)] transition-colors duration-150 flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-sm font-semibold text-[var(--color-text-primary)] truncate">
          {place.name || "Unnamed"}
        </h4>
        {place.rating != null && (
          <span className="text-xs text-[var(--color-text-secondary)] shrink-0 font-mono">
            ★ {Number(place.rating).toFixed(1)}
            {place.review_count != null && ` · ${place.review_count}`}
          </span>
        )}
      </div>

      <div className="text-[11px] text-[var(--color-text-tertiary)] uppercase tracking-wide font-mono">
        {(place.primary_type || "—").replace(/_/g, " ")}
        {place.city && <span className="ml-2 normal-case tracking-normal text-[var(--color-text-tertiary)]">· {place.city}</span>}
      </div>

      {photos.length > 0 ? (
        <div className="grid grid-cols-5 gap-1">
          {photos.map((url, idx) => (
            <div
              key={url + idx}
              className="aspect-square rounded overflow-hidden border border-[var(--gray-200)]"
            >
              <img
                src={url}
                alt=""
                className="w-full h-full object-cover"
                loading="lazy"
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="text-xs text-[var(--color-text-tertiary)] italic py-2">
          No photos backfilled
        </div>
      )}

      {place.address && (
        <p className="text-xs text-[var(--color-text-tertiary)] truncate">{place.address}</p>
      )}

      <Button
        size="sm"
        variant="primary"
        onClick={() => onPick(place)}
        loading={isThis}
        disabled={anyPicking}
      >
        {isThis ? "Loading…" : "Pick this place"}
      </Button>
    </div>
  );
}

// ── Helpers: build the Supabase query per mode ──────────────────────────────

async function fetchAnchorCandidates(category, nameSearch) {
  const filter = ANCHOR_CANDIDATE_FILTERS[category];
  if (!filter) {
    throw new Error(`Unknown anchor category: ${category}`);
  }

  let q = supabase
    .from("place_pool")
    .select(PLACE_POOL_COLUMNS)
    .eq("is_active", true)
    .eq("is_servable", true)
    .in("city", FIXTURE_CITIES);

  if (filter.where == null) {
    // adult_venue path — name search only
    const term = (nameSearch || "").trim();
    if (!term) {
      return { data: [], reason: "type-to-search" };
    }
    q = q.ilike("name", `%${term}%`).order("review_count", { ascending: false }).limit(ANCHOR_LIMIT);
  } else {
    // Pre-built WHERE fragment from constants — apply via .or() for OR cases,
    // or compose via individual chain calls. The fragments are simple enough
    // that we can re-translate them into JS-builder calls per category.
    q = applyAnchorFilter(q, category).limit(ANCHOR_LIMIT);
  }

  const { data, error } = await q;
  if (error) throw error;
  return { data: data || [], reason: null };
}

// Translate the documented WHERE fragments from constants/photoLabeling.js
// into Supabase-builder calls. This duplicates the SQL strings but keeps the
// constants file as documentation-of-intent and the live query type-safe.
function applyAnchorFilter(q, category) {
  switch (category) {
    case "upscale_steakhouse":
      return q
        .in("primary_type", ["fine_dining_restaurant", "steak_house"])
        .gte("rating", 4.5)
        .gte("review_count", 100)
        .order("review_count", { ascending: false });
    case "sunny_brunch_cafe":
      // (primary_type = 'brunch_restaurant' OR 'breakfast_restaurant' = ANY(types))
      // AND rating >= 4.4 AND review_count >= 50
      return q
        .or("primary_type.eq.brunch_restaurant,types.cs.{breakfast_restaurant}")
        .gte("rating", 4.4)
        .gte("review_count", 50)
        .order("review_count", { ascending: false });
    case "neon_dive_bar":
      return q
        .or("primary_type.eq.night_club,types.cs.{bar}")
        .gte("rating", 4.0)
        .gte("review_count", 80)
        .order("review_count", { ascending: false });
    case "average_storefront":
      return q
        .in("primary_type", ["pizza_restaurant", "sandwich_shop", "convenience_store"])
        .gte("rating", 3.5)
        .lte("rating", 4.2)
        .gte("review_count", 30)
        .lte("review_count", 200)
        .order("review_count", { ascending: false });
    case "cozy_coffee_shop":
      return q
        .in("primary_type", ["cafe", "coffee_shop"])
        .gte("rating", 4.5)
        .gte("review_count", 80)
        .order("review_count", { ascending: false });
    default:
      throw new Error(`Unhandled anchor category for filter: ${category}`);
  }
}

async function fetchFixtureCandidates(city) {
  const { data, error } = await supabase
    .from("place_pool")
    .select(PLACE_POOL_COLUMNS)
    .eq("is_active", true)
    .eq("is_servable", true)
    .eq("city", city)
    .order("review_count", { ascending: false })
    .limit(FIXTURE_LIMIT);
  if (error) throw error;
  return { data: data || [], reason: null };
}

// ── Main component ─────────────────────────────────────────────────────────

export function CandidatePicker({ open, onClose, mode, category, city, onPick }) {
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [emptyReason, setEmptyReason] = useState(null);
  const [picking, setPicking] = useState(null);
  const [nameSearch, setNameSearch] = useState("");
  const [debouncedNameSearch, setDebouncedNameSearch] = useState("");

  const isAdultVenue = mode === "anchor" && category === "adult_venue";
  const categoryMeta = ANCHOR_CATEGORIES.find((c) => c.id === category);

  // Debounce the name-search input for adult_venue
  useEffect(() => {
    if (!isAdultVenue) return;
    const t = setTimeout(() => setDebouncedNameSearch(nameSearch), NAME_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [nameSearch, isAdultVenue]);

  const fetchCandidates = useCallback(async () => {
    setLoading(true);
    setError(null);
    setEmptyReason(null);
    try {
      let result;
      if (mode === "anchor") {
        result = await fetchAnchorCandidates(category, debouncedNameSearch);
      } else if (mode === "fixture") {
        if (!city) throw new Error("Fixture mode requires a city");
        result = await fetchFixtureCandidates(city);
      } else {
        throw new Error(`Unknown picker mode: ${mode}`);
      }
      setCandidates(result.data);
      setEmptyReason(result.reason);
    } catch (err) {
      // No silent failure: surface the message so operator can act
      console.error("[CandidatePicker] fetch failed:", err);
      setError(err?.message || "Couldn't fetch candidates. Try again.");
    } finally {
      setLoading(false);
    }
  }, [mode, category, city, debouncedNameSearch]);

  // Reset + fetch when the modal opens or its target changes
  useEffect(() => {
    if (!open) return;
    setNameSearch("");
    setDebouncedNameSearch("");
    setPicking(null);
  }, [open, mode, category, city]);

  useEffect(() => {
    if (!open) return;
    fetchCandidates();
  }, [open, fetchCandidates]);

  async function handlePick(place) {
    setPicking(place.id);
    try {
      await onPick(place);
    } finally {
      // Parent typically closes the modal on success, but in case it doesn't
      // (or pick fails), re-enable the buttons.
      setPicking(null);
    }
  }

  const titlePrefix = mode === "anchor" ? "Pick anchor candidate" : "Pick fixture candidate";
  const titleSuffix =
    mode === "anchor"
      ? categoryMeta?.label || category
      : city || "—";
  const title = `${titlePrefix} · ${titleSuffix}`;

  return (
    <Modal open={open} onClose={onClose} title={title} size="lg">
      <ModalBody>
        {/* Mode-specific header copy */}
        {mode === "anchor" && categoryMeta && (
          <p className="text-sm text-[var(--color-text-secondary)] mb-3">
            {categoryMeta.description}. Scoped to Raleigh / Cary / Durham.
          </p>
        )}
        {mode === "fixture" && (
          <p className="text-sm text-[var(--color-text-secondary)] mb-3">
            Top {FIXTURE_LIMIT} servable places in {city} by review count. Pick a healthy spread —
            dining-positive, mid-range, photo-weak, false-positive guards.
          </p>
        )}

        {/* adult_venue name-search box */}
        {isAdultVenue && (
          <div className="mb-4 flex items-center gap-2">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-tertiary)] pointer-events-none" />
              <Input
                value={nameSearch}
                onChange={(e) => setNameSearch(e.target.value)}
                placeholder="Type a place name (e.g. 'Trapeze')"
                className="pl-9"
                autoFocus
              />
            </div>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <Spinner size="md" />
            <p className="text-sm text-[var(--color-text-secondary)]">Fetching candidates…</p>
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <AlertCard
            variant="error"
            title="Couldn't fetch candidates"
            action={
              <Button size="sm" variant="secondary" icon={RefreshCw} onClick={fetchCandidates}>
                Retry
              </Button>
            }
          >
            {error}
          </AlertCard>
        )}

        {/* Empty — adult_venue type-to-search idle state */}
        {!loading && !error && emptyReason === "type-to-search" && (
          <AlertCard variant="info" title="Type to search">
            Adult venues don't have a clean Google primary_type filter. Type a place name above —
            the picker will run an `ilike` search over the active place_pool.
          </AlertCard>
        )}

        {/* Empty — no matches */}
        {!loading && !error && emptyReason !== "type-to-search" && candidates.length === 0 && (
          <AlertCard variant="warning" title="No candidates match this filter">
            {mode === "fixture"
              ? `No servable places found in ${city}. Run seeding first via the Seed / Refresh tab.`
              : isAdultVenue && debouncedNameSearch
              ? `No active places match "${debouncedNameSearch}".`
              : "The filter didn't match any places in Raleigh / Cary / Durham. Loosen the filter or run seeding for these cities."}
          </AlertCard>
        )}

        {/* Populated */}
        {!loading && !error && candidates.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {candidates.map((place) => (
              <CandidateCard
                key={place.id}
                place={place}
                onPick={handlePick}
                picking={picking}
                anyPicking={picking != null}
              />
            ))}
          </div>
        )}
      </ModalBody>

      <ModalFooter>
        <span className="text-xs text-[var(--color-text-tertiary)] mr-auto">
          {candidates.length > 0 && `${candidates.length} candidate${candidates.length === 1 ? "" : "s"}`}
        </span>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  );
}

export default CandidatePicker;
