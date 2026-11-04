/**
 * #4238 media-buyer — the button picker, per-app text counters, a preview
 * per app and placement, and the read-only tracking tags.
 */
import React, { useState } from "react";
import { Image, Pressable, Text, View } from "react-native";

import { platformName } from "./hostAdCopy";
import { hostAdStyles as s } from "./hostAdBuilderStyles";
import {
  HOST_AD_CTA_LABELS,
  HOST_AD_CTA_OPTIONS,
  type HostAdCtaId,
  hostAdTextCounts,
  hostAdTikTokEmojiNote,
  hostAdUtmLines,
} from "./hostAdCreativeRules";
import { previewStyles as p } from "./hostAdPreviewStyles";

export function HostAdCtaPicker(props: {
  value: HostAdCtaId;
  onChange: (value: HostAdCtaId) => void;
  apps: readonly string[];
}): React.ReactElement {
  return (
    <View style={s.block} testID="host-ad-cta">
      <Text style={s.label}>Button</Text>
      <View style={s.chipRow}>
        {HOST_AD_CTA_OPTIONS.map((option) => (
          <Pressable
            key={option.id}
            style={[s.chip, props.value === option.id && s.chipSelected]}
            onPress={() => props.onChange(option.id)}
            accessibilityRole="radio"
            accessibilityState={{ selected: props.value === option.id }}
            accessibilityLabel={`Button: ${option.label}`}
            testID={`host-ad-cta-${option.id}`}
          >
            <Text style={s.chipLabel}>{option.label}</Text>
          </Pressable>
        ))}
      </View>
      {props.apps.includes("google") ? (
        <Text style={s.helper}>Google ads have no button; people tap the ad itself.</Text>
      ) : null}
    </View>
  );
}

export function HostAdTextCounters(props: {
  apps: readonly string[];
  primary: string;
  headline: string;
}): React.ReactElement | null {
  const rows = hostAdTextCounts(props.apps, { primary: props.primary, headline: props.headline });
  const emoji = hostAdTikTokEmojiNote(props.apps, props.primary);
  if (rows.length === 0 && !emoji) return null;
  return (
    <View style={s.block} testID="host-ad-text-counters">
      {rows.map((row) => (
        <Text
          key={`${row.platform}:${row.field}`}
          style={row.over ? (row.hard ? s.error : s.warn) : s.faint}
          testID={`host-ad-count-${row.platform}-${row.field}`}
        >
          {row.line}
        </Text>
      ))}
      {emoji ? <Text style={s.warn}>{emoji}</Text> : null}
    </View>
  );
}

const PLACEMENTS: Record<string, readonly { id: string; label: string }[]> = {
  meta: [
    { id: "feed", label: "Feed" },
    { id: "story", label: "Stories and Reels" },
  ],
  tiktok: [{ id: "story", label: "For You" }],
  snapchat: [{ id: "story", label: "Between Stories" }],
  google: [{ id: "feed", label: "YouTube and Discover" }],
  reddit: [{ id: "feed", label: "Feed" }],
};

export function HostAdPreview(props: {
  apps: readonly string[];
  posterUrl: string | null;
  brandName: string;
  primary: string;
  headline: string;
  cta: HostAdCtaId;
}): React.ReactElement | null {
  const [app, setApp] = useState<string | null>(null);
  const [placement, setPlacement] = useState<string | null>(null);
  if (props.apps.length === 0) return null;
  const current = app && props.apps.includes(app) ? app : props.apps[0];
  const places = PLACEMENTS[current] ?? PLACEMENTS.meta;
  const place = places.find((row) => row.id === placement) ?? places[0];
  const tall = place.id === "story";
  const button = HOST_AD_CTA_LABELS[current]?.[props.cta] ?? null;
  const shownText = current === "meta" && [...props.primary].length > 125
    ? `${[...props.primary].slice(0, 125).join("")}… See more`
    : props.primary;
  return (
    <View style={s.block} testID="host-ad-preview">
      <Text style={s.label}>Preview</Text>
      <View style={s.chipRow}>
        {props.apps.map((item) => (
          <Pressable
            key={item}
            style={[s.chip, current === item && s.chipSelected]}
            onPress={() => {
              setApp(item);
              setPlacement(null);
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected: current === item }}
            accessibilityLabel={`Preview on ${platformName(item)}`}
            testID={`host-ad-preview-app-${item}`}
          >
            <Text style={s.chipLabel}>{platformName(item)}</Text>
          </Pressable>
        ))}
      </View>
      {places.length > 1 ? (
        <View style={s.chipRow}>
          {places.map((row) => (
            <Pressable
              key={row.id}
              style={[s.chip, place.id === row.id && s.chipSelected]}
              onPress={() => setPlacement(row.id)}
              accessibilityRole="tab"
              accessibilityState={{ selected: place.id === row.id }}
              accessibilityLabel={`Preview in ${row.label}`}
              testID={`host-ad-preview-place-${row.id}`}
            >
              <Text style={s.chipLabel}>{row.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <View style={[p.frame, tall ? p.frameTall : p.frameFeed]} testID="host-ad-preview-frame">
        {props.posterUrl ? (
          <Image source={{ uri: props.posterUrl }} style={p.media} resizeMode="cover" />
        ) : (
          <View style={[p.media, p.mediaEmpty]} />
        )}
        <View style={p.caption}>
          <Text style={p.brand}>{props.brandName} · Sponsored</Text>
          {current !== "snapchat" ? (
            <Text style={p.text} testID="host-ad-preview-text">{shownText}</Text>
          ) : null}
          {props.headline && current !== "tiktok" ? (
            <Text style={p.headline}>{props.headline}</Text>
          ) : null}
          {button ? (
            <View style={p.button}>
              <Text style={p.buttonLabel} testID="host-ad-preview-button">{button}</Text>
            </View>
          ) : null}
        </View>
      </View>
      <Text style={s.faint}>
        A guide to how it may look. Each app shows it in its own way.
      </Text>
    </View>
  );
}

export function HostAdUtmTags(props: {
  apps: readonly string[];
  adName: string;
}): React.ReactElement | null {
  const [open, setOpen] = useState(false);
  if (props.apps.length === 0) return null;
  return (
    <View style={s.block} testID="host-ad-utm">
      <Pressable
        style={s.linkButton}
        onPress={() => setOpen((value) => !value)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel="Tracking tags on your link"
        testID="host-ad-utm-toggle"
      >
        <Text style={s.linkLabel}>Tracking tags on your link</Text>
      </Pressable>
      {open ? (
        <>
          <Text style={s.helper}>
            Every app adds these to your page link, so you can see results in
            your own tools too. They are set for you.
          </Text>
          {hostAdUtmLines(props.apps, props.adName).map((line) => (
            <Text key={line} style={s.faint} selectable>
              {line}
            </Text>
          ))}
        </>
      ) : null}
    </View>
  );
}
