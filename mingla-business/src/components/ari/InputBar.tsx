/**
 * ORCH-0821 — Ari InputBar
 * Keyboard-aware composer at the bottom of the chat. Mirrors the Cycle 3
 * wizard pattern: Keyboard listener + dynamic paddingBottom managed by the
 * parent screen (this component is keyboard-aware via the parent's KAV).
 *
 * The PARENT screen wraps this in a KeyboardAvoidingView OR pads the bottom
 * by the keyboard height — see AriChatScreen.
 *
 * ORCH-1057 — Send button redesign ("Ember Send", design spec A1):
 * lucide ArrowUp on a warm flame→ember radial circle that rhymes with the
 * Ari orb. iOS-only ember glow; Android opaque + overflow:hidden + no
 * elevation per ANDROID_GLASS_USES_OPAQUE_FALLBACK. Send-moment scale spring
 * + glow pulse gated behind useReducedMotion().
 *
 * ORCH-1101 — composer + send overhaul (fixes the two desktop-web defects):
 *   Bug B (send "blob"): the old react-native-svg radial-gradient circle block
 *   stacked a gradient circle BEHIND the glyph; react-native-web mis-composited
 *   it into an amorphous orange blob (gradient-id collisions made it worse).
 *   It is DELETED. The send button is now a flat ember disc
 *   (ariPalette.userBubble) with a single lucide ArrowUp as its only child —
 *   renders identically on iOS/Android/web (single-path SVG, no gradient, no
 *   sibling). The Animated.View (scale + iOS shadowOpacity glow) + the send
 *   micro-interaction + reduced-motion gate are kept verbatim — they were
 *   never the blob.
 *   Bug A (web bottom gap): the input is explicitly one line tall on every
 *   surface — fontSize 14 / lineHeight 19 / paddingVertical 6 / minHeight 30,
 *   host minHeight 48 — and on react-native-web the <textarea> gets
 *   rows={1} + resize:'none' + height:'auto' so the browser's intrinsic
 *   multi-row height can't open dead space below the single line. (The
 *   AriChatScreen paddingBottom phantom-80px half of Bug A is fixed there.)
 */

