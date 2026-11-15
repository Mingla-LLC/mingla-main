import React, { useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { WebView } from "react-native-webview";
import {
  color,
  radius,
  space,
  type,
} from "../../constants/designSystem";

/*
 * #2829 W9a — the live draft preview beside the plan (native: a WebView; web
 * uses an iframe, SitePreviewPane.web.tsx). The preview link is a short-lived
 * private one Core minted for this draft; the runtime lets only Mingla
 * Business frame it. Nothing here is public. Ready to mount in Ari's split
 * view once #3355 takes it (that screen is not edited here).
 */
export interface SitePreviewPaneProps {
  url: string;
  title?: string;
  height?: number;
}

export function SitePreviewPane({ url, title = "Website draft preview", height = 520 }: SitePreviewPaneProps): React.ReactElement {
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  return (
    <View style={[styles.frame, { height }]} accessibilityLabel={title} testID="site-preview-pane">
      <Text style={styles.caption}>Draft preview · not public</Text>
      {failed ? (
        <Text style={styles.error} accessibilityRole="alert">The draft preview didn&apos;t load. Tap Refresh draft to try again.</Text>
      ) : (
        <WebView
          source={{ uri: url }}
          style={styles.web}
          onLoadEnd={() => setLoading(false)}
          onError={() => { setFailed(true); setLoading(false); }}
          onHttpError={() => { setFailed(true); setLoading(false); }}
          sharedCookiesEnabled={false}
          setSupportMultipleWindows={false}
        />
      )}
      {loading && !failed ? <ActivityIndicator style={styles.spinner} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { borderRadius: radius.sm, overflow: "hidden", borderWidth: 1, borderColor: color.text4, gap: space[1] },
  web: { flex: 1, backgroundColor: color.paper },
  caption: { ...type.caption, color: color.text3, paddingHorizontal: space[2], paddingTop: space[1] },
  error: { ...type.small, color: color.errorText, padding: space[4] },
  spinner: { position: "absolute", top: "50%", alignSelf: "center" },
});
