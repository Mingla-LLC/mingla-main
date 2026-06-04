/**
 * Global search — domain → index-entry adapters.
 *
 * META-ORCH-1073 Sub-A. SPEC §3.1.1 (adapters are pure, live beside the
 * service) + §3.1.5 (source caches: events / trips / experiences) + §12.1
 * R-1 (INCLUDE DRAFTS) + R-2 (route via `routeForEventRow` — MANDATORY).
 *
 * Every offering route is produced by `routeForEventRow` so the
 * strict-grep gate `i-proposed-tr2-route-by-event-type.mjs` is honored and
 * trips/experiences/drafts never dead-tap. Experiences resolve to
 * `/experience/coming-soon` exactly as the hub does today (DESIGN N-6).
 *
 * Offering rows are visible to any team member who can load the hub →
 * minRank 10 (SPEC §3.6). The EDIT affordance inside each detail screen
 * stays role-gated by that screen; this index routes to the canonical
 * detail/edit route the hub already uses, never a separate edit-only one.
 *
 * Adapters return `[]` for null/empty inputs and NEVER throw (SPEC §3.3).
 */

import { routeForEventRow } from "../../utils/routeForEventRow";
import type { LiveEvent } from "../../store/liveEventStore";
import type { DraftEvent } from "../../store/draftEventStore";
import type { Trip } from "../../services/tripsService";
import type { VenueExperience } from "../../services/experiencesService";
import { normalizeSearchText } from "./normalize";
import type { SearchIndexEntry, SearchResultType } from "./types";

/** minRank for every offering — any hub-capable member may view (SPEC §3.6). */
const OFFERING_MIN_RANK = 10;

/** Title-case a lifecycle status word for subtitle display. */
function statusLabel(status: string | null | undefined): string | null {
  if (status === null || status === undefined || status.length === 0) {
    return null;
  }
  return status.charAt(0).toUpperCase() + status.slice(1);
}

/** Per-type leading icon (DESIGN §9). */
function iconForOffering(type: SearchResultType): SearchIndexEntry["iconName"] {
  switch (type) {
    case "event":
      return "calendar";
    case "trip":
      return "compass";
    case "experience":
      return "sparkle";
    default:
      return "calendar";
  }
}

/** Build the normalized searchText block from raw parts. */
function buildSearchText(parts: {
  title: string;
  keywords: string[];
  body: string | null;
  location: string | null;
}): SearchIndexEntry["searchText"] {
  return {
    title: normalizeSearchText(parts.title),
    keywords: parts.keywords
      .filter((k): k is string => typeof k === "string" && k.length > 0)
      .map(normalizeSearchText)
      .filter((k) => k.length > 0),
    body:
      parts.body !== null && parts.body.length > 0
        ? normalizeSearchText(parts.body)
        : null,
    location:
      parts.location !== null && parts.location.length > 0
        ? normalizeSearchText(parts.location)
        : null,
  };
}

// --------------------------------------------------------------------------
// Events (published) — useBusinessEventsForBrand → LiveEvent[]
// --------------------------------------------------------------------------

export function eventsToIndexEntries(
  events: readonly LiveEvent[] | null | undefined,
): SearchIndexEntry[] {
  if (events === null || events === undefined) return [];
  const out: SearchIndexEntry[] = [];
  for (const ev of events) {
    if (ev === null || ev === undefined || typeof ev.id !== "string") continue;
    const eventType = ev.event_type ?? "event";
    const route = routeForEventRow({
      id: ev.id,
      event_type: eventType,
      status: ev.status,
    });
    const location = ev.venueName ?? ev.address ?? null;
    const keywords = [
      ...(ev.partyTypes ?? []),
      ...(ev.vibeTags ?? []),
      ...(ev.musicGenres ?? []),
    ];
    out.push({
      type: eventType,
      id: ev.id,
      title: ev.name,
      subtitle: statusLabel(ev.status),
      route,
      group: "offerings",
      minRank: OFFERING_MIN_RANK,
      iconName: iconForOffering(eventType),
      recencyKey: ev.publishedAt ?? null,
      searchText: buildSearchText({
        title: ev.name,
        keywords,
        body: ev.description,
        location,
      }),
    });
  }
  return out;
}

