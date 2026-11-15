/**
 * #4238 media-buyer — styles the new Host ad builder parts share. Same
 * tokens and shapes as HostAdCreateScreen so the new rows read as one screen.
 */
import { StyleSheet } from "react-native";

import { color, radius, space, type } from "../../../constants/designSystem";

/** #4420: orange stays only on progress (the budget meter). */
export const HOST_AD_ACCENT = color.accent;

export const hostAdStyles = StyleSheet.create({
  block: { gap: space[2] },
  label: {
    ...type.caption,
    color: color.text2,
    marginTop: space[1],
  },
  helper: {
    ...type.caption,
    color: color.text2,
    lineHeight: 18,
  },
  title: { ...type.small, color: color.text1, fontWeight: "600" },
  subtitle: { ...type.caption, color: color.text2 },
  faint: { ...type.caption, color: color.text3 },
  warn: { ...type.caption, color: color.warning },
  ok: { ...type.caption, color: color.success },
  error: { ...type.caption, color: color.errorText },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: space[1] },
  chip: {
    minHeight: 36,
    justifyContent: "center",
    paddingHorizontal: space[4],
    paddingVertical: space[1],
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.lineStrong,
  },
  chipSelected: {
    borderColor: color.paper,
    backgroundColor: color.fill.tabOn,
  },
  chipDisabled: { opacity: 0.45 },
  chipLabel: { ...type.caption, color: color.text1 },
  acceptChip: {
    alignSelf: "flex-start",
    minHeight: 36,
    justifyContent: "center",
    paddingHorizontal: space[4],
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: color.paper,
    backgroundColor: color.fill.tile,
  },
  acceptChipLabel: {
    ...type.caption,
    color: color.text1,
    fontWeight: "700",
  },
  linkButton: { minHeight: 32, justifyContent: "center" },
  linkLabel: { ...type.caption, color: color.text1, fontWeight: "700" },
  removeLabel: { ...type.caption, color: color.errorText },
  searchRow: { flexDirection: "row", alignItems: "center", gap: space[2] },
  searchInput: { flex: 1 },
  searchButton: {
    minWidth: 78,
    minHeight: 46,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space[4],
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.lineStrong,
    backgroundColor: color.fill.tile,
  },
  searchButtonLabel: {
    ...type.caption,
    color: color.text1,
    fontWeight: "700",
  },
  result: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[2],
    padding: space[2],
    borderRadius: 12,
    backgroundColor: color.fill.tile,
  },
  card: {
    gap: space[1],
    padding: space[2],
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.lineStrong,
  },
  cardHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[2],
  },
  appRow: { flexDirection: "row", alignItems: "flex-start", gap: space[2] },
  appBadge: {
    minWidth: 28,
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: color.fill.tile,
    alignItems: "center",
  },
  appBadgeLabel: {
    ...type.caption,
    color: color.text2,
    fontWeight: "700",
  },
  appText: { flex: 1, gap: space[1] },
  stepper: { flexDirection: "row", alignItems: "center", gap: space[2] },
  stepperButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.lineStrong,
  },
  stepperLabel: { ...type.h1, color: color.text1 },
  stepperValue: {
    ...type.small,
    color: color.text1,
    minWidth: 64,
    textAlign: "center",
  },
  meterTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: color.fill.tile,
    overflow: "hidden",
  },
  meterFill: { height: 8, borderRadius: 4, backgroundColor: HOST_AD_ACCENT },
  toggleRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    padding: space[2],
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.lineStrong,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: color.text3,
  },
  checkboxChecked: { backgroundColor: color.paper, borderColor: color.paper },
});

export const HOST_AD_APP_BADGES: Record<string, string> = {
  meta: "FB",
  tiktok: "TT",
  snapchat: "SC",
  google: "G",
  reddit: "R",
};
