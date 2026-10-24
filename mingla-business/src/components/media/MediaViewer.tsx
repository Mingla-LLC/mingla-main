import * as FileSystem from "expo-file-system/legacy";
import { Image } from "expo-image";
import { useVideoPlayer, VideoView } from "expo-video";
import { registerVideoPlayerForReload } from "@mingla/offering-rendering/videoPlayerReloadRelease";
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { Gesture } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { WebView } from "react-native-webview";
import { useTranslation } from "react-i18next";

import { accent, spacing, text as textTokens } from "../../constants/designSystem";
import type { BrandGroupMediaRow } from "../../services/brandGroupMediaService";
import { formatFileSize } from "../../utils/formatMediaDuration";
import { Icon } from "../ui/Icon";
import { WebSafeGestureDetector } from "../ui/WebSafeGestureDetector";
import { MediaThumb } from "./MediaThumb";
import { MediaViewerShell, type MediaViewerStage } from "./MediaViewerShell";
import { fitContain } from "./fitContain";
import { useReducedMotionNative } from "../../hooks/useReducedMotionNative";

export type ViewerRequest = { uri: string; headers: Record<string, string> };
export type ViewerProgress = { loaded: number; total: number };

interface MediaViewerProps {
  visible: boolean;
  items: BrandGroupMediaRow[];
  initialIndex: number;
  requestFor: (fileId: string, onProgress?: (progress: ViewerProgress) => void) => Promise<ViewerRequest>;
  onActiveIndexChange?: (index: number) => void;
  onShowInChat: (messageId: string) => void;
  onClose: () => void;
}

function ActiveVideo({ source, label, style }: { source: ViewerRequest; label: string; style: { width: number; height: number } }): React.ReactElement {
  const player = useVideoPlayer({ ...source, contentType: "auto" }, (instance) => { instance.loop = false; });
  useEffect(() => registerVideoPlayerForReload(player), [player]);
  useEffect(() => () => { try { player.pause(); } catch { /* released during OTA restart */ } }, [player]);
  return <VideoView player={player} nativeControls contentFit="contain" accessibilityLabel={label} style={style} />;
}

function ViewerPage({ item, request, progress, stage, active }: { item: BrandGroupMediaRow; request: ViewerRequest | null; progress: ViewerProgress | null; stage: MediaViewerStage; active: boolean }): React.ReactElement {
  const { t } = useTranslation("brandGroupMedia");
  const box = fitContain(item.width, item.height, stage.width, stage.height);
  const boxStyle = { width: box.width, height: box.height };
  if (!active) return <MediaThumb item={item} style={boxStyle} />;
  const localizedSize = (size: number): string => formatFileSize(size, (key, variables) => t(key, variables));
  if (!request) return <View style={[stage.style, styles.state]}><ActivityIndicator color={accent.warm} /><Text style={styles.stateText}>{progress && progress.total > 0 ? t("viewer.loading_progress", { loaded: localizedSize(progress.loaded), total: localizedSize(progress.total) }) : t("viewer.loading")}</Text></View>;
  if (item.kind === "image") return <Image source={request} contentFit="contain" accessibilityLabel={item.name} style={boxStyle} />;
  if (item.kind === "video") return <ActiveVideo source={request} label={item.name} style={boxStyle} />;
  if (item.mime === "application/pdf") {
    if (Platform.OS === "web") {
      return React.createElement("iframe", { src: request.uri, title: item.name, style: { border: 0, background: "#fff", ...boxStyle } });
    }
    return <WebView source={request} style={[boxStyle, styles.pdf]} javaScriptEnabled={false} sharedCookiesEnabled={false} />;
  }
  return <View style={[stage.style, styles.state]}><Icon name="notebook" size={36} color={accent.warm} /><Text style={styles.itemTitle}>{item.name}</Text><Text style={styles.stateText}>{t("viewer.not_previewable")}</Text></View>;
}

