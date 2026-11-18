/**
 * #4238 B7/B8 — "Videos and photos" in the Host ad builder (approved design,
 * #4238 comment 6976865952).
 *
 * Two groups: what is IN THIS AD (up to 5) and the brand's LIBRARY. Every ad
 * tile has a visible ✕ (remove from this ad, or cancel its upload); every
 * library tile a + (use it in this ad). "Select" ticks several in either group
 * for Remove from ad / Archive, which the screen's dock carries. Uploads show
 * their own progress on their tile. Presentational: the screen owns state.
 */
import React from "react";
import { ActivityIndicator, Image, Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { color, radius, space, type } from "../../../constants/designSystem";
import { builderStyles as bs } from "./HostAdBuilderBits";

const WEB = Platform.OS === "web";

export type HostAdMediaTile = {
  key: string;
  name: string;
  /** "TY01 · 0:15" or "Flyer · Photo". */
  label: string;
  posterUri: string | null;
  phase: "ready" | "uploading" | "preparing" | "failed";
  /** "Uploading 42%" / "0:21 · usually under a minute" / the failure reason. */
  status: string | null;
  /** 0–100 while uploading. */
  percent: number | null;
  /** The line under the tile: fit, "Fit shows when ready", or how to fix. */
  note: string;
  noteTone: "plain" | "warn" | "dim";
  /** "Try again" on a network failure. */
  onRetry?: () => void;
  corner: {
    icon: "close" | "plus";
    label: string;
    disabled?: boolean;
    onPress: () => void;
  };
  /** Ticked in select mode (null: this tile can't be selected). */
  selected: boolean | null;
  onToggle?: () => void;
  testID: string;
};

export function HostAdMediaSection(props: {
  heading: string;
  countLabel: string;
  libraryHeading: string;
  libraryHint: string;
  emptyAdText: string;
  ad: HostAdMediaTile[];
  library: HostAdMediaTile[];
  selectMode: boolean;
  selectLabel: string;
  onToggleSelectMode: () => void;
  addLabel: string;
  addHint: string;
  addDisabled: boolean;
  onAdd: () => void;
  retryLabel: string;
  /** Lines under the grid (photo note, "3 or more…"). */
  notes: string[];
  empty: { title: string; body: string; spec: string } | null;
}): React.ReactElement {
  if (props.empty !== null && props.ad.length === 0 && props.library.length === 0) {
    return (
      <View style={styles.empty} testID="host-ad-media-empty">
        <View style={styles.emptyIcon}>
          <Icon name="video" size={26} color={color.accent} />
        </View>
        <Text style={styles.emptyTitle}>{props.empty.title}</Text>
        <Text style={[bs.small, styles.center]}>{props.empty.body}</Text>
        <Text style={[bs.caption, styles.center]}>{props.empty.spec}</Text>
        <Button
          label={props.addLabel}
          variant="primary"
          leadingIcon="plus"
          fullWidth
          onPress={props.onAdd}
          disabled={props.addDisabled}
          testID="host-ad-add-videos"
        />
      </View>
    );
  }
  return (
    <View style={bs.stackLg} testID="host-ad-media">
      <View style={bs.stack}>
        <View style={styles.head}>
          <View style={styles.headText}>
            <Text style={styles.label} accessibilityRole="header">{props.heading}</Text>
            <Text style={styles.count}>{props.countLabel}</Text>
          </View>
          <Button
            label={props.selectLabel}
            variant="secondary"
            size="sm"
            onPress={props.onToggleSelectMode}
            accessibilityState={{ selected: props.selectMode }}
            testID="host-ad-media-select"
          />
        </View>
        {props.ad.length === 0 ? <Text style={[bs.small, styles.emptyAd]}>{props.emptyAdText}</Text> : null}
        <View style={styles.grid} testID="host-ad-creative-tiles">
          {props.ad.map((tile) => (
            <MediaTile key={tile.key} tile={tile} selectMode={props.selectMode} retryLabel={props.retryLabel} />
          ))}
        </View>
        <Button
          label={props.addLabel}
          variant="secondary"
          leadingIcon={props.addDisabled ? undefined : "plus"}
          fullWidth
          onPress={props.onAdd}
          disabled={props.addDisabled}
          testID="host-ad-add-videos"
        />
        <Text style={[bs.caption, styles.center]}>{props.addHint}</Text>
        {props.notes.map((note) => (
          <Text key={note} style={bs.caption}>{note}</Text>
        ))}
      </View>
      {props.library.length > 0 ? (
        <View style={[bs.stack, styles.library]}>
          <View style={styles.headText}>
            <Text style={styles.label} accessibilityRole="header">{props.libraryHeading}</Text>
            <Text style={bs.caption}>{props.libraryHint}</Text>
          </View>
          <View style={styles.grid} testID="host-ad-library-tiles">
            {props.library.map((tile) => (
              <MediaTile key={tile.key} tile={tile} selectMode={props.selectMode} retryLabel={props.retryLabel} />
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

function MediaTile(props: { tile: HostAdMediaTile; selectMode: boolean; retryLabel: string }): React.ReactElement {
  const { tile, selectMode } = props;
  const selectable = selectMode && tile.selected !== null;
  const failed = tile.phase === "failed";
  return (
    <View style={styles.tile} testID={tile.testID}>
      <View style={[styles.poster, tile.selected === true && styles.posterOn, failed && styles.posterBad]}>
        {tile.posterUri ? <Image source={{ uri: tile.posterUri }} style={StyleSheet.absoluteFill} /> : null}
        <Text style={styles.cap} numberOfLines={1}>{tile.name}</Text>
        {tile.phase === "uploading" || tile.phase === "preparing" || failed ? (
          <View style={[styles.veil, failed && styles.veilBad]} accessibilityLiveRegion="polite">
            {tile.phase === "preparing" ? <ActivityIndicator size="small" color={color.accent} /> : null}
            {failed ? <Icon name="flag" size={18} color={color.errorText} /> : null}
            {tile.status ? <Text style={styles.veilText} numberOfLines={3}>{tile.status}</Text> : null}
            {failed && tile.onRetry ? (
              <Button label={props.retryLabel} variant="secondary" size="sm" onPress={tile.onRetry} testID={`${tile.testID}-retry`} />
            ) : null}
          </View>
        ) : null}
        {tile.phase === "uploading" && tile.percent !== null ? (
          <View style={styles.bar}>
            <View style={[styles.barFill, { width: `${tile.percent}%` }]} />
          </View>
        ) : null}
        {selectable ? (
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={tile.onToggle}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: tile.selected === true }}
            aria-checked={tile.selected === true}
            accessibilityLabel={tile.name}
            testID={`${tile.testID}-check`}
          >
            <View style={[styles.box, tile.selected === true && styles.boxOn]}>
              {tile.selected === true ? <Icon name="check" size={14} color={color.onAccent} /> : null}
            </View>
          </Pressable>
        ) : null}
        {!selectMode ? (
          <Pressable
            style={[styles.corner, tile.corner.disabled && styles.cornerOff]}
            onPress={tile.corner.onPress}
            disabled={tile.corner.disabled}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityState={{ disabled: tile.corner.disabled === true }}
            accessibilityLabel={tile.corner.label}
            testID={`${tile.testID}-${tile.corner.icon === "close" ? "remove" : "add"}`}
          >
            <Icon name={tile.corner.icon} size={tile.corner.icon === "close" ? 14 : 16} color={color.textOnPhoto} />
          </Pressable>
        ) : null}
      </View>
      <Text style={styles.name} numberOfLines={1}>{tile.label}</Text>
      <Text
        style={[styles.note, tile.noteTone === "warn" && styles.noteWarn, tile.noteTone === "dim" && styles.noteDim]}
        numberOfLines={2}
      >
        {tile.note}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { textAlign: "center" },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[3] },
  headText: { flex: 1, gap: 2 },
  label: { ...type.label, color: color.text2, textTransform: "uppercase" },
  count: { ...type.small, fontWeight: "600", color: color.text1 },
  emptyAd: { color: color.text2, padding: space[4], borderRadius: radius.sm, backgroundColor: color.card },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space[3] },
  library: { paddingTop: space[4], borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line },
  tile: { width: WEB ? "15%" : "30%", minWidth: 96, flexGrow: 0, gap: 6 },
  poster: {
    width: "100%",
    aspectRatio: 9 / 12,
    borderRadius: radius.sm,
    overflow: "hidden",
    backgroundColor: color.card3,
    borderWidth: 1,
    borderColor: color.line,
  },
  posterOn: { borderWidth: 2, borderColor: color.text1 },
  posterBad: { borderWidth: 2, borderColor: color.errorText },
  cap: { ...type.caption, position: "absolute", left: space[2], right: space[2], bottom: space[2], color: color.textOnPhoto },
  veil: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: color.mask,
    alignItems: "center",
    justifyContent: "center",
    gap: space[2],
    padding: space[2],
  },
  veilBad: { backgroundColor: color.errorTint },
  veilText: { ...type.caption, color: color.textOnPhoto, textAlign: "center" },
  bar: { position: "absolute", left: 0, right: 0, bottom: 0, height: 4, backgroundColor: color.line },
  barFill: { height: 4, backgroundColor: color.accent },
  corner: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.mask,
    borderWidth: 1,
    borderColor: color.textOnPhoto2,
  },
  cornerOff: { opacity: 0.4 },
  box: {
    position: "absolute",
    top: space[2],
    right: space[2],
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: color.textOnPhoto2,
    backgroundColor: color.mask,
    alignItems: "center",
    justifyContent: "center",
  },
  boxOn: { backgroundColor: color.accent, borderColor: color.accent },
  name: { ...type.caption, color: color.text1 },
  note: { ...type.caption, fontSize: 11, lineHeight: 14, color: color.text2 },
  noteWarn: { color: color.warningText },
  noteDim: { color: color.text3 },
  empty: {
    alignItems: "center",
    gap: space[3],
    paddingVertical: space[6],
    paddingHorizontal: space[5],
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: color.lineStrong,
  },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.accentTint,
  },
  emptyTitle: { ...type.h2, color: color.text1, textAlign: "center" },
});
