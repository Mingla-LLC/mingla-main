import React, { useState } from "react";
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useWebsite } from "./WebsiteContext";
import { Body, Hint, Spinner, WButton, ui } from "./ui";
import { WebsiteIcon } from "./WebsiteIcon";
import { uploadSitePhoto, useMediaLibrary, type PictureRef } from "../../../sites/contentApi";
import { BrandSitesError } from "../../../services/brandSitesService";

/*
 * #2829 W9r — picking a photo (or a cover video) for the website through the
 * existing media pipeline: from the site's photos, or uploaded from this
 * device (checked and resized by Mingla before it can be used). Every state
 * is said: uploading, checking, refused (with the reason).
 */
export function usePhotoPicker() {
  const { controller, toast } = useWebsite();
  const siteId = controller.siteId;
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

/** Your website's photos, or upload one from this device. */
export function PhotoChooser({ visible, onClose, onPick, kind = "image" }: {
  visible: boolean;
  onClose: () => void;
  onPick: (picked: PictureRef) => void;
  kind?: "image" | "video";
}): React.ReactElement {
  const { controller } = useWebsite();
  const library = useMediaLibrary(controller.siteId, visible && kind === "image");
  const { upload, busy } = usePhotoPicker();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} role="button" accessibilityLabel="Close">
        <Pressable style={styles.dialog} role="dialog" aria-modal accessibilityLabel={kind === "video" ? "Choose a video" : "Choose a photo"} onPress={() => undefined}>
          <Text style={styles.title} role="heading">{kind === "video" ? "Choose a video" : "Choose a photo"}</Text>
          <Body>{kind === "video"
            ? "An MP4 up to 15 seconds. It plays muted, on a loop, with a pause button."
            : "From your website's photos, or upload one. Photos must be JPEG, PNG or WebP under 20 MB."}</Body>
          <View style={styles.uploadRow}>
            <WButton
              label={busy === "uploading" ? "Uploading…" : busy === "checking" ? "Checking the file…" : kind === "video" ? "Upload a video" : "Upload from this device"}
              icon="upload"
              variant="primary"
              loading={busy !== null}
              onPress={() => { void upload(kind).then((picked) => { if (picked) onPick(picked); }); }}
              testID="photo-upload"
            />
          </View>
          {kind === "image" ? (
            library.isLoading ? <Spinner label="Loading your photos" /> : library.isError ? (
              <Hint>Your photos couldn&apos;t be loaded. You can still upload one.</Hint>
            ) : (
              <ScrollView style={styles.grid} contentContainerStyle={styles.gridInner}>
                {(library.data ?? []).map((item) => (
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
                {(library.data ?? []).length === 0 ? <Hint>No photos yet. Upload your first one.</Hint> : null}
              </ScrollView>
            )
          ) : null}
          <View style={styles.actions}><WButton label="Cancel" onPress={onClose} testID="photo-cancel" /></View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  slot: {
    borderWidth: 1, borderStyle: "dashed", borderColor: "rgba(255,255,255,0.22)", borderRadius: 12,
    alignItems: "center", justifyContent: "center", gap: 6, overflow: "hidden", backgroundColor: "rgba(255,255,255,0.02)",
  },
  slotFilled: { borderStyle: "solid", alignItems: "flex-start", justifyContent: "flex-end", padding: 10 },
  slotChip: { backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 999, paddingHorizontal: 9, height: 24, justifyContent: "center" },
  slotChipText: { color: "#ffffff", fontSize: 12, fontWeight: "600" },
  slotText: { color: ui.t3, fontSize: 13 },
  slotActions: { flexDirection: "row", gap: 8, marginTop: 8 },
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center", padding: 16 },
  dialog: { width: "100%", maxWidth: 560, maxHeight: "90%", backgroundColor: "#16181c", borderWidth: 1, borderColor: ui.border2, borderRadius: 24, padding: 20 },
  title: { fontSize: 18, lineHeight: 24, fontWeight: "700", color: ui.t1, marginBottom: 6 },
  uploadRow: { flexDirection: "row", marginVertical: 12 },
  grid: { maxHeight: 320 },
  gridInner: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  gridItem: { width: 96, height: 72, borderRadius: 8, overflow: "hidden" },
  gridImage: { width: "100%", height: "100%", backgroundColor: "rgba(255,255,255,0.06)" },
  actions: { flexDirection: "row", justifyContent: "flex-end", marginTop: 16 },
});
