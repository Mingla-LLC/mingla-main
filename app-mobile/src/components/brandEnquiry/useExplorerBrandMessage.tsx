/**
 * #4111 Wave D — "Message {Brand}" in Explorer (D3 / D6).
 *
 * LIGHT by design: until the first tap this hook only asks the anon-safe
 * `brand_enquiry_public_profile` whether the brand takes messages (and its
 * reply time). The sheet, its topic groups, the plans read and the transport
 * live in `ExplorerBrandMessageHost`, which mounts on the first tap.
 *
 *   signed in   → the shared BrandMessageSheet; send through brand_enquiry_send
 *                 (p_source 'explorer'); after sending, the thread opens.
 *   signed out  → a "Sign in to message {Brand}" step that goes to the app's
 *                 existing sign-in. Explorer never sends anonymously.
 */
import React, { useCallback, useMemo, useState } from "react";
import { Alert } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import type {
  EnquiryEntry,
  EnquiryOffering,
  EnquiryPick,
  EnquiryPrefill,
  EnquiryVenue,
} from "@mingla/brand-rendering/enquiry/enquiryTopics";

import { useBrandEnquiryProfile } from "../../hooks/useBrandEnquiries";
import { postHogService } from "../../services/postHogService";
import { useAppStore } from "../../store/appStore";
import { getDisplayName } from "../../utils/getDisplayName";

import type { ExplorerBrandTarget, ExplorerMessageTrigger } from "./explorerBrandMessageTypes";

export type { ExplorerBrandTarget, ExplorerMessageTrigger } from "./explorerBrandMessageTypes";

// LAZY: the host imports the shared sheet (and its icon set). Screens that only
// show the Message button — the venue page, organiser rows — must not load it
// until the first tap.
// A deferred `require` (not `import()`): Metro still bundles it, the factory
// runs only on the first tap, and the jest harnesses (no ESM dynamic import)
// can render it.
const ExplorerBrandMessageHost = React.lazy(async () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require("./ExplorerBrandMessageHost") as typeof import("./ExplorerBrandMessageHost");
  return { default: mod.default };
});

export interface ExplorerBrandMessageInput {
  brand: ExplorerBrandTarget | null;
  entry: EnquiryEntry;
  offerings?: readonly EnquiryOffering[];
  venue?: EnquiryVenue | null;
  /** "Book now" on the table topic. Absent → no button. */
  onBookTable?: (pick: EnquiryPick) => void;
  /** The caller's own reservation-cancel flow (Calendar). Absent → the host's. */
  onCancelReservation?: (reservationId: string) => void;
}

export interface ExplorerBrandMessageController {
  /** The brand takes messages; render Message only when true (no dead taps). */
  available: boolean;
  replyMinutes: number | null;
  open: (prefill?: EnquiryPrefill | null) => void;
  overlays: React.ReactNode;
}

export function useExplorerBrandMessage(input: ExplorerBrandMessageInput): ExplorerBrandMessageController {
  const { brand, entry } = input;
  const { t } = useTranslation("enquiry");
  const router = useRouter();
  const user = useAppStore((s) => s.user);
  const profile = useAppStore((s) => s.profile);
  const enquiryProfile = useBrandEnquiryProfile(brand?.id ?? null);
  const [trigger, setTrigger] = useState<ExplorerMessageTrigger | null>(null);
  const available = enquiryProfile.data?.available === true;
  const userId = user?.id ?? null;
  const viewerName = useMemo(
    () => getDisplayName(profile, "") || t("enquiry:sending_as_fallback"),
    [profile, t],
  );

  const open = useCallback(
    (prefill?: EnquiryPrefill | null): void => {
      if (brand === null || !available) return;
      postHogService.capture("brand_message_opened", {
        surface: "consumer_native",
        brand_id: brand.id,
        entry,
        prefilled: prefill !== null && prefill !== undefined,
        signed_in: userId !== null,
      });
      if (userId === null) {
        Alert.alert(
          t("enquiry:sign_in_title", { brand: brand.name }),
          t("enquiry:sign_in_body", { brand: brand.name }),
          [
            { text: t("enquiry:not_now"), style: "cancel" },
            {
              text: t("enquiry:sign_in_cta"),
              // The app's existing sign-in: "/" renders WelcomeScreen when
              // signed out (same rail as the guest-list "Sign in").
              onPress: () => router.replace("/"),
            },
          ],
        );
        return;
      }
      setTrigger((prev) => ({ nonce: (prev?.nonce ?? 0) + 1, prefill: prefill ?? null }));
    },
    [available, brand, entry, router, t, userId],
  );

  const overlays =
    brand === null || trigger === null || userId === null ? null : (
      <React.Suspense fallback={null}>
      <ExplorerBrandMessageHost
        brand={brand}
        entry={entry}
        offerings={input.offerings}
        venue={input.venue ?? null}
        onBookTable={input.onBookTable}
        onCancelReservation={input.onCancelReservation}
        userId={userId}
        viewerName={viewerName}
        trigger={trigger}
      />
      </React.Suspense>
    );

  return {
    available,
    replyMinutes: enquiryProfile.data?.replyMinutes ?? null,
    open,
    overlays,
  };
}
