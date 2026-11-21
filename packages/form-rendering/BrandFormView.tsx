/**
 * #4514 — the brand form view every guest surface mounts (link page, on-page
 * sheet, pass and after-purchase forms, the builder preview), and the brand
 * header it opens with (BUILD CONTRACT v2 §5.1, §5.2; C4; C11).
 *
 * Props-only: the host app injects its tokens, Icon, web date input and, for
 * the header, its cover component (`primitives.BrandCover`). No useAuth: the
 * buyer-web link page is anonymous-tolerant.
 *
 * - "Show only if" is decided here (./brandForm.ts): a hidden question is not
 *   drawn and its answer is dropped. A revealed question fades and slides in
 *   (opacity 0→1, translateY 8→0, 220 ms; fade only with reduced motion); a
 *   hidden one leaves without animation.
 * - Door questions carry "Shown to door staff" under the label; when the form
 *   lets door staff open full answers, one line sits at the top: "The host and
 *   their door staff can see your answers."
 */

import React, { useEffect, useMemo, useRef } from "react";
import {
  AccessibilityInfo,
  Animated,
  Image,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  ANSWERS_SEEN_LINE,
  type BrandHeaderData,
  type BrandAnswers,
  type BrandFormDefinitionShape,
  brandInitial,
  fromRendererAnswers,
  missingRequiredIds,
  rendererSchema,
  toRendererAnswers,
} from "./brandFormRules";
import { IntakeFormRenderer } from "./QuestionRenderers";
import type { FormBrandCoverProps, FormRenderingPrimitives, RenderFormFileUpload } from "./types";

// ---------------------------------------------------------------------------
// Brand header
// ---------------------------------------------------------------------------

export type BrandCoverProps = FormBrandCoverProps;

export interface BrandHeaderProps {
  brand: BrandHeaderData;
  primitives: FormRenderingPrimitives;
  /** The 60 px strip used inside a flow (RSVP step, checkout Questions, cards). */
  compact?: boolean;
  /** A line under the name, compact only ("Questions from {brand}"). */
  caption?: string;
  testID?: string;
}

export const BrandHeader: React.FC<BrandHeaderProps> = ({
  brand,
  primitives,
  compact = false,
  caption,
  testID = "brand-form-header",
}) => {
  const logoSize = compact ? 36 : 56;
  const height = compact ? 60 : 132;
  const ring = brand.accent ?? primitives.tokens.color.accent;
  const Cover = primitives.BrandCover;
  return (
    <View
      style={[headerStyles.root, { height }]}
      testID={testID}
      accessibilityRole="header"
      accessibilityLabel={brand.displayName.length > 0 ? `From ${brand.displayName}` : "From the host"}
    >
      {Cover !== undefined ? (
        <Cover uri={brand.coverUrl} hue={brand.coverHue} accent={brand.accent} height={height} />
      ) : brand.coverUrl !== null ? (
        <Image
          source={{ uri: brand.coverUrl }}
          style={[StyleSheet.absoluteFill, headerStyles.coverImage]}
          resizeMode="cover"
          accessibilityIgnoresInvertColors
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: ring }]} testID={`${testID}-accent`} />
      )}
      <View style={headerStyles.fade} pointerEvents="none" />
      <View style={headerStyles.identity}>
        <View
          style={[
            headerStyles.ring,
            { width: logoSize, height: logoSize, borderRadius: logoSize / 2, borderColor: ring },
          ]}
          testID={`${testID}-logo`}
        >
          {brand.photo !== null ? (
            <Image
              source={{ uri: brand.photo }}
              style={[headerStyles.logo, { borderRadius: (logoSize - 6) / 2 }]}
              accessibilityIgnoresInvertColors
            />
          ) : (
            <Text style={[headerStyles.initial, compact && headerStyles.initialCompact]}>
              {brandInitial(brand.displayName)}
            </Text>
          )}
        </View>
        <View style={headerStyles.names}>
          <Text
            style={[headerStyles.name, compact ? headerStyles.nameCompact : headerStyles.nameFull]}
            numberOfLines={1}
          >
            {brand.displayName.length > 0 ? brand.displayName : "Your brand"}
          </Text>
          {compact && caption !== undefined ? (
            <Text style={headerStyles.caption} numberOfLines={1}>
              {caption}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
};

const headerStyles = StyleSheet.create({
  root: { width: "100%", overflow: "hidden", justifyContent: "flex-end" },
  coverImage: { width: "100%", height: "100%" },
  fade: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.38)" },
  identity: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  ring: {
    borderWidth: 3,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.45)",
    overflow: "hidden",
  },
  logo: { width: "100%", height: "100%" },
  initial: { fontSize: 22, fontWeight: "700", color: "#FFFFFF" },
  initialCompact: { fontSize: 15 },
  names: { flex: 1, minWidth: 0 },
  name: {
    color: "#FFFFFF",
    fontWeight: "700",
    textShadowColor: "rgba(0,0,0,0.5)",
    textShadowRadius: 6,
  },
  nameFull: { fontSize: 20, lineHeight: 26 },
  nameCompact: { fontSize: 15, lineHeight: 20 },
  caption: { fontSize: 12, lineHeight: 16, color: "rgba(255,255,255,0.86)" },
});

