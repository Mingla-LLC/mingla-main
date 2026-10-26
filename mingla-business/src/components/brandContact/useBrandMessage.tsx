/**
 * #4111 — "Message {Brand}" for the Business app (buyer web and the Business
 * preview). LIGHT by design: this hook only asks the anon-safe
 * brand_enquiry_public_profile whether the brand takes enquiries (and its
 * reply time) and remembers a tap. Everything else (topics, transports, the
 * shared sheet, plans, the native sign-in step) is `BrandMessageHost`, loaded
 * lazily on the first tap so no page's boot payload or __common chunk grows.
 *
 * The caller passes the viewer, so anon routes (cancel page, venue page) never
 * need useAuth, plus whatever offerings/venue the page already loaded.
 */
import React, { useCallback, useState } from "react";
import { Platform } from "react-native";
import type { EnquiryPrefill } from "@mingla/brand-rendering/enquiry/enquiryTopics";

import { captureWeb } from "../../analytics/webAnalytics";
import { usePublicBrandEnquiryProfile } from "../../hooks/usePublicBrandEnquiry";
import type { UseBrandMessageInput } from "./brandMessageTypes";

const BrandMessageHost = React.lazy(() => import("./BrandMessageHost"));

export type {
  BrandMessageTarget,
  BrandMessageViewer,
  UseBrandMessageInput,
} from "./brandMessageTypes";

export interface BrandMessageController {
  /** The brand takes enquiries (card / buttons render only when true). */
  available: boolean;
  replyMinutes: number | null;
  open: (prefill?: EnquiryPrefill | null) => void;
  overlays: React.ReactNode;
}

export function useBrandMessage(input: UseBrandMessageInput): BrandMessageController {
  const { brand, viewer, entry } = input;
  const profile = usePublicBrandEnquiryProfile(brand?.id ?? null);
  const [trigger, setTrigger] = useState<{ nonce: number; prefill: EnquiryPrefill | null } | null>(null);
  const available = profile.data?.available === true;
  const signedIn = viewer.userId !== null;

  const open = useCallback(
    (next?: EnquiryPrefill | null): void => {
      if (brand === null || !available) return;
      setTrigger((prev) => ({ nonce: (prev?.nonce ?? 0) + 1, prefill: next ?? null }));
      captureWeb("brand_message_opened", {
        surface: Platform.OS === "web" ? "buyer_web" : "business_preview",
        brand_id: brand.id,
        entry,
        prefilled: next !== null && next !== undefined,
        signed_in: signedIn,
      });
    },
    [available, brand, entry, signedIn],
  );

  const overlays =
    brand === null || trigger === null ? null : (
      <React.Suspense fallback={null}>
        <BrandMessageHost {...input} brand={brand} trigger={trigger} />
      </React.Suspense>
    );

  return {
    available,
    replyMinutes: profile.data?.replyMinutes ?? null,
    open,
    overlays,
  };
}

/** The display name for "Sending as {name}." from a Supabase user. */
export const viewerNameFromUser = (
  user: { email?: string | null; user_metadata?: Record<string, unknown> | null } | null,
): string | null => {
  if (user === null) return null;
  const meta = user.user_metadata ?? {};
  for (const key of ["display_name", "full_name", "name"]) {
    const value = meta[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return typeof user.email === "string" && user.email.length > 0 ? user.email : null;
};
