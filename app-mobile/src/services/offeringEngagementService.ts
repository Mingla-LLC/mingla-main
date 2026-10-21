import { Platform } from "react-native";
import { supabase } from "./supabase";

export type ConsumerOfferingEntityType =
  "event" | "trip" | "experience" | "venue";

export interface ConsumerOfferingScope {
  brandId: string;
  entityType: ConsumerOfferingEntityType;
  entityId: string;
}

type ConsumerOfferingEvent = "app_impression" | "app_open";

function eventId(): string {
  const maybeCrypto = (globalThis as { crypto?: Crypto }).crypto;
  if (typeof maybeCrypto?.randomUUID === "function")
    return maybeCrypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (value) => {
    const random = Math.floor(Math.random() * 16);
    const nibble = value === "x" ? random : (random & 0x3) | 0x8;
    return nibble.toString(16);
  });
}

export async function captureConsumerOfferingEngagement(
  scope: ConsumerOfferingScope,
  eventType: ConsumerOfferingEvent,
): Promise<void> {
  if (Platform.OS !== "ios" && Platform.OS !== "android") return;
  try {
    const { error } = await supabase.functions.invoke(
      "offering-engagement-capture",
      {
        body: {
          eventId: eventId(),
          brandId: scope.brandId,
          entityType: scope.entityType,
          entityId: scope.entityId,
          eventType,
          ctaType: null,
          checkoutSessionId: null,
          surface: Platform.OS === "ios" ? "consumer_ios" : "consumer_android",
          pageUrl: null,
          referrer: null,
        },
      },
    );
    if (error !== null) {
      console.warn("[offeringEngagement] capture unavailable", error);
    }
  } catch (error) {
    console.warn("[offeringEngagement] capture failed (non-blocking)", error);
  }
}
