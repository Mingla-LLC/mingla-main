import React, { useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import {
  orientationOf,
  PREVIEW_DEVICE_LABELS,
  PREVIEW_DEVICES,
  previewSizeReadout,
  rotated,
  withDevice,
  type PreviewDevice,
  type PreviewDevicePreference,
} from "../../../../sites/previewDevice";
import { previewFrameSource } from "../../../../sites/previewFrame";
import { Chip, Hint, MiniButton, Segmented, Skeleton, WButton, ui } from "../ui";
import { ScaledPreviewFrame } from "./ScaledPreviewFrame";

const DEVICE_ICONS = { desktop: "monitor", tablet: "tablet", phone: "phone" } as const;

/** Desktop / Tablet / Phone, rotate, and the size readout (DESIGN_SPEC §1.7). */
export function PreviewDeviceSwitcher({ preference, onChange }: {
  preference: PreviewDevicePreference;
  onChange: (next: PreviewDevicePreference) => void;
}): React.ReactElement {
  const orientation = orientationOf(preference);
  return (
    <View style={styles.bar}>
      <Segmented<PreviewDevice>
        label="Preview size"
        compact
        options={PREVIEW_DEVICES.map((device) => ({ value: device, label: PREVIEW_DEVICE_LABELS[device], icon: DEVICE_ICONS[device] }))}
        value={preference.device}
        onChange={(device) => onChange(withDevice(preference, device))}
        testIDPrefix="preview-device"
      />
      <MiniButton
        icon="rotate"
        label={orientation === "landscape" ? "Turn to portrait" : "Turn to landscape"}
        onPress={() => onChange(rotated(preference))}
        disabled={preference.device === "desktop"}
        testID="preview-rotate"
      />
      <Text style={styles.readout} accessibilityLiveRegion="polite" role="status" testID="preview-size">
        {previewSizeReadout(preference)}
      </Text>
    </View>
  );
}

export type PreviewGrantState =
  | { kind: "nodraft" }
  | { kind: "loading" }
  | { kind: "error"; onRetry: () => void }
  | { kind: "ready"; previewUrl: string; siteId: string; pages: readonly { path: string; title: string }[] };

export function SitePreviewPanel({ grant, preference, onPreference, purpose, unsaved, tokenDeclarations, onOpenFullScreen, variant = "side" }: {
  grant: PreviewGrantState;
  preference: PreviewDevicePreference;
  onPreference: (next: PreviewDevicePreference) => void;
  purpose: string;
  unsaved?: boolean;
  tokenDeclarations?: readonly string[] | null;
  onOpenFullScreen: () => void;
  variant?: "side" | "sheet" | "full";
}): React.ReactElement {
  const [path, setPath] = useState("");
  if (grant.kind === "nodraft") {
    return (
      <View testID="site-preview-panel">
        <Text style={styles.label}>Draft preview</Text>
        <Hint style={styles.empty}>Your preview appears here once the draft exists</Hint>
      </View>
    );
  }
  const frameOrigin = Platform.OS === "web" && typeof window !== "undefined" ? window.location.origin : null;
  const pages = grant.kind === "ready" ? grant.pages.slice(0, 8) : [];
  return (
    <View style={variant === "full" ? styles.fullBody : null} testID="site-preview-panel">
      {variant !== "full" ? (
        <View style={styles.headRow}>
          <View style={styles.grow}>
            <View style={styles.labelRow}>
              <Text style={styles.label}>Draft preview</Text>
              {unsaved ? <Chip label="Unsaved" tone="warn" testID="preview-unsaved" /> : null}
            </View>
            <Hint>{purpose}</Hint>
          </View>
          <WButton label="Open full screen" icon="ext" size="sm" onPress={onOpenFullScreen} testID="preview-open-full" />
        </View>
      ) : null}
      <PreviewDeviceSwitcher preference={preference} onChange={onPreference} />
      {pages.length > 1 ? (
        <View style={styles.pages}>
          <Segmented
            label="Preview page"
            compact
            options={pages.map((page) => ({ value: page.path || "/", label: page.path ? page.title : "Home" }))}
            value={path || "/"}
            onChange={(next) => setPath(next === "/" ? "" : next)}
            testIDPrefix="preview-page"
          />
        </View>
      ) : null}
      {grant.kind === "loading" ? (
        <View role="status" accessibilityLabel="Making your private preview">
          <Skeleton height={variant === "side" ? 300 : 420} />
        </View>
      ) : grant.kind === "error" ? (
        <View style={styles.errorStage} role="alert">
          <Text style={styles.errorTitle}>We couldn&apos;t load the preview</Text>
          <WButton label="Try again" size="sm" onPress={grant.onRetry} testID="preview-retry" />
        </View>
      ) : (
        <ScaledPreviewFrame
          url={previewFrameSource(grant.previewUrl, grant.siteId, path, frameOrigin)}
          preference={preference}
          maxHeight={variant === "sheet" ? 560 : 520}
          fill={variant === "full"}
          tokenDeclarations={tokenDeclarations}
        />
      )}
      {variant !== "full" ? (
        <Text style={styles.caption}>Scaled to fit. Your choice of size is remembered. Only your team sees the draft.</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  headRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginBottom: 8 },
  labelRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  label: { fontSize: 13, fontWeight: "700", color: ui.t1 },
  empty: { marginTop: 6 },
  bar: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 10 },
  readout: { fontSize: 12, lineHeight: 16, color: ui.t3, fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "ui-monospace, Menlo, monospace" }), fontVariant: ["tabular-nums"] },
  pages: { marginBottom: 10 },
  caption: { fontSize: 12, lineHeight: 16, color: ui.t3, marginTop: 6 },
  errorStage: { minHeight: 200, alignItems: "center", justifyContent: "center", gap: 10, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.02)" },
  errorTitle: { fontSize: 14, fontWeight: "600", color: ui.t1 },
  fullBody: { flex: 1 },
});