export function MediaViewer({ visible, items, initialIndex, requestFor, onActiveIndexChange, onShowInChat, onClose }: MediaViewerProps): React.ReactElement {
  const { t, i18n } = useTranslation("brandGroupMedia");
  const [index, setIndex] = useState(Math.max(0, Math.min(initialIndex, Math.max(0, items.length - 1))));
  const [requests, setRequests] = useState<Record<string, ViewerRequest>>({});
  const [progress, setProgress] = useState<Record<string, ViewerProgress>>({});
  const [errorIds, setErrorIds] = useState<Set<string>>(new Set());
  const [deliveryFeedback, setDeliveryFeedback] = useState<"saved" | "failed" | null>(null);
  const listRef = useRef<FlatList<BrandGroupMediaRow>>(null);
  const current = items[index] ?? null;
  const { fontScale } = useWindowDimensions();
  const usesLargeTextLayout = fontScale >= 1.5;
  const reduceMotion = useReducedMotionNative();
  const dragY = useSharedValue(0);

  useEffect(() => {
    if (!visible) {
      setRequests({});
      setProgress({});
      setErrorIds(new Set());
      setDeliveryFeedback(null);
      return;
    }
    const next = Math.max(0, Math.min(initialIndex, Math.max(0, items.length - 1)));
    setIndex(next);
    if (Platform.OS !== "web") setTimeout(() => listRef.current?.scrollToIndex({ index: next, animated: false }), 0);
  }, [initialIndex, items.length, visible]);

  useEffect(() => {
    if (!deliveryFeedback) return;
    const timer = setTimeout(() => setDeliveryFeedback(null), 2_500);
    return () => clearTimeout(timer);
  }, [deliveryFeedback]);

  useEffect(() => {
    if (!visible) return;
    if (items.length === 0) {
      onClose();
      return;
    }
    if (index >= items.length) setIndex(items.length - 1);
  }, [index, items.length, onClose, visible]);

  useEffect(() => {
    if (!visible || !current || requests[current.fileId] || errorIds.has(current.fileId)) return;
    let active = true;
    void requestFor(current.fileId, (next) => {
      if (active) setProgress((value) => ({ ...value, [current.fileId]: next }));
    })
      .then((request) => { if (active) setRequests((value) => ({ ...value, [current.fileId]: request })); })
      .catch(() => { if (active) setErrorIds((value) => new Set(value).add(current.fileId)); });
    return () => { active = false; };
  }, [current, errorIds, requestFor, requests, visible]);

  useEffect(() => {
    if (!visible || Platform.OS !== "web") return;
    const keep = new Set(items.slice(Math.max(0, index - 1), index + 2).map((item) => item.fileId));
    setRequests((value) => Object.fromEntries(Object.entries(value).filter(([id]) => keep.has(id))));
  }, [index, items, visible]);

  useEffect(() => {
    if (!visible || !current) return;
    void AccessibilityInfo.announceForAccessibility(t("viewer.page_a11y", { index: index + 1, total: items.length, name: current.name }));
  }, [current, index, items.length, t, visible]);

  useLayoutEffect(() => {
    if (visible && current) onActiveIndexChange?.(index);
  }, [current, index, onActiveIndexChange, visible]);

  const move = useCallback((delta: number) => {
    setIndex((value) => {
      const next = Math.max(0, Math.min(items.length - 1, value + delta));
      if (Platform.OS !== "web") listRef.current?.scrollToIndex({ index: next, animated: !reduceMotion });
      return next;
    });
  }, [items.length, reduceMotion]);

  const closeFromGesture = useCallback(() => onClose(), [onClose]);
  const verticalDismiss = useMemo(() => Gesture.Pan()
    .enabled(Platform.OS !== "web")
    .activeOffsetY([-12, 12])
    .failOffsetX([-24, 24])
    .onUpdate((event) => { dragY.value = Math.max(0, event.translationY); })
    .onEnd((event) => {
      if (event.translationY > 120 || event.velocityY > 800) {
        runOnJS(closeFromGesture)();
        return;
      }
      dragY.value = reduceMotion ? 0 : withSpring(0, { damping: 18, stiffness: 220 });
    }), [closeFromGesture, dragY, reduceMotion]);
  const dismissStyle = useAnimatedStyle(() => ({ transform: [{ translateY: dragY.value }] }));

  const meta = useMemo(() => {
    if (!current) return "";
    return t("viewer.meta", {
      index: index + 1,
      total: items.length,
      sender: current.senderDisplayName,
      date: new Intl.DateTimeFormat(i18n.language, { month: "short", day: "numeric" }).format(new Date(current.createdAt)),
      size: formatFileSize(current.sizeBytes, (key, variables) => t(key, variables)),
    });
  }, [current, i18n.language, index, items.length, t]);

  async function deliverFile(): Promise<void> {
    if (!current) return;
    let downloadedUri: string | null = null;
    try {
      const request = requests[current.fileId] ?? await requestFor(current.fileId);
      if (Platform.OS === "web") {
        const anchor = document.createElement("a");
        anchor.href = request.uri;
        anchor.download = current.name;
        anchor.click();
        setDeliveryFeedback("saved");
        return;
      }
      const cacheUri = `${FileSystem.cacheDirectory ?? ""}${current.fileId}-${current.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const downloaded = await FileSystem.downloadAsync(request.uri, cacheUri, { headers: request.headers });
      downloadedUri = downloaded.uri;
      if (Platform.OS === "ios") {
        // SHARE-NON-CONTENT:file-export
        await Share.share({ url: downloaded.uri });
      } else {
        const permission = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
        if (!permission.granted) return;
        const destination = await FileSystem.StorageAccessFramework.createFileAsync(permission.directoryUri, current.name, current.mime);
        const contents = await FileSystem.readAsStringAsync(downloaded.uri, { encoding: FileSystem.EncodingType.Base64 });
        await FileSystem.writeAsStringAsync(destination, contents, { encoding: FileSystem.EncodingType.Base64 });
      }
      setDeliveryFeedback("saved");
    } catch {
      setDeliveryFeedback("failed");
    } finally {
      if (downloadedUri) void FileSystem.deleteAsync(downloadedUri, { idempotent: true });
    }
  }

  function renderStage(stage: MediaViewerStage): React.ReactNode {
    if (!current) return null;
    if (errorIds.has(current.fileId)) return <View style={[stage.style, styles.state]}><Text style={styles.stateText}>{t("viewer.unavailable")}</Text></View>;
    if (Platform.OS === "web") return <ViewerPage item={current} request={requests[current.fileId] ?? null} progress={progress[current.fileId] ?? null} stage={stage} active />;
    return (
      <FlatList
        ref={listRef}
        horizontal
        pagingEnabled
        windowSize={3}
        data={items}
        initialScrollIndex={index}
        getItemLayout={(_, itemIndex) => ({ length: stage.width, offset: stage.width * itemIndex, index: itemIndex })}
        keyExtractor={(item) => item.fileId}
        onMomentumScrollEnd={(event: NativeSyntheticEvent<NativeScrollEvent>) => setIndex(Math.round(event.nativeEvent.contentOffset.x / Math.max(1, stage.width)))}
        renderItem={({ item }) => <View style={[stage.style, styles.page]}><ViewerPage item={item} request={requests[item.fileId] ?? null} progress={progress[item.fileId] ?? null} stage={stage} active={item.fileId === current.fileId} /></View>}
        showsHorizontalScrollIndicator={false}
      />
    );
  }

  const closeButton = <Pressable accessibilityRole="button" accessibilityLabel={t("viewer.close_a11y")} onPress={onClose} style={styles.circle}><Icon name="close" size={20} color="#fff" /></Pressable>;
  const deliverButton = <Pressable accessibilityRole="button" accessibilityLabel={Platform.OS === "web" ? t("viewer.download") : Platform.OS === "ios" ? t("viewer.share") : t("viewer.save")} onPress={() => void deliverFile()} style={Platform.OS === "web" ? styles.action : styles.circle}>{Platform.OS === "web" ? <Text style={styles.actionText}>{t("viewer.download")}</Text> : <Icon name={Platform.OS === "ios" ? "share" : "download"} size={20} color="#fff" />}</Pressable>;
  const showInChatButton = current?.messageId ? <Pressable accessibilityRole="button" onPress={() => { const id = current.messageId; onClose(); onShowInChat(id); }} style={styles.action}><Text style={styles.actionText}>{t("viewer.show_in_chat")}</Text></Pressable> : null;
  const topBar = current ? (
    <View style={[styles.topRow, usesLargeTextLayout && styles.topRowLargeText]}>
      {Platform.OS === "web" ? null : closeButton}
      <View style={styles.topCopy}><Text style={styles.itemTitle} numberOfLines={usesLargeTextLayout ? 2 : 1}>{current.name}</Text><Text style={styles.meta} numberOfLines={usesLargeTextLayout ? 2 : 1}>{meta}</Text></View>
      {deliverButton}
      {showInChatButton}
      {Platform.OS === "web" ? closeButton : null}
    </View>
  ) : null;
  const bottomBar = current ? (
    <View style={styles.bottom}>
      <FlatList horizontal data={items} keyExtractor={(item) => item.fileId} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip} renderItem={({ item, index: itemIndex }) => (
        <Pressable accessibilityRole="button" accessibilityLabel={t("viewer.page_a11y", { index: itemIndex + 1, total: items.length, name: item.name })} onPress={() => move(itemIndex - index)} style={[styles.stripItem, itemIndex === index && styles.stripItemActive]}>
          <MediaThumb item={item} style={styles.stripThumb} />
        </Pressable>
      )} />
      <Text accessibilityLiveRegion="polite" style={[styles.hint, deliveryFeedback === "failed" && styles.feedbackError]}>{deliveryFeedback === "saved" ? t("viewer.saved") : deliveryFeedback === "failed" ? t("viewer.save_failed") : Platform.OS === "web" ? t("viewer.hint_web") : t("viewer.hint")}</Text>
    </View>
  ) : null;

  return (
    <MediaViewerShell visible={visible && current !== null} onClose={onClose} closeAccessibilityLabel={t("viewer.close_a11y")} topBar={topBar} bottomBar={bottomBar} onPrevious={() => move(-1)} onNext={() => move(1)} testID="brand-group-media-viewer">
      {(stage) => (
        <WebSafeGestureDetector gesture={verticalDismiss}>
          <Animated.View style={[styles.stageLine, dismissStyle]}>
            {Platform.OS === "web" && index > 0 ? <Pressable accessibilityRole="button" accessibilityLabel={t("viewer.previous_a11y")} onPress={() => move(-1)} style={styles.arrow}><Icon name="arrowL" size={22} color="#fff" /></Pressable> : null}
            {renderStage(stage)}
            {Platform.OS === "web" && index < items.length - 1 ? <Pressable accessibilityRole="button" accessibilityLabel={t("viewer.next_a11y")} onPress={() => move(1)} style={styles.arrow}><View style={styles.arrowRight}><Icon name="arrowL" size={22} color="#fff" /></View></Pressable> : null}
          </Animated.View>
        </WebSafeGestureDetector>
      )}
    </MediaViewerShell>
  );
}

const styles = StyleSheet.create({
  stageLine: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 12 },
  page: { alignItems: "center", justifyContent: "center" },
  topRow: { minHeight: 56, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: 6 },
  topRowLargeText: { minHeight: 84, paddingVertical: 10 },
  circle: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.14)" },
  topCopy: { flex: 1, minWidth: 0 },
  itemTitle: { color: "#fff", fontSize: 14, fontWeight: "800", textAlign: "center" },
  meta: { color: "rgba(255,255,255,0.6)", fontSize: 11, marginTop: 2 },
  action: { minHeight: 44, justifyContent: "center", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 22, backgroundColor: "rgba(255,255,255,0.12)" },
  actionText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  arrow: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.12)" },
  arrowRight: { transform: [{ rotate: "180deg" }] },
  bottom: { minHeight: 72, alignItems: "center", gap: 4, paddingBottom: 4 },
  strip: { gap: 6, paddingHorizontal: spacing.md },
  stripItem: { width: 44, minHeight: 44, borderRadius: 8, padding: 4, opacity: 0.55 },
  stripItemActive: { borderWidth: 2, borderColor: accent.warm, opacity: 1 },
  stripThumb: { width: 36, height: 36, borderRadius: 5 },
  hint: { color: "rgba(255,255,255,0.45)", fontSize: 11 },
  feedbackError: { color: "#ff9b9b" },
  state: { alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.xl },
  stateText: { color: textTokens.secondary, textAlign: "center", lineHeight: 20, maxWidth: 480 },
  pdf: { backgroundColor: "#fff" },
});
