import { Image } from "expo-image";
import React, { useEffect, useState } from "react";
import { Platform, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { useTranslation } from "react-i18next";

import { thumbnailRequest, type BrandGroupMediaRow } from "../../services/brandGroupMediaService";
import { formatMediaDuration } from "../../utils/formatMediaDuration";
import { Icon } from "../ui/Icon";
import { glass, text as textTokens } from "../../constants/designSystem";
import { requestThumbnailForState, thumbnailResolutionPlan } from "./thumbnailResolution";

const MAX_WEB_THUMB_OBJECT_URLS = 120;
interface WebThumbEntry {
  url: string;
  listeners: Set<(source: { uri: string } | null) => void>;
}
const webThumbCache = new Map<string, WebThumbEntry>();
const webThumbInflight = new Map<string, Promise<string>>();

function retainWebThumb(fileId: string, listener: (source: { uri: string } | null) => void): (() => void) | null {
  const existing = webThumbCache.get(fileId);
  if (!existing) return null;
  webThumbCache.delete(fileId);
  webThumbCache.set(fileId, existing);
  existing.listeners.add(listener);
  listener({ uri: existing.url });
  return () => existing.listeners.delete(listener);
}

async function loadWebThumb(fileId: string, uri: string, headers: Record<string, string>): Promise<string> {
  const existing = webThumbCache.get(fileId);
  if (existing) return existing.url;
  const pending = webThumbInflight.get(fileId);
  if (pending) return pending;
  const request = fetch(uri, { headers, cache: "no-store" }).then(async (response) => {
    if (!response.ok) throw new Error("thumbnail_unavailable");
    const objectUrl = URL.createObjectURL(await response.blob());
    while (webThumbCache.size >= MAX_WEB_THUMB_OBJECT_URLS) {
      const oldest = webThumbCache.entries().next().value as [string, WebThumbEntry] | undefined;
      if (!oldest) break;
      webThumbCache.delete(oldest[0]);
      URL.revokeObjectURL(oldest[1].url);
      for (const notify of oldest[1].listeners) notify(null);
    }
    webThumbCache.set(fileId, { url: objectUrl, listeners: new Set() });
    return objectUrl;
  }).finally(() => webThumbInflight.delete(fileId));
  webThumbInflight.set(fileId, request);
  return request;
}

export function MediaThumb({ item, style, bubble = false }: { item: BrandGroupMediaRow; style?: StyleProp<ViewStyle>; bubble?: boolean }): React.ReactElement {
  const { t } = useTranslation("brandGroupMedia");
  const [source, setSource] = useState<{ uri: string; headers?: Record<string, string> } | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const [loadFailed, setLoadFailed] = useState(false);
  const { shouldRequest, retryDelayMs } = thumbnailResolutionPlan(item.thumbState);
  useEffect(() => {
    let active = true;
    let releaseWebThumb: (() => void) | null = null;
    setSource(null);
    setLoadFailed(false);
    if (!shouldRequest) return undefined;
    void requestThumbnailForState(item.thumbState, () => thumbnailRequest(item.fileId)).then(async (authorized) => {
      if (!authorized) return null;
      if (Platform.OS !== "web") {
        return retryToken === 0
          ? authorized
          : { ...authorized, uri: `${authorized.uri}&retry=${retryToken}` };
      }
      releaseWebThumb = retainWebThumb(item.fileId, setSource);
      if (releaseWebThumb) return null;
      await loadWebThumb(item.fileId, authorized.uri, authorized.headers);
      if (!active) return null;
      releaseWebThumb = retainWebThumb(item.fileId, setSource);
      return null;
    }).then((next) => { if (active && next) setSource(next); }).catch(() => {
      if (active) {
        setSource(null);
        setLoadFailed(true);
      }
    });
    return () => {
      active = false;
      releaseWebThumb?.();
    };
  }, [item.fileId, item.thumbState, retryToken, shouldRequest]);
  useEffect(() => {
    if (!loadFailed || retryDelayMs === null) return undefined;
    const timer = setTimeout(() => setRetryToken((value) => value + 1), retryDelayMs);
    return () => clearTimeout(timer);
  }, [loadFailed, retryDelayMs]);
  const duration = item.kind === "video" ? formatMediaDuration(item.durationMs) : null;
  return (
    <View style={[styles.root, style]}>
      {source ? <Image source={source} contentFit="cover" cachePolicy="disk" onError={() => setLoadFailed(true)} style={StyleSheet.absoluteFill} /> : (
        <View style={styles.placeholder}>
          <Icon name={item.kind === "video" ? "play" : item.kind === "image" ? "eye" : "notebook"} size={24} color={textTokens.tertiary} />
          {item.thumbState === "pending" ? <Text style={styles.preparing} numberOfLines={2}>{t("media.preparing")}</Text> : null}
        </View>
      )}
      {item.kind === "video" ? <View style={[styles.play, bubble && styles.playBubble]}><Icon name="play" size={bubble ? 18 : 14} color="#fff" /></View> : null}
      {duration ? <Text style={styles.duration}>{duration}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { overflow: "hidden", backgroundColor: glass.tint.profileElevated },
  placeholder: { flex: 1, minHeight: 60, alignItems: "center", justifyContent: "center", gap: 4 },
  preparing: { color: textTokens.tertiary, fontSize: 10, textAlign: "center", paddingHorizontal: 4 },
  play: { position: "absolute", left: 8, top: 8, width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.55)" },
  playBubble: { left: "50%", top: "50%", width: 40, height: 40, marginLeft: -20, marginTop: -20, borderRadius: 20 },
  duration: { position: "absolute", right: 6, bottom: 5, color: "#fff", fontSize: 10, fontWeight: "700", textShadowColor: "#000", textShadowRadius: 3 },
});
