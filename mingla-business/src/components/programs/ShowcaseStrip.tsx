/**
 * #3872 — creator showcase thumbnails. Tapping one plays it full screen
 * through the public showcase link (verified creators only).
 *
 * #4402 — the playback link is Bunny's signed embed PAGE, so it plays in an
 * iframe (web) or a WebView (native), the way Explorer and Admin play it. A
 * raw video element never loads it (a frozen 0:00 player). Failures show a
 * message, never a silent player.
 */
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { WebView } from "react-native-webview";

import { Icon } from "../ui/Icon";
import { showcasePlayback } from "../../services/creatorGigsService";
import {
  CREATOR_VIDEO_ERROR,
  creatorVideoSurface,
} from "../../utils/creatorProgramFormat";
import { color, radius, scrim, space } from "../../constants/designSystem";

// #4420: placeholder tiles (no poster yet) step through the Graphite card tones.
const TILE_TONES = [color.card2, color.card3, color.card];

export function ShowcaseStrip({
  items,
  creatorName,
  size = "row",
}: {
  items: ReadonlyArray<{ media_id: string; thumb?: string | null }>;
  creatorName: string;
  size?: "row" | "large";
}): React.ReactElement | null {
  const [uri, setUri] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [failedId, setFailedId] = useState<string | null>(null);
  if (items.length === 0) return null;
  const play = async (id: string) => {
    setLoadingId(id);
    setFailedId(null);
    try {
      setUri(await showcasePlayback(id));
    } catch {
      setFailedId(id);
    } finally {
      setLoadingId(null);
    }
  };
  const shown = items.slice(0, size === "large" ? 4 : 3);
  return (
    <View>
      <View style={styles.row}>
        {shown.map((item, index) => (
          <Pressable
            key={item.media_id}
            onPress={() => void play(item.media_id)}
            accessibilityRole="button"
            accessibilityLabel={`Play ${creatorName}'s showcase video ${index + 1}`}
            style={[
              styles.tile,
              size === "large" ? styles.tileLarge : styles.tileRow,
              { backgroundColor: TILE_TONES[index % TILE_TONES.length] },
            ]}
          >
            {item.thumb ? (
              <Image
                source={{ uri: item.thumb }}
                style={styles.tileThumb}
                resizeMode="cover"
                accessibilityIgnoresInvertColors
              />
            ) : null}
            {loadingId === item.media_id ? (
              <ActivityIndicator color={color.text1} />
            ) : (
              <Icon
                name="play"
                size={size === "large" ? 26 : 18}
                color={color.text1}
              />
            )}
          </Pressable>
        ))}
      </View>
      {failedId ? (
        <Text style={styles.failed}>This video isn't available right now.</Text>
      ) : null}
      <CreatorVideoPlayer
        url={uri}
        title={`${creatorName}'s showcase`}
        onClose={() => setUri(null)}
      />
    </View>
  );
}

/** Full-screen player for a creator video's signed Bunny embed link. */
export function CreatorVideoPlayer({
  url,
  title,
  onClose,
}: {
  url: string | null;
  title: string;
  onClose: () => void;
}): React.ReactElement {
  const surface = creatorVideoSurface(url, Platform.OS);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setLoading(true);
    setFailed(false);
  }, [url]);
  const showError = url !== null && (surface === "error" || failed);
  return (
    <Modal
      visible={url !== null}
      animationType="fade"
      onRequestClose={onClose}
      transparent={false}
    >
      <View style={styles.playerRoot}>
        {url !== null && !showError && surface === "iframe"
          ? React.createElement("iframe", {
              key: url,
              src: url,
              title,
              allow: "accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen",
              allowFullScreen: true,
              referrerPolicy: "strict-origin-when-cross-origin",
              onLoad: () => setLoading(false),
              onError: () => setFailed(true),
              style: { border: 0, width: "100%", height: "100%", background: color.camera },
            })
          : null}
        {url !== null && !showError && surface === "webview" ? (
          <WebView
            key={url}
            source={{ uri: url }}
            originWhitelist={[
              "https://player.mediadelivery.net",
              "https://iframe.mediadelivery.net",
            ]}
            style={styles.player}
            allowsInlineMediaPlayback
            allowsFullscreenVideo
            javaScriptEnabled
            domStorageEnabled
            setSupportMultipleWindows={false}
            onLoadEnd={() => setLoading(false)}
            onError={() => setFailed(true)}
            onHttpError={() => setFailed(true)}
          />
        ) : null}
        {showError ? (
          <View style={styles.playerMessage} accessibilityRole="alert">
            <Icon name="flag" size={24} color={color.text1} />
            <Text style={styles.playerError}>{CREATOR_VIDEO_ERROR}</Text>
          </View>
        ) : loading ? (
          <View pointerEvents="none" style={styles.playerMessage}>
            <ActivityIndicator size="large" color={color.text2} />
          </View>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Close ${title}`}
          hitSlop={12}
          onPress={onClose}
          style={styles.playerClose}
        >
          <Icon name="close" size={22} color={color.textStrong} />
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: space[2] },
  tile: {
    overflow: "hidden",
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: color.lineStrong,
  },
  // #4402 (H29) — 9:16 tiles, never smaller than 96 x 170.
  tileRow: { width: 96, minWidth: 96, aspectRatio: 9 / 16, minHeight: 170 },
  tileLarge: { flex: 1, minWidth: 96, aspectRatio: 9 / 16, minHeight: 170 },
  tileThumb: { ...StyleSheet.absoluteFillObject, borderRadius: radius.md },
  failed: { color: color.text3, fontSize: 12, marginTop: space[1] },
  playerRoot: { flex: 1, backgroundColor: color.camera },
  player: { flex: 1, backgroundColor: color.camera },
  playerMessage: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    gap: space[2],
    padding: space[6],
  },
  playerError: { color: color.text1, fontSize: 15, textAlign: "center" },
  playerClose: {
    position: "absolute",
    top: 48,
    right: 16,
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: scrim.modal,
  },
});
