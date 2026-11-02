/**
 * #3355 — in-chat upload on Ari's logo and cover handoffs (Seth, 2026-11-01).
 *
 * The owner picks the file right in the chat, through the SAME Host upload
 * pipeline Brand details uses: `BrandAvatarPickerSheet` for the logo and the
 * unified `CoverPickerSheet` (brand target) for the cover. Nothing is forked:
 * both sheets upload and save to the brand exactly as they do in Brand
 * details, and only after the owner picks. Ari never adds media.
 *
 * When the save lands, `onUploaded` answers the card's "check" choice, so Ari
 * re-reads the brand (canonical state) and continues. "Open Brand details"
 * stays on the card as the second way.
 *
 * The sheets render inside this card's View (I-SUB-SHEET-INSIDE-PARENT).
 */

import React, { useCallback, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";

import {
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { brandKeys } from "../../hooks/brandKeys";
import { useBrand } from "../../hooks/useBrands";
import { brandSiteKeys } from "../../sites/brandSiteKeys";
import { joinBrandDescription } from "../../services/brandMapping";
import { BrandAvatarPickerSheet } from "../brand/BrandAvatarPickerSheet";
import { Button } from "../ui/Button";
import type { CoverPatch } from "../ui/CoverPicker";
import { CoverPickerSheet } from "../ui/CoverPickerSheet";
import {
  ARI_FLOW_UPLOAD_COPY,
  type AriFlowUploadKind,
} from "./ariFlowCards";

export interface AriFlowUploadCardProps {
  kind: AriFlowUploadKind;
  brandId: string | null;
  accountId: string | null;
  /** Offline, sending, or not the current card. */
  disabled: boolean;
  /** The owner's file is saved to the brand: ask Ari to check. */
  onUploaded: () => void;
}

/**
 * #3355 bug 15 — after an in-chat logo / cover save, refresh everything that
 * reads it: the brand and its readiness (readiness keys are nested under the
 * brand detail) and the Website setup plan, including the pane beside the
 * chat (nested under the plan). Without this the pane's gap count stayed on
 * the old value after the upload.
 */
export function refreshAfterFlowUpload(
  queryClient: Pick<QueryClient, "invalidateQueries">,
  brandId: string,
): void {
  void queryClient.invalidateQueries({ queryKey: brandKeys.detail(brandId) });
  void queryClient.invalidateQueries({ queryKey: brandSiteKeys.plan(brandId) });
}

export const AriFlowUploadCard: React.FC<AriFlowUploadCardProps> = ({
  kind,
  brandId,
  accountId,
  disabled,
  onUploaded,
}) => {
  const queryClient = useQueryClient();
  const brandQuery = useBrand(brandId);
  const brand = brandQuery.data ?? null;
  const [open, setOpen] = useState(false);
  const copy = ARI_FLOW_UPLOAD_COPY[kind];
  const ready = brand !== null && brandId !== null && accountId !== null;
  const existingDescription = brand
    ? joinBrandDescription(brand.tagline, brand.bio)
    : null;

  const handleClose = useCallback((): void => setOpen(false), []);
  const handleLogoSaved = useCallback((): void => {
    // The avatar pipeline has already saved it to the brand.
    setOpen(false);
    if (brandId !== null) refreshAfterFlowUpload(queryClient, brandId);
    onUploaded();
  }, [brandId, onUploaded, queryClient]);
  const handleCoverSaved = useCallback(
    (patch: CoverPatch): void => {
      // The brand cover pipeline saves before it reports a change; a removal
      // (null) is not an upload, so Ari is not asked to check.
      if (typeof patch.coverMediaUrl !== "string" || !patch.coverMediaUrl) {
        return;
      }
      setOpen(false);
      if (brandId !== null) refreshAfterFlowUpload(queryClient, brandId);
      onUploaded();
    },
    [brandId, onUploaded, queryClient],
  );

  return (
    <View style={styles.card}>
      <Text style={styles.note}>{copy.note}</Text>
      <Button
        label={copy.action}
        variant="primary"
        size="md"
        leadingIcon="upload"
        onPress={() => setOpen(true)}
        disabled={disabled || !ready}
        loading={brandQuery.isLoading}
        accessibilityLabel={copy.action}
        accessibilityHint={copy.note}
        testID={`ari-flow-upload-${kind}`}
      />
      {ready && kind === "logo" ? (
        <BrandAvatarPickerSheet
          visible={open}
          brandId={brandId}
          accountId={accountId}
          existingDescription={existingDescription}
          currentPhotoUrl={brand.photo ?? null}
          onClose={handleClose}
          onPicked={handleLogoSaved}
        />
      ) : null}
      {ready && kind === "cover" ? (
        <CoverPickerSheet
          visible={open}
          onClose={handleClose}
          target={{
            kind: "brand",
            brandId,
            accountId,
            existingDescription,
          }}
          initial={{
            coverMediaUrl: brand.coverMediaUrl ?? null,
            coverMediaPosterUrl: brand.coverMediaPosterUrl ?? null,
            coverMediaType: brand.coverMediaType ?? null,
            coverMediaProvider: null,
            coverMediaSourceUrl: null,
            coverMediaCredit: null,
            coverMediaCreditUrl: null,
            coverMediaAlt: null,
          }}
          onCoverChange={handleCoverSaved}
          onShowToast={() => undefined}
        />
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    gap: spacing.sm,
    marginTop: spacing.sm,
    alignSelf: "stretch",
  },
  note: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
});
