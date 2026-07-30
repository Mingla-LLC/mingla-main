import {
  readReferrerHost,
  readStoredConsent,
} from "../analytics/webAnalytics";
import { supabase } from "./supabase";
import type {
  VenueOrganicCaptureEvent,
  VenueOrganicCaptureScope,
} from "./venueOrganicCaptureService";

const STORAGE_KEY = "mingla_venue_organic_journey_v1";

interface StoredJourney {
  brandId: string;
  venueId: string;
  token: string;
}

function eventId(): string {
  const maybeCrypto = (globalThis as { crypto?: Crypto }).crypto;
  if (typeof maybeCrypto?.randomUUID === "function") {
    return maybeCrypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (value) => {
    const random = Math.floor(Math.random() * 16);
    const nibble = value === "x" ? random : (random & 0x3) | 0x8;
    return nibble.toString(16);
  });
}

function readJourney(scope: VenueOrganicCaptureScope): StoredJourney | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Partial<StoredJourney>;
    return parsed.brandId === scope.brandId &&
        parsed.venueId === scope.venueId &&
        typeof parsed.token === "string"
      ? parsed as StoredJourney
      : null;
  } catch {
    return null;
  }
}

function writeJourney(journey: StoredJourney): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(journey));
  } catch (error) {
    console.warn("[venueOrganicCapture] journey storage unavailable", error);
  }
}

function hasAdSignal(): boolean {
  try {
    const params = new URLSearchParams(window.location.search);
    const paidMedium = (params.get("utm_medium") ?? "").toLowerCase();
    return [
      "fbclid", "ttclid", "sccid", "ScCid", "gclid", "rdt_cid",
      "af_c_id", "c_id", "mc_id",
    ].some((key) => params.has(key)) ||
      /^(?:cpc|ppc|paid(?:[_-](?:search|social))?|display)$/.test(paidMedium);
  } catch {
    return false;
  }
}

async function send(
  scope: VenueOrganicCaptureScope,
  eventType: VenueOrganicCaptureEvent,
): Promise<void> {
  if (readStoredConsent() !== "granted") return;
  const current = readJourney(scope);
  try {
    const { data, error } = await supabase.functions.invoke<{
      accepted?: boolean;
      journeyToken?: string | null;
    }>("venue-organic-capture", {
      body: {
        eventId: eventId(),
        brandId: scope.brandId,
        venueId: scope.venueId,
        eventType,
        surface: "buyer_web",
        journeyToken: current?.token ?? null,
        referrerHost: readReferrerHost(),
        hasAdSignal: hasAdSignal(),
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
      writeJourney({ ...scope, token: data.journeyToken });
    }
  } catch (error) {
    console.warn("[venueOrganicCapture] capture failed (non-blocking)", error);
  }
}

export async function startVenueOrganicJourney(
  scope: VenueOrganicCaptureScope,
): Promise<void> {
  await send(scope, "page_view");
}

export async function captureVenueOrganicEvent(
  scope: VenueOrganicCaptureScope,
  eventType: VenueOrganicCaptureEvent,
): Promise<void> {
  await send(scope, eventType);
}

export function getVenueOrganicJourneyToken(
  scope: VenueOrganicCaptureScope,
): string | null {
  return readJourney(scope)?.token ?? null;
}