import React, { useState } from "react";
import { Platform, Pressable, StyleSheet, TextInput, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { ArrowUp } from "lucide-react-native";
import { Plus } from "lucide-react-native";
import { isAriSendReady } from "../../services/agentReliability";

import { ariThread, color, materials, radius, size, space } from "../../constants/designSystem";
import { FIELD_FOCUS_BOX_PROPS } from "../ui/fieldFocusCss";

// Web-only TextInput props: on react-native-web a multiline TextInput renders
// as a <textarea> whose browser-default rows (~2) + larger default line-height
// open dead space below the single text line. Force a one-line box: explicit
// lineHeight, rows={1}, height:'auto', no manual resize. Native ignores these.
const WEB_INPUT_PROPS =
  Platform.OS === "web"
    ? ({
        rows: 1,
        // react-native-web forwards unknown style keys to the DOM node.
        style: { height: "auto", resize: "none", overflowY: "auto" },
      } as unknown as Record<string, unknown>)
    : {};

export interface InputBarProps {
  onSend: (text: string) => void | boolean | Promise<void | boolean>;
  disabled?: boolean;
  sendDisabled?: boolean;
  attachDisabled?: boolean;
  placeholder?: string;
  onAttach?: () => void;
  value?: string;
  onChangeText?: (text: string) => void;
  hasReadyAttachments?: boolean;
  inputRef?: React.RefObject<React.ElementRef<typeof TextInput> | null>;
}

export const InputBar: React.FC<InputBarProps> = ({
  onSend,
  disabled = false,
  sendDisabled = false,
  attachDisabled = false,
  placeholder = "Ask Ari…",
  onAttach,
  value,
  onChangeText,
  hasReadyAttachments = false,
  inputRef,
}) => {
  const [internalText, setInternalText] = useState("");
  const text = value ?? internalText;
  const setText = onChangeText ?? setInternalText;
  const reduceMotion = useReducedMotion();

  const canSend = isAriSendReady(text, hasReadyAttachments, disabled, sendDisabled);

  // Send-moment micro-interaction (A1 "ember flicker + lift").
  const sendScale = useSharedValue(1);
  const glowOpacity = useSharedValue(0.4);

  // Scale transform on the circle + iOS-only glow pulse via shadowOpacity
  // (Android ignores shadow* — no-op there, per the opaque-glass policy).
  const sendAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: sendScale.value }],
    ...(Platform.OS === "ios" ? { shadowOpacity: glowOpacity.value } : {}),
  }));

  const handleSend = (): void => {
    if (!canSend) return;
    const t = text.trim();

    if (reduceMotion) {
      // Reduced motion: simple dim → restore, no spring/flicker.
      sendScale.value = withSequence(
        withTiming(0.92, { duration: 80 }),
        withTiming(1, { duration: 80 }),
      );
    } else {
      // Press-down → ember flicker + lift spring.
      sendScale.value = withSequence(
        withTiming(0.92, { duration: 80 }),
        withSpring(1, { damping: 14, stiffness: 220, mass: 0.7 }),
      );
      if (Platform.OS === "ios") {
        glowOpacity.value = withSequence(
          withTiming(0.7, { duration: 100 }),
          withTiming(0.4, { duration: 100 }),
        );
      }
    }

    // #3429 P0 follow-up — ORCH-1296 class; see ariPrepareImage.native.ts.
    void import("expo-haptics").then((Haptics) =>
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    ).catch(() => undefined);

    const accepted = onSend(t);
    // Transfer ownership synchronously. Once Send is accepted locally the one
    // outgoing row owns this draft; transport completion never controls the
    // composer value.
    if (accepted !== false) setText("");
  };

  return (
    // #4420 round 3 (6, 24): floating composer. The field is a pill with the
    // attach control inside it; send is an icon-only Paper circle beside it,
    // dimmed until there is text. No bar behind either.
    <View style={styles.host}>
      <View style={styles.field} {...FIELD_FOCUS_BOX_PROPS}>
      {onAttach ? (
        <Pressable
          onPress={onAttach}
          disabled={disabled || attachDisabled}
          style={({ pressed }) => [styles.attachBtn, (disabled || attachDisabled) && styles.btnDisabled, pressed && !disabled && !attachDisabled && styles.btnPressed]}
          accessibilityRole="button"
          accessibilityLabel="Attach images or documents"
          accessibilityState={{ disabled: disabled || attachDisabled }}
          hitSlop={6}
        >
          <Plus size={22} color={color.text2} strokeWidth={2.25} />
        </Pressable>
      ) : null}
      <TextInput
        ref={inputRef}
        value={text}
        onChangeText={setText}
        placeholder={placeholder}
        placeholderTextColor={color.text3}
        editable={!disabled}
        multiline
        style={[styles.input, Platform.OS === "web" && (WEB_INPUT_PROPS.style as object)]}
        accessibilityLabel="Ask Ari"
        maxLength={4096}
        {...(Platform.OS === "web" ? { rows: WEB_INPUT_PROPS.rows } : {})}
        onKeyPress={(event) => {
          if (Platform.OS !== "web") return;
          const native = event.nativeEvent as unknown as {
            key?: string;
            shiftKey?: boolean;
            isComposing?: boolean;
          };
          if (native.key === "Enter" && !native.shiftKey && !native.isComposing) {
            (event as unknown as { preventDefault?: () => void }).preventDefault?.();
            handleSend();
          }
        }}
      />
      </View>
      <Pressable
        onPress={handleSend}
        disabled={!canSend}
        style={({ pressed }) => [
          pressed && canSend && reduceMotion && styles.btnPressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel="Send message to Ari"
        accessibilityState={{ disabled: !canSend }}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      >
        <Animated.View
          style={[styles.sendBtn, !canSend && styles.sendIdle, sendAnimStyle]}
        >
          {/* ORCH-1101: flat ember disc + a single lucide ArrowUp as the ONLY
              child (no SVG gradient, no two-layer composition) — renders
              identically on iOS/Android/web. lucide-react-native is a
              single-path stroke glyph; with no gradient sibling it never blobs. */}
          <ArrowUp size={20} color={canSend ? color.ink : color.text4} strokeWidth={2.75} />
        </Animated.View>
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: space[2],
  },
  field: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-end",
    // ORCH-1101 REWORK Bug #4: OPAQUE fill on every platform so the empty-state
    // hint and the thread never bleed through the field (#4420: the solid sheet
    // material, not a translucent wash).
    backgroundColor: materials.sheet.solidFill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.lineStrong,
    borderRadius: radius.xl,
    overflow: "hidden",
    paddingHorizontal: ariThread.composerPadH,
    // Web has no soft keyboard + tighter chrome → 6; native keeps 8.
    paddingVertical: Platform.OS === "web" ? 6 : ariThread.composerPadV,
    gap: space[2],
    minHeight: ariThread.composerMinH, // #3429 premium composer: 60px minimum
  },
  input: {
    flex: 1,
    fontSize: ariThread.bodyFont, // 14 (was body 16 → align to thread)
    lineHeight: ariThread.bodyLine, // 19 (explicit — overrides the web textarea's taller default)
    color: color.text1,
    paddingVertical: ariThread.inputPadV, // 6 (was 8)
    minHeight: ariThread.inputMinH, // 30 — caps the empty box to one line
    maxHeight: 120,
  },
  sendBtn: {
    width: size.btn.phone,
    height: size.btn.phone,
    borderRadius: radius.full,
    // #4420: send is the Paper control (ink arrow), dimmed to card2 when idle.
    backgroundColor: color.paper,
    alignItems: "center",
    justifyContent: "center",
    // Android: no elevation (hard rectangle through round fills); clip the fill.
    overflow: "hidden",
    marginBottom: (ariThread.composerMinH - size.btn.phone) / 2,
  },
  sendIdle: {
    backgroundColor: color.card2,
  },
  attachBtn: {
    width: ariThread.controlSize,
    height: ariThread.controlSize,
    borderRadius: ariThread.controlSize / 2,
    backgroundColor: color.transparent,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  btnDisabled: {
    opacity: 0.4,
  },
  btnPressed: {
    opacity: 0.8,
  },
});

export default InputBar;
