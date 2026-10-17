import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Image, Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";
import { WebView } from "react-native-webview";

import { accent, canvas, glass, radius, spacing, text as textTokens } from "../../constants/designSystem";
import { brandGroupFilePreviewRequest } from "../../services/brandGroupsService";
import { Icon } from "../ui/Icon";

interface PreviewFile { id: string; name: string; mime: string; size: number | null }
type PreviewRequest = { uri: string; headers: Record<string, string> };

export function BrandGroupFilePreviewModal({ file, onClose }: { file: PreviewFile | null; onClose: () => void }): React.ReactElement {
  const [request, setRequest] = useState<PreviewRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let objectUrl: string | null = null;
    let active = true;
    setRequest(null);
    setError(null);
    if (!file) return;
    void brandGroupFilePreviewRequest(file.id)
      .then(async (authorized) => {
        if (Platform.OS !== "web") return authorized;
        const response = await fetch(authorized.uri, { headers: authorized.headers, cache: "no-store" });
        if (!response.ok) throw new Error("This file is no longer available.");
        objectUrl = URL.createObjectURL(await response.blob());
        return { uri: objectUrl, headers: {} };
      })
      .then((authorized) => { if (active) setRequest(authorized); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Couldn't open this file."); });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file]);
  const videoSource = useMemo(() => request && file?.mime.startsWith("video/") ? { ...request, contentType: "auto" as const } : null, [file?.mime, request]);
  const player = useVideoPlayer(videoSource, (instance) => { instance.loop = false; });
  const size = file?.size ? `${(file.size / 1024 / 1024).toFixed(file.size > 1024 * 1024 ? 1 : 2)} MB` : null;

  return (
    <Modal visible={file !== null} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={styles.screen}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="Close file preview" onPress={onClose} style={styles.close}><Icon name="close" size={20} color={textTokens.primary} /></Pressable>
          <View style={styles.headerCopy}><Text style={styles.title} numberOfLines={1}>{file?.name}</Text><Text style={styles.meta}>{[file?.mime, size].filter(Boolean).join(" · ")}</Text></View>
        </View>
        {!request && !error ? <View style={styles.state}><ActivityIndicator color={accent.warm} /><Text style={styles.stateText}>Checking access…</Text></View> : null}
        {error ? <View style={styles.state}><Icon name="shield" size={28} color={textTokens.tertiary} /><Text style={styles.stateText}>{error}</Text></View> : null}
        {request && file?.mime.startsWith("image/") ? <Image source={{ uri: request.uri, headers: request.headers }} resizeMode="contain" style={styles.media} accessibilityLabel={file.name} /> : null}
        {request && file?.mime.startsWith("video/") ? <VideoView player={player} style={styles.media} nativeControls contentFit="contain" /> : null}
        {request && file?.mime === "application/pdf" ? <WebView source={{ uri: request.uri, headers: request.headers }} style={styles.webview} javaScriptEnabled={false} sharedCookiesEnabled={false} /> : null}
        {request && file && !file.mime.startsWith("image/") && !file.mime.startsWith("video/") && file.mime !== "application/pdf" ? (
          <View style={styles.card}><Icon name="notebook" size={34} color={accent.warm} /><Text style={styles.cardTitle}>{file.name}</Text><Text style={styles.stateText}>This file is stored securely in the Brand group&apos;s shared Drive folder. Preview is available for images, videos, and PDFs.</Text></View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: canvas.profile },
  header: { minHeight: 68, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, borderBottomWidth: 1, borderBottomColor: glass.border.profileBase },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  headerCopy: { flex: 1, minWidth: 0 },
  title: { color: textTokens.primary, fontSize: 16, fontWeight: "800" },
  meta: { color: textTokens.tertiary, fontSize: 11, marginTop: 3 },
  media: { flex: 1, width: "100%", backgroundColor: "#050608" },
  webview: { flex: 1, backgroundColor: "#fff" },
  state: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.xl },
  stateText: { color: textTokens.secondary, textAlign: "center", lineHeight: 20 },
  card: { margin: "auto", maxWidth: 520, alignItems: "center", gap: spacing.md, padding: spacing.xl, borderRadius: radius.xl, borderWidth: 1, borderColor: glass.border.profileElevated, backgroundColor: glass.tint.profileElevated },
  cardTitle: { color: textTokens.primary, fontSize: 17, fontWeight: "800", textAlign: "center" },
});
