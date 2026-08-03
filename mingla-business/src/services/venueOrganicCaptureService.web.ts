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
const pendingStarts = new Map<string, Promise<boolean>>();

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

function scopeKey(scope: VenueOrganicCaptureScope): string {
  return `${scope.brandId}:${scope.venueId}`;
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
): Promise<boolean> {
  if (readStoredConsent() !== "granted") return false;
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
      return false;
    }
    if (
      data?.accepted === true &&
      typeof data.journeyToken === "string" &&
      data.journeyToken.length > 0
    ) {
      writeJourney({ ...scope, token: data.journeyToken });
    }
    return data?.accepted === true;
  } catch (error) {
    console.warn("[venueOrganicCapture] capture failed (non-blocking)", error);
    return false;
  }
}

async function ensureJourney(scope: VenueOrganicCaptureScope): Promise<boolean> {
  if (readJourney(scope) !== null) return true;
  const key = scopeKey(scope);
  const pending = pendingStarts.get(key);
  if (pending !== undefined) return pending;
  const start = send(scope, "page_view").finally(() => {
    pendingStarts.delete(key);
  });
  pendingStarts.set(key, start);
  return start;
}

export async function startVenueOrganicJourney(
  scope: VenueOrganicCaptureScope,
): Promise<void> {
  await ensureJourney(scope);
}

export async function captureVenueOrganicEvent(
  scope: VenueOrganicCaptureScope,
  eventType: VenueOrganicCaptureEvent,
): Promise<void> {
  if (readStoredConsent() !== "granted") return;
  if (!await ensureJourney(scope)) return;
  await send(scope, eventType);
}

export function getVenueOrganicJourneyToken(
  scope: VenueOrganicCaptureScope,
): string | null {
  return readJourney(scope)?.token ?? null;
}

export function settleVenueOrganicJourneyOnConsent(
  scope: VenueOrganicCaptureScope,
): () => void {
  let cancelled = false;
  let listening = false;
  const stopListening = (): void => {
    if (!listening) return;
    window.removeEventListener("click", afterConsentInteraction);
    window.removeEventListener("storage", afterConsentInteraction);
    listening = false;
  };
  const attempt = (): void => {
    if (cancelled) return;
    const consent = readStoredConsent();
    if (consent === "granted") {
      stopListening();
      void ensureJourney(scope);
      return;
    }
    if (consent === "denied") {
      stopListening();
      return;
    }
    if (!listening) {
      window.addEventListener("click", afterConsentInteraction);
      window.addEventListener("storage", afterConsentInteraction);
      listening = true;
    }
  };
  function afterConsentInteraction(): void {
    queueMicrotask(attempt);
  }
  attempt();
  return () => {
    cancelled = true;
    stopListening();
  };
}
