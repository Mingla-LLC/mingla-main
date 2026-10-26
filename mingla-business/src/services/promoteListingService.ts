import { supabase } from "./supabase";

// #3872 — what the Promote hub and the brief editor need to know about one
// listing: its name, its (first) date for anchoring shoot dates, and its city.

export type PromoteListing = {
  kind: "event" | "venue";
  id: string;
  title: string;
  /** First date as local "YYYY-MM-DD" in the event's timezone (events only). */
  startDay: string | null;
  cityName: string | null;
};

export type ProgramCity = { id: string; name: string };

function dayInZone(iso: string, timeZone: string | null): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone ?? undefined,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const get = (type: string) =>
      parts.find((part) => part.type === type)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch {
    return iso.slice(0, 10);
  }
}

export async function fetchPromoteListing(
  kind: "event" | "venue",
  id: string,
): Promise<PromoteListing> {
  if (kind === "venue") {
    const { data, error } = await supabase
      .from("venue_listings")
      .select("id,name")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return {
      kind,
      id,
      title: String(data?.name ?? "Your venue"),
      startDay: null,
      cityName: null,
    };
  }
  const [event, dates, view] = await Promise.all([
    supabase
      .from("events")
      .select("id,title,timezone")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("event_dates")
      .select("start_at,timezone")
      .eq("event_id", id)
      .order("start_at", { ascending: true })
      .limit(1),
    supabase
      .from("business_management_events_view")
      .select("city")
      .eq("id", id)
      .maybeSingle(),
  ]);
  if (event.error) throw event.error;
  const first = Array.isArray(dates.data) ? dates.data[0] : null;
  const zone =
    typeof first?.timezone === "string"
      ? first.timezone
      : typeof event.data?.timezone === "string"
        ? event.data.timezone
        : null;
  return {
    kind,
    id,
    title: String(event.data?.title ?? "Your event"),
    startDay:
      first && typeof first.start_at === "string"
        ? dayInZone(first.start_at, zone)
        : null,
    cityName:
      !view.error &&
      typeof view.data?.city === "string" &&
      view.data.city.trim().length > 0
        ? view.data.city
        : null,
  };
}

export async function fetchProgramCities(): Promise<ProgramCity[]> {
  const { data, error } = await supabase
    .from("seeding_cities")
    .select("id,name")
    .eq("is_live_for_consumers", true)
    .order("name")
    .limit(100);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: String(row.id),
    name: String(row.name),
  }));
}

/** Best guess at the shoot city from the listing's city text. */
export function matchCity(
  cities: readonly ProgramCity[],
  cityName: string | null,
): ProgramCity | null {
  if (cities.length === 1) return cities[0];
  if (!cityName) return null;
  const needle = cityName.trim().toLowerCase();
  return (
    cities.find((city) => city.name.toLowerCase() === needle) ??
    cities.find(
      (city) =>
        needle.includes(city.name.toLowerCase()) ||
        city.name.toLowerCase().includes(needle),
    ) ??
    null
  );
}
