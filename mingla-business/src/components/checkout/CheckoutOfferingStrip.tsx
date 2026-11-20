/**
 * CheckoutOfferingStrip — issue #4420 wave 2 (spec §4.1 "Phone body"). On a
 * phone, every checkout step after the first opens with the offering it
 * belongs to:
 *
 *   ┌──────┐  SAT 12 DEC · 8 PM
 *   │flyer │  Graphite Rooftop Night      (host face, 20)
 *   └──────┘  Graphite Journey Co
 *    56×70, radius 12
 *
 * Desktop never shows it (the ticket stub carries the same identity), so the
 * strip returns null on the wide layout.
 */
import React from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { useOfferingImageUri } from "@mingla/offering-rendering/useOfferingImageUri";

import { checkoutStyles, checkoutTitleFace, color } from "./checkoutTheme";

export interface CheckoutOfferingStripProps {
  title: string;
  /** "Sat 12 Dec · 8 PM" (date · time). */
  eyebrow: string | null;
  /** The brand, or "{n} travellers". */
  byline: string | null;
  coverUrl: string | null;
  /** True on the desktop stub layout: the strip is not drawn. */
  wide: boolean;
  testID?: string;
}

export function CheckoutOfferingStrip({
  title,
  eyebrow,
  byline,
  coverUrl,
  wide,
  testID = "checkout-offering-strip",
}: CheckoutOfferingStripProps): React.ReactElement | null {
  // #4518 — source only: a failed cover is fetched once more through our own
  // site. Layout, styles, testIDs and the fallback are unchanged.
  const thumb = useOfferingImageUri(coverUrl !== null && coverUrl.length > 0 ? coverUrl : null);
  if (wide) return null;
  return (
    <View
      style={styles.strip}
      testID={testID}
      accessible
      accessibilityLabel={[title, eyebrow, byline].filter((part) => part !== null && part.length > 0).join(", ")}
    >
      {coverUrl !== null && coverUrl.length > 0 ? (
        <Image
          source={{ uri: thumb.uri ?? coverUrl }}
          style={styles.thumb}
          resizeMode="cover"
          accessibilityIgnoresInvertColors
          onLoad={thumb.onLoad}
          onError={thumb.onError}
        />
      ) : (
        <View style={[styles.thumb, styles.thumbFallback]} testID={`${testID}-thumb-fallback`} />
      )}
      <View style={styles.copy}>
        {eyebrow !== null && eyebrow.length > 0 ? (
          <Text style={styles.eyebrow} numberOfLines={1}>
            {eyebrow}
          </Text>
        ) : null}
        <Text style={[styles.title, checkoutTitleFace()]} numberOfLines={2}>
          {title}
        </Text>
        {byline !== null && byline.length > 0 ? (
          <Text style={styles.byline} numberOfLines={1}>
            {byline}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = checkoutStyles(() =>
  StyleSheet.create({
    strip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
      marginBottom: 20,
    },
    thumb: {
      width: 56,
      height: 70,
      borderRadius: 12,
      overflow: "hidden",
    },
    thumbFallback: {
      backgroundColor: color.accentTint,
      borderWidth: 1,
      borderColor: color.line,
    },
    copy: { flex: 1, minWidth: 0, gap: 2 },
    eyebrow: {
      fontSize: 11.5,
      fontWeight: "700",
      letterSpacing: 1,
      textTransform: "uppercase",
      color: color.accentText,
    },
    title: {
      fontSize: 20,
      fontWeight: "700",
      color: color.text1,
    },
    byline: {
      fontSize: 13.5,
      color: color.text2,
    },
  }),
);

export default CheckoutOfferingStrip;
