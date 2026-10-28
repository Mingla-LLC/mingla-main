import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { radius, spacing, text as textTokens, typography } from "../../constants/designSystem";
import type { SitePreviewPaneProps } from "./SitePreviewPane";
import { previewUrlForFrame } from "../../sites/previewFrame";

/*
 * #2829 W9a — the live draft preview on Business web: an iframe (WebView has
 * no web target). The runtime's preview route allows framing by Business web,
 * Studio and (locally) loopback only (frame-ancestors), so the private draft
 * cannot be framed anywhere else. #2829 W9f — a Business Vercel preview
 * deployment names its own origin on the link (previewUrlForFrame).
 */
export type { SitePreviewPaneProps };

export function SitePreviewPane({ url, title = "Website draft preview", height = 520 }: SitePreviewPaneProps): React.ReactElement {
  const [loaded, setLoaded] = useState(false);
  return (
    <View style={[styles.frame, { height }]} testID="site-preview-pane">
      <Text style={styles.caption}>{loaded ? "Draft preview · not public" : "Loading your draft…"}</Text>
      {React.createElement("iframe", {
        src: previewUrlForFrame(url, typeof window === "undefined" ? null : window.location.origin),
        title,
        onLoad: () => setLoaded(true),
        style: { border: 0, width: "100%", flex: 1, background: "#ffffff" },
        referrerPolicy: "no-referrer",
        sandbox: "allow-scripts allow-same-origin allow-forms",
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { borderRadius: radius.md, overflow: "hidden", borderWidth: 1, borderColor: textTokens.quaternary, gap: spacing.xs },
  caption: { ...typography.caption, color: textTokens.tertiary, paddingHorizontal: spacing.sm, paddingTop: spacing.xs },
});
