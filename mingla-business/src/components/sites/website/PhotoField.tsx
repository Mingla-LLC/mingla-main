import React, { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { brandSiteKeys } from "../../../sites/brandSiteKeys";
import { ActivityIndicator, Image, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useWebsite } from "./WebsiteContext";
import { Body, Hint, Spinner, WButton, ui } from "./ui";
import { WebsiteIcon } from "./WebsiteIcon";
import { uploadSitePhoto, useMediaLibrary, type PictureRef } from "../../../sites/contentApi";
import { BrandSitesError } from "../../../services/brandSitesService";
import { useImportBrandSiteLibrary } from "../../../sites/brandLibraryApi";

import { color, scrim } from "../../../constants/designSystem";
/*
 * #2829 W9r — picking a photo (or a cover video) for the website through the
 * existing media pipeline: from the site's photos, or uploaded from this
 * device (checked and resized by Mingla before it can be used). Every state
 * is said: uploading, checking, refused (with the reason).
 */
export function usePhotoPicker() {
  const { controller, toast } = useWebsite();
  const siteId = controller.siteId;
  const client = useQueryClient();
  const [busy, setBusy] = useState<null | "uploading" | "checking">(null);

  const upload = async (kind: "image" | "video"): Promise<PictureRef | null> => {
    if (!siteId) return null;
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: kind === "video" ? ["videos"] : ["images"],
        quality: 1,
        allowsMultipleSelection: false,
      });
      if (result.canceled || !result.assets?.[0]) return null;
      const asset = result.assets[0];
      const type = asset.mimeType ?? (kind === "video" ? "video/mp4" : "image/jpeg");
      if (kind === "video" && typeof asset.duration === "number" && asset.duration > 15_000) {
        toast("Cover videos can be up to 15 seconds. Choose a shorter one.", "warn");
        return null;
      }
      let size = asset.fileSize ?? 0;
      if (!size) size = (await (await fetch(asset.uri)).blob()).size;
      const uploaded = await uploadSitePhoto({
        siteId,
        file: { uri: asset.uri, name: asset.fileName ?? (kind === "video" ? "cover.mp4" : "photo.jpg"), type, size },
        onStatus: setBusy,
      });
      // #4572 item 12 — the new photo is in the list straight away (no 5-minute wait).
      void client.invalidateQueries({ queryKey: brandSiteKeys.siteData(siteId, "media") });
      return { id: uploaded.mediaId, thumb_url: uploaded.thumbUrl };
    } catch (error) {
      toast(error instanceof BrandSitesError ? error.message : "That photo couldn’t be added. Try again.", "error");
      return null;
    } finally {
      setBusy(null);
    }
  };
  return { upload, busy };
}

/** A main-picture slot: the photo (or a dashed "add" box) and Choose / Remove. */
export function PhotoSlot({ label, value, onChange, disabled, testID, minHeight = 120 }: {
  label: string;
  value: PictureRef | null;
  onChange: (next: PictureRef | null) => void;
  disabled?: boolean;
  testID?: string;
  minHeight?: number;
}): React.ReactElement {
  const [choosing, setChoosing] = useState(false);
  return (
    <View testID={testID}>
      <View style={[styles.slot, { minHeight }, value ? styles.slotFilled : null]}>
        {value?.thumb_url ? (
          <Image source={{ uri: value.thumb_url }} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityLabel={label} />
        ) : null}
        {value ? (
          <View style={styles.slotChip}><Text style={styles.slotChipText}>{label}</Text></View>
        ) : (
          <>
            <WebsiteIcon name="image" size={22} color={ui.t3} />
            <Text style={styles.slotText}>{`Add the ${label.toLowerCase()}`}</Text>
          </>
        )}
      </View>
      <View style={styles.slotActions}>
        <WButton label={value ? "Change photo" : "Choose photo"} size="sm" onPress={() => setChoosing(true)} disabled={disabled} testID={testID ? `${testID}-choose` : undefined} />
        {value ? <WButton label="Remove" variant="ghost" size="sm" onPress={() => onChange(null)} disabled={disabled} testID={testID ? `${testID}-remove` : undefined} /> : null}
      </View>
      <PhotoChooser visible={choosing} onClose={() => setChoosing(false)} onPick={(picked) => { setChoosing(false); onChange(picked); }} />
    </View>
  );
}

