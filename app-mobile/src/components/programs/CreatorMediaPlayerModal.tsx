import React, { useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";

import { Icon } from "../ui/Icon";

/** A focused in-app shell for Bunny's signed player; no provider URL chrome. */
export function CreatorMediaPlayerModal({
  url,
  onClose,
}: {
  url: string | null;
  onClose: () => void;
}): React.ReactElement {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  return (
    <Modal
      visible={url !== null}
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        {url ? (
          <WebView
            key={url}
            source={{ uri: url }}
            originWhitelist={[
              "https://player.mediadelivery.net",
              "https://iframe.mediadelivery.net",
            ]}
            style={styles.player}
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction
            javaScriptEnabled
            domStorageEnabled
            setSupportMultipleWindows={false}
            onLoadStart={() => setLoading(true)}
            onLoadEnd={() => setLoading(false)}
          />
        ) : null}
        {loading ? (
          <View pointerEvents="none" style={styles.loading}>
            <ActivityIndicator size="large" color="#eb7825" />
          </View>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close video"
          hitSlop={12}
          onPress={onClose}
          style={[styles.close, { top: insets.top + 10 }]}
        >
          <Icon name="close" size={24} color="#ffffff" />
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000000" },
  player: { flex: 1, backgroundColor: "#000000" },
  loading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  close: {
    position: "absolute",
    right: 16,
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.62)",
  },
});
