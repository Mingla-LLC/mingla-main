import { supabase } from "./supabase";
import type { DiscoverAnchorV2 } from "../types/discoverFeed";

export interface DiscoverCityWatchStatus {
  id: string;
  cityKey: string;
  cityName: string | null;
  cityLabel: string;
  stateCode: string | null;
  countryCode: string | null;
  lat: number;
  lng: number;
  notifiedAt: string | null;
}

function watchError(error: { code?: string; message?: string } | null): Error {
  const code = error?.message?.match(/city_watch_[a-z_]+/)?.[0]
    ?? error?.code
    ?? "failed";
  return new Error(code.startsWith("city_watch_") ? code : `city_watch_${code}`);
}

function mapWatch(row: Record<string, unknown>): DiscoverCityWatchStatus {
  return {
    id: String(row.id),
    cityKey: String(row.city_key),
    cityName: typeof row.city_name === "string" ? row.city_name : null,
    cityLabel: String(row.city_label),
    stateCode: typeof row.state_code === "string" ? row.state_code : null,
    countryCode: typeof row.country_code === "string" ? row.country_code : null,
    lat: Number(row.lat),
    lng: Number(row.lng),
    notifiedAt: typeof row.notified_at === "string" ? row.notified_at : null,
  };
}

export const discoverCityWatchService = {
  async subscribe(anchor: DiscoverAnchorV2, label: string): Promise<{ watchId: string; cityKey: string; subscribed: true }> {
    const { data, error } = await supabase.rpc("discover_city_watch_subscribe", {
      p_name: anchor.name,
      p_state_code: anchor.stateCode,
      p_country_code: anchor.countryCode,
      p_lat: anchor.lat,
      p_lng: anchor.lng,
      p_label: label,
    });
    if (error) throw watchError(error);
    const response = data as Record<string, unknown> | null;
    if (!response?.watchId || !response.cityKey) throw new Error("city_watch_invalid_response");
    return { watchId: String(response.watchId), cityKey: String(response.cityKey), subscribed: true };
  },

  async unsubscribe(cityKey: string): Promise<void> {
    const { error } = await supabase.rpc("discover_city_watch_unsubscribe", {
      p_city_key: cityKey,
    });
    if (error) throw watchError(error);
  },

  async status(cityKey: string): Promise<DiscoverCityWatchStatus | null> {
    const { data, error } = await supabase
      .from("discover_city_watch")
      .select("id, city_key, city_name, city_label, state_code, country_code, lat, lng, notified_at")
      .eq("city_key", cityKey)
      .maybeSingle();
    if (error) throw watchError(error);
    return data ? mapWatch(data as Record<string, unknown>) : null;
  },
};
