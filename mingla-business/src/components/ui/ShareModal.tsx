/**
 * ShareModal — kit primitive for sharing a URL.
 *
 * Contains: copy link, native share, QR code, platform-specific deep-links
 * (Twitter / WhatsApp / Email / SMS).
 *
 * Reusable across surfaces — pass `{url, title, description}` props. Mounts
 * on PublicEventPage (Cycle 7) and PublicBrandPage (Cycle 7). Future
 * surfaces (e.g., a "share my booking" flow in Cycle 8) can mount this
 * primitive without changes.
 *
 * Web: uses `navigator.share` (when available) and `navigator.clipboard.writeText`.
 * Native: uses RN `Share.share` and `expo-clipboard`.
 *
 * Per Cycle 7 spec §2.6 + DEC-079 additive carve-out style.
 */

import React, { useCallback } from "react";
import {
  Linking,
  type LayoutChangeEvent,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import QRCode from "react-native-qrcode-svg";

import {
  accent,
  glass,
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import {
  emailIntent,
  smsIntent,
  twitterIntent,
  whatsappIntent,
} from "../../utils/shareIntents";
import { copyPublicUrl, sharePublicUrl } from "../../utils/sharePublicUrl";

import { Button } from "./Button";
import { Icon, type IconName } from "./Icon";
import { Sheet } from "./Sheet";
import { Toast } from "./Toast";

export interface ShareModalProps {
  visible: boolean;
  onClose: () => void;
  url: string;
  title: string;
  description?: string;
}

interface PlatformButton {
  id: "twitter" | "whatsapp" | "email" | "sms";
  label: string;
  icon: IconName;
  buildUrl: (url: string, title: string, description?: string) => string;
}

const PLATFORM_BUTTONS: readonly PlatformButton[] = [
  {
    id: "twitter",
    label: "Twitter",
    icon: "share",
    buildUrl: (url, title): string => twitterIntent(url, title),
  },
  {
    id: "whatsapp",
    label: "WhatsApp",
    icon: "share",
    buildUrl: (url, title): string => whatsappIntent(url, title),
  },
  {
    id: "email",
    label: "Email",
    icon: "share",
    buildUrl: (url, title, description): string =>
      emailIntent(url, title, description),
  },
  {
    id: "sms",
    label: "SMS",
    icon: "share",
    buildUrl: (url, title): string => smsIntent(url, title),
  },
];

export const ShareModal: React.FC<ShareModalProps> = ({
  visible,
  onClose,
  url,
  title,
  description,
}) => {
  const [toast, setToast] = React.useState<{
    visible: boolean;
    message: string;
  }>({ visible: false, message: "" });
  const [isCopying, setIsCopying] = React.useState<boolean>(false);
  const [isSharing, setIsSharing] = React.useState<boolean>(false);

  // ORCH-0964: size the sheet to its actual content so the QR + platform row
  // are never clipped. The fixed "half" snap was shorter than this content on
  // most phones, cutting off the bottom (QR). Measure the content once, then
  // pin the panel to fit it (+ Sheet drag handle + bottom safe-area). The Sheet
  // clamps to 95% of the viewport, so very small screens still cap gracefully.
  const insets = useSafeAreaInsets();
  const [contentHeight, setContentHeight] = React.useState<number | null>(null);
  const onContentLayout = useCallback((e: LayoutChangeEvent): void => {
    const h = e.nativeEvent.layout.height;
    if (h > 0) setContentHeight((prev) => (prev === null || Math.abs(prev - h) > 1 ? h : prev));
  }, []);
  const SHEET_HANDLE_AND_PADDING = 44; // drag handle + body top padding
  const sheetSnapPoint =
    contentHeight !== null
      ? contentHeight + SHEET_HANDLE_AND_PADDING + insets.bottom
      : "half";

  const showToast = useCallback((message: string): void => {
    setToast({ visible: true, message });
  }, []);

  const dismissToast = useCallback((): void => {
    setToast((prev) => ({ ...prev, visible: false }));
  }, []);

  const handleCopyLink = useCallback(async (): Promise<void> => {
    if (isCopying) return;
    setIsCopying(true);
    try {
      await copyPublicUrl(url);
      showToast("Link copied");
    } catch {
      showToast("Copy failed. Try Share via instead.");
    } finally {
      setIsCopying(false);
    }
  }, [isCopying, url, showToast]);

  const handleNativeShare = useCallback(async (): Promise<void> => {
    if (isSharing) return;
    setIsSharing(true);
    try {
      await sharePublicUrl({
        title,
        url,
        description,
      });
    } catch {
      if (Platform.OS === "web") {
        showToast("Native share not supported on this browser.");
      }
    } finally {
      setIsSharing(false);
    }
  }, [isSharing, url, title, description, showToast]);

  const handleOpenLink = useCallback(async (): Promise<void> => {
    try {
      await Linking.openURL(url);
    } catch {
      showToast("Couldn't open link.");
    }
  }, [url, showToast]);

  const handlePlatformPress = useCallback(
    async (btn: PlatformButton): Promise<void> => {
      const intent = btn.buildUrl(url, title, description);
      try {
        if (Platform.OS === "web") {
          const win = (
            globalThis as unknown as {
              window?: { open?: (u: string, t: string) => unknown };
            }
          ).window;
          if (win?.open !== undefined) {
            win.open(intent, "_blank");
          } else {
            await Linking.openURL(intent);
          }
        } else {
          await Linking.openURL(intent);
        }
      } catch {
        showToast(`Couldn't open ${btn.label}.`);
      }
    },
    [url, title, description, showToast],
  );

  return (
    <Sheet visible={visible} onClose={onClose} snapPoint={sheetSnapPoint}>
      <View style={styles.host} onLayout={onContentLayout}>
        {/* Title bar */}
        <View style={styles.titleBar}>
          <Text style={styles.title}>Share</Text>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
            style={styles.closeBtn}
            hitSlop={8}
          >
            <Icon name="close" size={20} color={textTokens.secondary} />
          </Pressable>
        </View>

        {/* Action buttons */}
        <View style={styles.actionsRow}>
          <Button
            label="Copy link"
            variant="primary"
            size="md"
            onPress={handleCopyLink}
            fullWidth
            leadingIcon="link"
            loading={isCopying}
            disabled={isSharing}
          />
        </View>
        <View style={styles.actionsRow}>
          <Button
            label="Share via…"
            variant="secondary"
            size="md"
            onPress={handleNativeShare}
            fullWidth
            leadingIcon="share"
            loading={isSharing}
            disabled={isCopying}
          />
        </View>

        <Pressable
          onPress={handleOpenLink}
          accessibilityRole="link"
          accessibilityLabel="Open share link"
          style={({ pressed }) => [
            styles.urlBox,
            pressed && styles.urlBoxPressed,
          ]}
        >
          <Text style={styles.urlText} numberOfLines={2}>
            {url}
          </Text>
        </Pressable>

        {/* QR code */}
        <View style={styles.qrWrap}>
          <View style={styles.qrInner}>
            <QRCode
              value={url}
              size={160}
              backgroundColor="#FFFFFF"
              color="#000000"
            />
          </View>
          <Text style={styles.qrCaption}>Scan to open</Text>
        </View>

        {/* Platform deep-links */}
        <View style={styles.platformRow}>
          {PLATFORM_BUTTONS.map((btn) => (
            <Pressable
              key={btn.id}
              onPress={() => handlePlatformPress(btn)}
              accessibilityRole="button"
              accessibilityLabel={`Share via ${btn.label}`}
              style={({ pressed }) => [
                styles.platformBtn,
                pressed && styles.platformBtnPressed,
              ]}
            >
              <View style={styles.platformIconWrap}>
                <Icon name={btn.icon} size={20} color={textTokens.primary} />
              </View>
              <Text style={styles.platformLabel}>{btn.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <Toast
        visible={toast.visible}
        kind="info"
        message={toast.message}
        onDismiss={dismissToast}
      />
    </Sheet>
  );
};

const styles = StyleSheet.create({
  host: {
    // No flex:1 — the host sizes to its content so onLayout reports the real
    // content height (used to fit the sheet, ORCH-0964). flex:1 would report
    // the stretched panel height and defeat the measurement.
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
  },
  titleBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.md,
  },
  title: {
    fontSize: typography.h3.fontSize,
    fontWeight: "600",
    color: textTokens.primary,
  },
  closeBtn: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radiusTokens.full,
    backgroundColor: glass.tint.profileBase,
  },
  actionsRow: {
    marginBottom: spacing.sm,
  },
  urlBox: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  urlBoxPressed: {
    opacity: 0.7,
  },
  urlText: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight * 1.35,
    color: accent.warm,
  },
  qrWrap: {
    alignItems: "center",
    marginVertical: spacing.md,
  },
  qrInner: {
    padding: spacing.sm,
    backgroundColor: "#FFFFFF",
    borderRadius: radiusTokens.lg,
  },
  qrCaption: {
    marginTop: spacing.xs,
    fontSize: typography.bodySm.fontSize,
    color: textTokens.tertiary,
  },
  platformRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: spacing.sm,
  },
  platformBtn: {
    flex: 1,
    alignItems: "center",
    paddingVertical: spacing.sm,
    marginHorizontal: 4,
    borderRadius: radiusTokens.lg,
    backgroundColor: glass.tint.profileBase,
  },
  platformBtnPressed: {
    opacity: 0.6,
  },
  platformIconWrap: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.xs,
    borderRadius: radiusTokens.full,
    backgroundColor: "rgba(255, 255, 255, 0.10)",
  },
  platformLabel: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.secondary,
  },
});

export default ShareModal;
