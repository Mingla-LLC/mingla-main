/**
 * #4459 — "Message <Brand>" from the brand Guest chat surfaces. An existing
 * #4111 enquiry thread with the brand opens directly; otherwise the shared
 * message sheet starts one (same rail as Calendar's Message button). Never a
 * dead tap: a brand not taking messages, or a failed read, says so.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
// DEEP specifier: suites mock the offering barrel.
import { resolveTheme } from "@mingla/offering-rendering/themeResolver";

import { useBrandEnquiryProfile, useBrandIdentity, useMyEnquiryRows } from "../../hooks/useBrandEnquiries";
import { useAppStore } from "../../store/appStore";
import { toastManager } from "../ui/Toast";
import { enquiryThreadHref, latestEnquiryForBrand } from "./brandGuestEnquiry";
import { useExplorerBrandMessage } from "./useExplorerBrandMessage";

export function useMessageBrandFromGuestChat(target: {
  brandId: string | null;
  brandSlug: string | null;
  brandName: string;
}): { messageBrand: () => void; busy: boolean; overlays: React.ReactNode } {
  const { t } = useTranslation("enquiry");
  const router = useRouter();
  const userId = useAppStore((s) => s.user?.id ?? null);
  const rows = useMyEnquiryRows(userId);
  const [armed, setArmed] = useState(false);
  const identity = useBrandIdentity({ brandId: target.brandId, brandSlug: target.brandSlug }, armed);
  const brand = useMemo(
    () =>
      identity.data === null || identity.data === undefined
        ? null
        : { id: identity.data.id, name: identity.data.name, slug: identity.data.slug, theme: resolveTheme(identity.data.theme, null) },
    [identity.data],
  );
  const profile = useBrandEnquiryProfile(armed ? brand?.id ?? null : null);
  const message = useExplorerBrandMessage({ brand, entry: "brand_page" });
  const { open, available } = message;

  useEffect(() => {
    if (!armed) return;
    if (identity.isError || (identity.isSuccess && identity.data === null) || profile.isError) {
      setArmed(false);
      toastManager.show(t("enquiry:open_failed", { brand: target.brandName }), "error");
      return;
    }
    if (!profile.isSuccess) return;
    setArmed(false);
    if (!available) {
      toastManager.show(t("enquiry:unavailable", { brand: target.brandName }), "info");
      return;
    }
    open(null);
  }, [armed, available, identity.data, identity.isError, identity.isSuccess, open, profile.isError, profile.isSuccess, t, target.brandName]);

  const messageBrand = useCallback(() => {
    const existing = latestEnquiryForBrand(rows.data, target.brandId);
    if (existing) {
      router.push(enquiryThreadHref(existing.enquiryId) as never);
      return;
    }
    setArmed(true);
  }, [router, rows.data, target.brandId]);

  return { messageBrand, busy: armed, overlays: message.overlays };
}
