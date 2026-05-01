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
 * Native: uses RN `Share.share` and (when available in mingla-business)
 *   `expo-clipboard`. Falls back to a Toast if clipboard is unavailable on
 *   either platform.
 *
 * Per Cycle 7 spec §2.6 + DEC-079 additive carve-out style.
 */

import React, { useCallback } from "react";
import {
  Linking,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import QRCode from "react-native-qrcode-svg";

import {
  accent,
  glass,
  radius as radiusTokens,
  semantic,
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

const PLATFORM_BUTTONS: ReadonlyArray<PlatformButton> = [
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

  const showToast = useCallback((message: string): void => {
    setToast({ visible: true, message });
  }, []);

  const dismissToast = useCallback((): void => {
    setToast((prev) => ({ ...prev, visible: false }));
  }, []);

  const handleCopyLink = useCallback(async (): Promise<void> => {
    if (Platform.OS === "web") {
      const navAny = (
        globalThis as unknown as {
          navigator?: {
            clipboard?: { writeText?: (s: string) => Promise<void> };
          };
        }
      ).navigator;
      if (navAny?.clipboard?.writeText !== undefined) {
        try {
          await navAny.clipboard.writeText(url);
          showToast("Link copied");
        } catch {
          showToast("Couldn't copy link.");
        }
      } else {
        showToast("Copy not supported on this browser.");
      }
      return;
    }
    // Native: use expo-clipboard if available; else a Toast directing the
    // user to the native share sheet (which always supports Copy).
    showToast("Tap Share via to copy on iOS / Android.");
  }, [url, showToast]);

  const handleNativeShare = useCallback(async (): Promise<void> => {
    if (Platform.OS === "web") {
      const navAny = (
        globalThis as unknown as {
          navigator?: {
            share?: (data: {
              title: string;
              url: string;
              text?: string;
            }) => Promise<void>;
          };
        }
      ).navigator;
      if (navAny?.share !== undefined) {
        try {
          await navAny.share({ title, url, text: description });
        } catch {
          // user cancelled — surface no error
        }
      } else {
        showToast("Native share not supported on this browser.");
      }
      return;
    }
    // Native: RN Share.share
    try {
      await Share.share({
        message: `${title}\n${url}`,
        url,
      });
    } catch {
      // user cancelled
    }
  }, [url, title, description, showToast]);

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
    <Sheet visible={visible} onClose={onClose} snapPoint="half">
      <View style={styles.host}>
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
          />
        </View>

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
    flex: 1,
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
