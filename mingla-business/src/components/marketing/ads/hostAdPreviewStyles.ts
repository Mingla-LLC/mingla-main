/** #4238 media-buyer — the ad preview frame. */
import { StyleSheet } from "react-native";

import { color, scrim, space, type } from "../../../constants/designSystem";

export const previewStyles = StyleSheet.create({
  frame: {
    alignSelf: "center",
    width: "100%",
    maxWidth: 280,
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.lineStrong,
    backgroundColor: color.card,
  },
  frameFeed: { aspectRatio: 4 / 5 },
  frameTall: { aspectRatio: 9 / 16 },
  media: { ...StyleSheet.absoluteFillObject },
  mediaEmpty: { backgroundColor: color.fill.tile },
  caption: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    gap: 4,
    padding: space[2],
    backgroundColor: scrim.modal,
  },
  brand: { ...type.caption, color: color.text2 },
  text: { ...type.caption, color: color.text1 },
  headline: { ...type.small, color: color.text1, fontWeight: "700" },
  button: {
    alignSelf: "flex-start",
    marginTop: 4,
    paddingHorizontal: space[4],
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: color.paper,
  },
  buttonLabel: { ...type.caption, color: color.ink, fontWeight: "700" },
});
