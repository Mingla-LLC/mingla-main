import { Platform } from "react-native";
import { useAppStore } from "../store/appStore";
import { postHogService } from "./postHogService";
import { supabase } from "./supabase";

export type VenueOrganicCaptureEvent =
  | "page_view"
  | "menu_open"
  | "reservation_start"
  | "availability_shown";

interface Scope {
  brandId: string;
  venueId: string;
}

const tokens = new Map<string, string>();

function scopeKey(scope: Scope): string {
  return `${scope.brandId}:${scope.venueId}`;
}

function eventId(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (value) => {
    const random = Math.floor(Math.random() * 16);
    const nibble = value === "x" ? random : (random & 0x3) | 0x8;
    return nibble.toString(16);
  });
}

export async function captureVenueOrganicEvent(
  scope: Scope,
  eventType: VenueOrganicCaptureEvent,
): Promise<void> {
  await postHogService.initialize();
  if (useAppStore.getState().analyticsOptOut) return;
  try {
    const key = scopeKey(scope);
    const { data, error } = await supabase.functions.invoke<{
      accepted?: boolean;
      journeyToken?: string | null;
    }>("venue-organic-capture", {
      body: {
        eventId: eventId(),
        ...scope,
        eventType,
        surface: Platform.OS === "ios" ? "consumer_ios" : "consumer_android",
        journeyToken: tokens.get(key) ?? null,
      },
    });
    if (error !== null) {
      console.warn("[venueOrganicCapture] capture unavailable", error);
      return;
    }
    if (
      data?.accepted === true &&
      typeof data.journeyToken === "string" &&
      data.journeyToken.length > 0
    ) {
      tokens.set(key, data.journeyToken);
    }
  } catch (error) {
    console.warn("[venueOrganicCapture] capture failed (non-blocking)", error);
  }
}

export function getVenueOrganicJourneyToken(scope: Scope): string | null {
  return tokens.get(scopeKey(scope)) ?? null;
}
