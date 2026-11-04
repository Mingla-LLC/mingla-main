/** #4238 media-buyer — the ad preview frame. */
import { StyleSheet } from "react-native";

import {
  glass,
  spacing,
  text as textTokens,
  typography,
} from "../../../constants/designSystem";
import { HOST_AD_ACCENT } from "./hostAdBuilderStyles";

export const previewStyles = StyleSheet.create({
  frame: {
    alignSelf: "center",
    width: "100%",
    maxWidth: 280,
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.chrome,
    backgroundColor: "#0b0b0d",
  },
  frameFeed: { aspectRatio: 4 / 5 },
  frameTall: { aspectRatio: 9 / 16 },
  media: { ...StyleSheet.absoluteFillObject },
  mediaEmpty: { backgroundColor: glass.tint.chrome.idle },
  caption: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    gap: 4,
    padding: spacing.sm,
    backgroundColor: "rgba(0,0,0,.55)",
  },
  brand: { ...typography.caption, color: textTokens.secondary },
  text: { ...typography.caption, color: textTokens.primary },
  headline: { ...typography.bodySm, color: textTokens.primary, fontWeight: "700" },
  button: {
    alignSelf: "flex-start",
    marginTop: 4,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: HOST_AD_ACCENT,
  },
  buttonLabel: { ...typography.caption, color: "#ffffff", fontWeight: "700" },
});