/**
 * #4572 item 3 — the empty library brings in the brand's own pictures once by
 * itself (per site, per app session); after that it is the host's button.
 */
const autoImported = new Set<string>();

/** Test hook: forget which sites already brought their brand photos in. */
export function resetBrandPhotoAutoImport(): void {
  autoImported.clear();
}

/** #4572 item 12 — newest first: this session's uploads lead, then the library's own order. */
export function photosNewestFirst<T extends { id: string }>(items: readonly T[], recent: readonly string[]): T[] {
  const rank = new Map(recent.map((id, index) => [id, index]));
  return [...items].sort((a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER));
}

type ImportState = { phase: "idle" } | { phase: "importing" } | { phase: "failed" } | { phase: "none_found" };

/** Your website's photos, or upload one from this device. */
export function PhotoChooser({ visible, onClose, onPick, kind = "image" }: {
  visible: boolean;
  onClose: () => void;
  onPick: (picked: PictureRef) => void;
  kind?: "image" | "video";
}): React.ReactElement {
  const { controller, brandId, toast } = useWebsite();
  const siteId = controller.siteId;
  const [importState, setImportState] = useState<ImportState>({ phase: "idle" });
  const [recent, setRecent] = useState<string[]>([]);
  const library = useMediaLibrary(siteId, visible && kind === "image", importState.phase === "importing" ? 1500 : false);
  const bring = useImportBrandSiteLibrary(brandId, siteId);
  const { upload, busy } = usePhotoPicker();
  const phone = Platform.OS !== "web";
  const items = photosNewestFirst(library.data ?? [], recent);

  const runImport = useCallback(() => {
    setImportState({ phase: "importing" });
    bring.mutate(undefined, {
      onSuccess: (result) => {
        if (result.imported > 0) {
          setImportState({ phase: "idle" });
          toast(result.imported === 1 ? "1 brand photo added" : `${result.imported} brand photos added`, "success");
        } else {
          setImportState({ phase: "none_found" });
        }
      },
      onError: () => setImportState({ phase: "failed" }),
    });
  }, [bring, toast]);

  // Opening an empty library brings the brand's pictures in once, by itself.
  const empty = kind === "image" && visible && library.isSuccess && (library.data ?? []).length === 0;
  useEffect(() => {
    if (!empty || !siteId || autoImported.has(siteId) || importState.phase !== "idle") return;
    autoImported.add(siteId);
    runImport();
  }, [empty, importState.phase, runImport, siteId]);

  const onUpload = () => {
    void upload(kind).then((picked) => {
      if (!picked) return;
      setRecent((current) => [picked.id, ...current.filter((id) => id !== picked.id)]);
      onPick(picked);
    });
  };

  const importing = importState.phase === "importing";
  const uploadLabel = kind === "video" ? "Upload a video" : phone ? "Upload from this phone" : "Upload from this device";
  const uploadHint = kind === "video"
    ? "An MP4 up to 15 seconds"
    : phone ? "Pick from your photos or take one" : "Pick a photo from your computer";

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} role="button" accessibilityLabel="Close">
        <Pressable style={styles.dialog} role="dialog" aria-modal accessibilityLabel={kind === "video" ? "Choose a video" : "Choose a photo"} onPress={() => undefined}>
          <Text style={styles.title} role="heading">{kind === "video" ? "Choose a video" : "Choose a photo"}</Text>
          <Body>{kind === "video"
            ? "An MP4 up to 15 seconds. It plays muted, on a loop, with a pause button."
            : "From your website's photos, or upload one. Photos must be JPEG, PNG or WebP under 20 MB."}</Body>
          {/* #4572 item 12 — Upload is its own block, apart from the thumbnails. */}
          <Pressable
            onPress={onUpload}
            disabled={busy !== null || importing}
            role="button"
            accessibilityRole="button"
            accessibilityLabel={`${uploadLabel}. ${uploadHint}`}
            accessibilityState={{ disabled: busy !== null || importing, busy: busy !== null }}
            style={[styles.uploadBlock, busy !== null || importing ? styles.uploadBlockOff : null]}
            testID="photo-upload"
          >
            <View style={styles.uploadIcon}><WebsiteIcon name="upload" size={18} color={ui.t1} /></View>
            <View style={styles.uploadWords}>
              <Text style={styles.uploadTitle}>{uploadLabel}</Text>
              <Text style={styles.uploadHint}>{uploadHint}</Text>
            </View>
          </Pressable>
          {kind === "image" ? (
            library.isLoading ? <Spinner label="Loading your photos" /> : library.isError ? (
              <Hint>Your photos couldn&apos;t be loaded. You can still upload one.</Hint>
            ) : items.length === 0 && busy === null ? (
              importing ? (
                <View style={styles.importing} role="status" accessibilityLiveRegion="polite" testID="photo-importing">
                  <View style={styles.importLine}><ActivityIndicator size="small" color={ui.t2} /><Text style={styles.importText}>Bringing in your brand photos…</Text></View>
                  <View style={styles.gridInner}>{[0, 1, 2, 3].map((index) => <View key={index} style={[styles.gridItem, styles.tilePlaceholder]} />)}</View>
                </View>
              ) : (
                <View style={styles.emptyState} testID="photo-empty">
                  <WebsiteIcon name="image" size={24} color={ui.t3} />
                  <Text style={styles.emptyTitle}>No photos here yet</Text>
                  <Text style={styles.emptyBody}>
                    {importState.phase === "failed"
                      ? "We couldn’t bring in your brand photos. Try again, or upload one from this device."
                      : importState.phase === "none_found"
                        ? "We didn’t find any brand photos to bring in. Upload one from this device."
                        : "Your brand already has a logo, a cover and event flyers. Bring them in to use them on your website."}
                  </Text>
                  <WButton
                    label={importState.phase === "failed" ? "Try again" : "Bring in my brand photos"}
                    variant="primary"
                    size="sm"
                    onPress={runImport}
                    testID="photo-bring-in"
                  />
                </View>
              )
            ) : (
              <>
                <View style={styles.divider} testID="photo-divider">
                  <Text style={styles.dividerText}>{`Your photos (${items.length})`}</Text>
                  <View style={styles.dividerLine} />
                </View>
                <ScrollView style={styles.grid} contentContainerStyle={styles.gridInner}>
                  {importing ? (
                    <View style={[styles.gridItem, styles.tilePlaceholder, styles.tileBusy]} role="status" testID="photo-importing-tile">
                      <ActivityIndicator size="small" color={ui.t2} />
                      <Text style={styles.tileBusyText}>Bringing in…</Text>
                    </View>
                  ) : null}
                  {busy !== null ? (
                    <View style={[styles.gridItem, styles.tilePlaceholder, styles.tileBusy]} role="status" accessibilityLiveRegion="polite" testID="photo-uploading-tile">
                      <ActivityIndicator size="small" color={ui.t2} />
                      <Text style={styles.tileBusyText}>{busy === "uploading" ? "Uploading…" : "Checking the file…"}</Text>
                    </View>
                  ) : null}
                  {items.map((item) => (
                    <Pressable
                      key={item.id}
                      onPress={() => onPick({ id: item.id, thumb_url: item.thumb_url })}
                      role="button"
                      accessibilityRole="button"
                      accessibilityLabel={`Use ${item.filename}`}
                      style={styles.gridItem}
                      testID={`photo-library-${item.id}`}
                    >
                      {item.thumb_url ? <Image source={{ uri: item.thumb_url }} style={styles.gridImage} resizeMode="cover" /> : <View style={styles.gridImage} />}
                    </Pressable>
                  ))}
                </ScrollView>
              </>
            )
          ) : busy !== null ? (
            <View style={styles.importLine} role="status" testID="photo-uploading-tile">
              <ActivityIndicator size="small" color={ui.t2} />
              <Text style={styles.importText}>{busy === "uploading" ? "Uploading…" : "Checking the file…"}</Text>
            </View>
          ) : null}
          <View style={styles.actions}><WButton label="Cancel" onPress={onClose} testID="photo-cancel" /></View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  slot: {
    borderWidth: 1, borderStyle: "dashed", borderColor: color.lineStrong, borderRadius: 12,
    alignItems: "center", justifyContent: "center", gap: 6, overflow: "hidden", backgroundColor: color.fill.tableHead,
  },
  slotFilled: { borderStyle: "solid", alignItems: "flex-start", justifyContent: "flex-end", padding: 10 },
  slotChip: { backgroundColor: scrim.modal, borderRadius: 999, paddingHorizontal: 9, height: 24, justifyContent: "center" },
  slotChipText: { color: color.text1, fontSize: 12, fontWeight: "600" },
  slotText: { color: ui.t3, fontSize: 13 },
  slotActions: { flexDirection: "row", gap: 8, marginTop: 8 },
  scrim: { flex: 1, backgroundColor: scrim.modal, alignItems: "center", justifyContent: "center", padding: 16 },
  dialog: { width: "100%", maxWidth: 560, maxHeight: "90%", backgroundColor: color.card, borderWidth: 1, borderColor: ui.border2, borderRadius: 24, padding: 20 },
  title: { fontSize: 18, lineHeight: 24, fontWeight: "700", color: ui.t1, marginBottom: 6 },
  uploadBlock: {
    marginTop: 12, minHeight: 64, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: 14, borderWidth: 1, borderStyle: "dashed", borderColor: color.lineStrong, backgroundColor: color.fill.tableHead,
  },
  uploadBlockOff: { opacity: 0.5 },
  uploadIcon: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: color.fill.tile },
  uploadWords: { flex: 1, minWidth: 0 },
  uploadTitle: { fontSize: 14, fontWeight: "700", color: ui.t1 },
  uploadHint: { fontSize: 12, lineHeight: 16, color: ui.t3 },
  divider: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 16 },
  dividerText: { fontSize: 12, fontWeight: "700", color: ui.t2 },
  dividerLine: { flex: 1, height: 1, backgroundColor: ui.border2 },
  grid: { maxHeight: 320, marginTop: 16 },
  gridInner: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tilePlaceholder: { backgroundColor: color.fill.tile },
  tileBusy: { alignItems: "center", justifyContent: "center", gap: 4, borderWidth: 1, borderStyle: "dashed", borderColor: color.lineStrong },
  tileBusyText: { fontSize: 11, fontWeight: "600", color: ui.t2, textAlign: "center" },
  importing: { marginTop: 16, gap: 10 },
  importLine: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 16 },
  importText: { fontSize: 13, fontWeight: "600", color: ui.t1 },
  emptyState: { marginTop: 16, alignItems: "center", gap: 8, paddingVertical: 16, paddingHorizontal: 8 },
  emptyTitle: { fontSize: 15, fontWeight: "700", color: ui.t1 },
  emptyBody: { fontSize: 13, lineHeight: 18, color: ui.t2, textAlign: "center", maxWidth: 320 },
  gridItem: { width: 96, height: 72, borderRadius: 8, overflow: "hidden" },
  gridImage: { width: "100%", height: "100%", backgroundColor: color.fill.tile },
  actions: { flexDirection: "row", justifyContent: "flex-end", marginTop: 16 },
});