// ---------------------------------------------------------------------------
// Brand form renderer
// ---------------------------------------------------------------------------

/** Fades and slides one newly revealed question in (fade only with reduced motion). */
const Reveal: React.FC<{ animate: boolean; reduceMotion: boolean; children: React.ReactNode }> = ({
  animate,
  reduceMotion,
  children,
}) => {
  const progress = useRef(new Animated.Value(animate ? 0 : 1)).current;
  useEffect(() => {
    if (!animate) return;
    Animated.timing(progress, { toValue: 1, duration: 220, useNativeDriver: false }).start();
  }, [animate, progress]);
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [8, 0] });
  return (
    <Animated.View
      style={{ opacity: progress, transform: reduceMotion ? [] : [{ translateY }] }}
    >
      {children}
    </Animated.View>
  );
};

export interface BrandFormRendererProps {
  definition: BrandFormDefinitionShape;
  /** Stored answers: option ids for choices, text for everything else. */
  answers: BrandAnswers;
  /** Called with the visible answers only (a hidden question's answer is dropped). */
  onAnswersChange: (next: BrandAnswers) => void;
  primitives: FormRenderingPrimitives;
  /** The form lets door staff open full answers: one line at the top. */
  doorFullAnswers?: boolean;
  validationErrors?: Record<string, string>;
  disabled?: boolean;
  renderFileUpload?: RenderFormFileUpload;
  /** The visible required questions still unanswered, after every change (ids, in order). */
  onMissingChange?: (missingIds: string[]) => void;
  testID?: string;
}

export const BrandFormRenderer: React.FC<BrandFormRendererProps> = ({
  definition,
  answers,
  onAnswersChange,
  primitives,
  doorFullAnswers = false,
  validationErrors,
  disabled = false,
  renderFileUpload,
  onMissingChange,
  testID = "brand-form-renderer",
}) => {
  const schema = useMemo(() => rendererSchema(definition, answers), [definition, answers]);
  const missingKey = missingRequiredIds(definition, answers).join(",");
  useEffect(() => {
    onMissingChange?.(missingKey.length > 0 ? missingKey.split(",") : []);
  }, [missingKey, onMissingChange]);
  const values = useMemo(() => toRendererAnswers(definition, answers), [definition, answers]);
  const [reduceMotion, setReduceMotion] = React.useState(false);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => {
        if (live) setReduceMotion(on);
      })
      .catch(() => {
        if (live) setReduceMotion(false);
      });
    return () => {
      live = false;
    };
  }, []);
  // Questions shown on the first draw never animate; later reveals do.
  const seen = useRef<Set<string> | null>(null);
  if (seen.current === null) seen.current = new Set(schema.questions.map((q) => q.id));
  const revealed = schema.questions.filter((q) => !seen.current?.has(q.id)).map((q) => q.id);
  useEffect(() => {
    // Forget questions that left (they leave without animation and animate if they return).
    seen.current = new Set(schema.questions.map((q) => q.id));
  }, [schema.questions]);

  const color = primitives.tokens.color;
  return (
    <View testID={testID} accessibilityLiveRegion="polite">
      {doorFullAnswers ? (
        <Text style={[formStyles.seen, { color: color.text3 }]} testID={`${testID}-seen`}>
          {ANSWERS_SEEN_LINE}
        </Text>
      ) : null}
      <View style={{ gap: primitives.tokens.space[4] }}>
      {schema.questions.map((q) => (
        <Reveal key={q.id} animate={revealed.includes(q.id)} reduceMotion={reduceMotion}>
          <IntakeFormRenderer
            schema={{ questions: [q] }}
            answers={values}
            onAnswersChange={(next) => onAnswersChange(fromRendererAnswers(definition, { ...values, ...next }))}
            primitives={primitives}
            validationErrors={validationErrors}
            disabled={disabled}
            renderFileUpload={renderFileUpload}
          />
        </Reveal>
      ))}
      </View>
    </View>
  );
};

const formStyles = StyleSheet.create({
  seen: { fontSize: 13, lineHeight: 18, marginBottom: 12 },
});