// --------------------------------------------------------------------------
// Drafts (R-1) — useDraftEventStore.drafts → DraftEvent[]
// Draft events route via routeForEventRow → /event/{id}/edit (resume wizard).
// (Trips that are still drafts arrive via useTripsByBrand with status="draft".)
// --------------------------------------------------------------------------

export function draftsToIndexEntries(
  drafts: readonly DraftEvent[] | null | undefined,
  brandId: string | null,
): SearchIndexEntry[] {
  if (drafts === null || drafts === undefined) return [];
  const out: SearchIndexEntry[] = [];
  for (const d of drafts) {
    if (d === null || d === undefined || typeof d.id !== "string") continue;
    // Only the current brand's drafts (the index is brand-scoped).
    if (brandId !== null && d.brandId !== brandId) continue;
    const title = d.name.length > 0 ? d.name : "Untitled draft";
    const route = routeForEventRow({
      id: d.id,
      event_type: "event",
      status: "draft",
    });
    const location = d.venueName ?? d.address ?? null;
    const keywords = [
      ...(d.partyTypes ?? []),
      ...(d.vibeTags ?? []),
      ...(d.musicGenres ?? []),
    ];
    out.push({
      type: "event",
      id: d.id,
      title,
      subtitle: "Draft",
      route,
      group: "offerings",
      minRank: OFFERING_MIN_RANK,
      iconName: "calendar",
      recencyKey: d.updatedAt ?? d.createdAt ?? null,
      searchText: buildSearchText({
        title,
        keywords,
        body: d.description,
        location,
      }),
    });
  }
  return out;
}

// --------------------------------------------------------------------------
// Trips — useTripsByBrand → Trip[]
// Trip carries no location_text field — location omitted (do NOT fabricate).
// --------------------------------------------------------------------------

export function tripsToIndexEntries(
  trips: readonly Trip[] | null | undefined,
): SearchIndexEntry[] {
  if (trips === null || trips === undefined) return [];
  const out: SearchIndexEntry[] = [];
  for (const t of trips) {
    if (t === null || t === undefined || typeof t.id !== "string") continue;
    const route = routeForEventRow({
      id: t.id,
      event_type: "trip",
      status: t.status,
    });
    out.push({
      type: "trip",
      id: t.id,
      title: t.title,
      subtitle: statusLabel(t.status === "draft" ? "draft" : t.status),
      route,
      group: "offerings",
      minRank: OFFERING_MIN_RANK,
      iconName: "compass",
      recencyKey: t.updatedAt ?? t.createdAt ?? null,
      searchText: buildSearchText({
        title: t.title,
        keywords: [],
        body: t.description,
        location: null,
      }),
    });
  }
  return out;
}

// --------------------------------------------------------------------------
// Experiences — useExperiencesByBrand → VenueExperience[]
// Route resolves to /experience/coming-soon via routeForEventRow (R-2/N-6).
// --------------------------------------------------------------------------

export function experiencesToIndexEntries(
  experiences: readonly VenueExperience[] | null | undefined,
): SearchIndexEntry[] {
  if (experiences === null || experiences === undefined) return [];
  const out: SearchIndexEntry[] = [];
  for (const x of experiences) {
    if (x === null || x === undefined || typeof x.id !== "string") continue;
    const route = routeForEventRow({
      id: x.id,
      event_type: "experience",
      status: null,
    });
    out.push({
      type: "experience",
      id: x.id,
      title: x.title,
      subtitle: statusLabel(x.status),
      route,
      group: "offerings",
      minRank: OFFERING_MIN_RANK,
      iconName: "sparkle",
      recencyKey: x.createdAt ?? null,
      searchText: buildSearchText({
        title: x.title,
        keywords: x.intentTags ?? [],
        body: x.description,
        location: null,
      }),
    });
  }
  return out;
}
