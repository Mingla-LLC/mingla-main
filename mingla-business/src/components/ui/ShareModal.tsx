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

import React, { Suspense, useCallback } from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  type LayoutChangeEvent,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
// ORCH-1083: the QR renderer (react-native-qrcode-svg, ~644 KB) is deferred out
// of the initial web bundle. It loads only when the share modal opens. DO NOT
// re-add a static `import QRCode from "react-native-qrcode-svg"` — that pulls the
// SVG-QR code back into the boot path (breaks the mobile boot budget). See SPEC §C-3.
const QRCode = React.lazy(() => import("react-native-qrcode-svg"));

const QR_SIZE = 160;

import {
  accent,
  glass,
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import type { ShareEntityKind, ShareFactsV1 } from "@mingla/sharing";
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
  contentKind?: ShareEntityKind;
}

interface PlatformButton {
  id: "twitter" | "whatsapp" | "email" | "sms";
  label: string;
  icon: IconName;
}

type PreparedBusinessShare = { shortCode: string; version: number; facts: ShareFactsV1; url: string; message: string; title: string; s4Url: string | null };
type ShareFlowState = "idle" | "validating" | "creating" | "reusing" | "ready" | "opening" | "returned" | "error";
const prepareContentShareOnDemand = async (
  url: string,
  channel: string,
  contentKind?: ShareEntityKind,
): Promise<PreparedBusinessShare> => {
  const { prepareBusinessContentShare } = await import("../../services/contentShareAdapter");
  return prepareBusinessContentShare(url, channel, contentKind);
};
const messageForContentShareOnDemand = async (
  prepared: PreparedBusinessShare,
  channel: string,
): Promise<PreparedBusinessShare> => {
  const { messageForPreparedBusinessShare } = await import("../../services/contentShareAdapter");
  return messageForPreparedBusinessShare(prepared, channel);
};
const trackShareEvent=(event:"share_sheet_opened"|"share_link_ready"|"share_sheet_returned"|"share_link_opened"|"share_failure",properties:Record<string,string|number|boolean>):void=>{
  void import("../../services/contentShareAdapter").then(({trackBusinessShareEvent})=>trackBusinessShareEvent(event,properties)).catch(()=>undefined);
};

const PLATFORM_BUTTONS: readonly PlatformButton[] = [
  {
    id: "twitter",
    label: "Twitter",
    icon: "share",
  },
  {
    id: "whatsapp",
    label: "WhatsApp",
    icon: "share",
  },
  {
    id: "email",
    label: "Email",
    icon: "share",
  },
  {
    id: "sms",
    label: "SMS",
    icon: "share",
  },
];

export const ShareModal: React.FC<ShareModalProps> = ({
  visible,
  onClose,
  url,
  title,
  description,
  contentKind,
}) => {
  const [toast, setToast] = React.useState<{
    visible: boolean;
    message: string;
  }>({ visible: false, message: "" });
  const [isCopying, setIsCopying] = React.useState<boolean>(false);
  const [isSharing, setIsSharing] = React.useState<boolean>(false);
  const [shareState, setShareState] = React.useState<ShareFlowState>("idle");
  const [resolvedUrl,setResolvedUrl]=React.useState(url);
  const [preparedPreview,setPreparedPreview]=React.useState<PreparedBusinessShare|null>(null);
  const preparedValueRef=React.useRef<PreparedBusinessShare|null>(null);
  const preparedPromiseRef=React.useRef<Promise<PreparedBusinessShare>|null>(null);
  const actionPromiseRef=React.useRef<Promise<void>|null>(null);
  const ensurePrepared=useCallback(async(channel='generic')=>{
    setShareState("validating");
    if(preparedValueRef.current){
      const prepared=await messageForContentShareOnDemand(preparedValueRef.current,channel);
      setShareState("ready");
      return prepared;
    }
    let promise=preparedPromiseRef.current;
    if(promise){setShareState("reusing");}
    else{
      setShareState("creating");
      promise=prepareContentShareOnDemand(url,channel,contentKind);
      preparedPromiseRef.current=promise;
      void promise.catch(()=>{preparedPromiseRef.current=null;});
    }
    try {
      const basePrepared=await promise;
      preparedValueRef.current=basePrepared;
      const prepared=await messageForContentShareOnDemand(basePrepared,channel);
      setResolvedUrl(prepared.url);
      setPreparedPreview(basePrepared);
      setShareState("ready");
      trackShareEvent("share_link_ready", { kind: basePrepared.facts.kind, version: basePrepared.version, short_code: basePrepared.shortCode, channel, producer_app: "business", producer_surface: "public_share_sheet" });
      return prepared;
    } catch (error) {
      setShareState("error");
      trackShareEvent("share_failure", { failure_type: "creation", reason: "create_failed", kind: contentKind ?? "inferred", channel, producer_app: "business", producer_surface: "public_share_sheet" });
      throw error;
    }
  },[url,contentKind]);
  React.useEffect(()=>{
    preparedValueRef.current=null;preparedPromiseRef.current=null;setPreparedPreview(null);setResolvedUrl(url);setShareState("idle");
  },[url,contentKind]);
  React.useEffect(()=>{
    if(!visible)return;
    void ensurePrepared("generic").catch(()=>undefined);
  },[visible,ensurePrepared]);

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
  const flowBusy = ["validating","creating","reusing","opening"].includes(shareState);

  const showToast = useCallback((message: string): void => {
    setToast({ visible: true, message });
  }, []);

  const dismissToast = useCallback((): void => {
    setToast((prev) => ({ ...prev, visible: false }));
  }, []);

  const runExclusiveShareAction = useCallback((work: () => Promise<void>): Promise<void> => {
    if (actionPromiseRef.current) return actionPromiseRef.current;
    const action = work().finally(() => {
      if (actionPromiseRef.current === action) actionPromiseRef.current = null;
    });
    actionPromiseRef.current = action;
    return action;
  }, []);

  const handleCopyLink = useCallback(async (): Promise<void> => {
    if (isCopying) return;
    await runExclusiveShareAction(async () => {
      setIsCopying(true);
      try {
        const {copyPublicUrl}=await import("../../utils/sharePublicUrl");
        const prepared=await ensurePrepared('copy_link');
        await copyPublicUrl(prepared.url);
        showToast("Link copied");
      } catch {
        try {
          const {copyPublicUrl}=await import("../../utils/sharePublicUrl");
          await copyPublicUrl(url);
          showToast("Original link copied");
        } catch {
          showToast("Copy failed. Check your connection and retry.");
        }
      } finally {
        setIsCopying(false);
      }
    });
  }, [ensurePrepared, isCopying, runExclusiveShareAction, showToast, url]);

  const handleNativeShare = useCallback(async (): Promise<void> => {
    if (isSharing) return;
    await runExclusiveShareAction(async () => {
      setIsSharing(true);
      let reachedOpening=false;
      try {
        const {sharePublicUrl}=await import("../../utils/sharePublicUrl");
        const prepared=await ensurePrepared('generic');
        const properties={kind:prepared.facts.kind,version:prepared.version,short_code:prepared.shortCode,channel:"generic",producer_app:"business",producer_surface:"public_share_sheet"};
        setShareState("opening");
        reachedOpening=true;
        trackShareEvent("share_sheet_opened", properties);
        await sharePublicUrl({title:prepared.title,url:prepared.url,description:prepared.message});
        setShareState("returned");
        trackShareEvent("share_sheet_returned", {...properties,outcome:"returned"});
      } catch {
        if(reachedOpening)trackShareEvent("share_failure", {failure_type:"share_open",reason:"open_failed",kind:contentKind??"inferred",channel:"generic",producer_app:"business",producer_surface:"public_share_sheet"});
        try {
          const {sharePublicUrl}=await import("../../utils/sharePublicUrl");
          trackShareEvent("share_sheet_opened", {kind:contentKind??"inferred",channel:"generic",producer_app:"business",producer_surface:"public_share_sheet",outcome:"canonical_fallback"});
          await sharePublicUrl({ title, url, description: description ?? title });
          trackShareEvent("share_sheet_returned", {kind:contentKind??"inferred",channel:"generic",producer_app:"business",producer_surface:"public_share_sheet",outcome:"returned_from_canonical_fallback"});
          showToast("Short link unavailable — original link shared");
        } catch {
          setShareState("error");
          trackShareEvent("share_failure", {failure_type:reachedOpening?"share_open":"fallback_open",reason:"open_failed",kind:contentKind??"inferred",channel:"generic",producer_app:"business",producer_surface:"public_share_sheet"});
          showToast(Platform.OS === "web" ? "Sharing is unavailable here. Copy the original link instead." : "Share failed. Copy the original link or retry.");
        }
      } finally {
        setIsSharing(false);
      }
    });
  }, [contentKind, description, ensurePrepared, isSharing, runExclusiveShareAction, showToast, title, url]);

  const handleOpenLink = useCallback((): Promise<void> => runExclusiveShareAction(async () => {
      try {
        const parsed=new URL(resolvedUrl);
        if(parsed.protocol!=="https:"||parsed.username||parsed.password)throw new Error("unsafe_share_url");
        await Linking.openURL(parsed.toString());
      } catch {
        setShareState("error");
        trackShareEvent("share_failure", { failure_type: "link_open", kind: contentKind ?? "inferred", channel: "open_link", reason: "open_failed", producer_app:"business",producer_surface:"public_share_sheet" });
        showToast("Couldn't open link.");
      }
    }), [resolvedUrl, runExclusiveShareAction, showToast, contentKind]);

  const handlePlatformPress = useCallback(
    (btn: PlatformButton): Promise<void> => runExclusiveShareAction(async () => {
      let prepared:PreparedBusinessShare|null=null;
      try{prepared=await ensurePrepared(btn.id)}catch{showToast("Preview unavailable — opening the original link.")}
      const shareUrl=prepared?.url??url;
      const shareTitle=prepared?.title??title;
      const shareMessage=prepared?.message??description??title;
      const {buildBusinessShareIntent,isAllowedBusinessShareIntent}=await import("../../services/contentShareAdapter");
      const intent = buildBusinessShareIntent(btn.id,shareUrl,shareTitle,shareMessage);
      try {
        if(!isAllowedBusinessShareIntent(intent))throw new Error("unsafe_share_intent");
        setShareState("opening");
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
        setShareState("returned");
      } catch {
        setShareState("error");
        trackShareEvent("share_failure", { failure_type:"share_open",kind:contentKind??"inferred",channel:btn.id,reason:"open_failed",producer_app:"business",producer_surface:"public_share_sheet" });
        showToast(`Couldn't open ${btn.label}.`);
      }
    }),
    [ensurePrepared, showToast, url, title, description, contentKind, runExclusiveShareAction],
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

        <View style={styles.previewWrap}>
          {preparedPreview?.s4Url ? (
            <Image source={{uri:preparedPreview.s4Url}} style={styles.portraitPreview} resizeMode="cover" accessibilityLabel={`${preparedPreview.facts.kind.replace("_"," ")}: ${preparedPreview.title}`} />
          ) : preparedPreview ? (
            <View style={styles.coverlessPreview} accessibilityLabel="No image preview available">
              <Text style={styles.coverlessKind}>{preparedPreview.facts.kind.replace("_"," ")}</Text>
              <Text style={styles.coverlessTitle}>{preparedPreview.title}</Text>
              <Text style={styles.coverlessCopy}>No image preview is available. The public link still opens the full details.</Text>
            </View>
          ) : (
            <View style={styles.portraitLoading} accessibilityLiveRegion="polite">
              <ActivityIndicator size="small" color={accent.warm} />
              <Text style={styles.statusText}>Preparing the exact 4:5 preview…</Text>
            </View>
          )}
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
            disabled={isSharing || flowBusy}
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
            disabled={isCopying || flowBusy}
          />
        </View>

        {flowBusy ? (
          <View style={styles.statusRow} accessibilityLiveRegion="polite">
            <ActivityIndicator size="small" color={accent.warm} />
            <Text style={styles.statusText}>Preparing your Mingla link…</Text>
          </View>
        ) : null}
        {shareState === "error" ? (
          <View style={styles.errorRow} accessibilityLiveRegion="polite">
            <Text style={styles.errorText}>The Mingla preview is unavailable. The original public link remains available.</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Retry Mingla preview" onPress={() => { preparedPromiseRef.current=null; void ensurePrepared("generic").catch((error: unknown) => console.warn("[ShareModal] preview retry failed:", error)); }} style={styles.retryBtn}>
              <Text style={styles.retryText}>Retry preview</Text>
            </Pressable>
          </View>
        ) : null}

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
            {resolvedUrl}
          </Text>
        </Pressable>

        {/* QR code — ORCH-1083: lazily loaded; fallback reserves the QR footprint
            so the modal does not jump when the chunk resolves. */}
        <View style={styles.qrWrap}>
          <View style={styles.qrInner}>
            <Suspense
              fallback={
                <View style={styles.qrFallback}>
                  <ActivityIndicator color="#000000" />
                </View>
              }
            >
              <QRCode
                value={resolvedUrl}
                size={QR_SIZE}
                backgroundColor="#FFFFFF"
                color="#000000"
              />
            </Suspense>
          </View>
          <Text style={styles.qrCaption}>Scan to open</Text>
        </View>

        {/* Platform deep-links */}
        <View style={styles.platformRow}>
          {PLATFORM_BUTTONS.map((btn) => (
            <Pressable
              key={btn.id}
              onPress={() => handlePlatformPress(btn)}
              disabled={flowBusy}
              accessibilityState={{ disabled: flowBusy }}
              accessibilityRole="button"
              accessibilityLabel={`Share via ${btn.label}`}
              style={({ pressed }) => [
                styles.platformBtn,
                flowBusy && styles.platformBtnDisabled,
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
  previewWrap: {
    marginBottom: spacing.md,
  },
  portraitPreview: {
    width: "100%",
    aspectRatio: 4 / 5,
    borderRadius: radiusTokens.lg,
    backgroundColor: "#111318",
  },
  portraitLoading: {
    width: "100%",
    aspectRatio: 4 / 5,
    borderRadius: radiusTokens.lg,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    padding: spacing.lg,
    backgroundColor: glass.tint.profileBase,
  },
  coverlessPreview: {
    width: "100%",
    aspectRatio: 4 / 5,
    borderRadius: radiusTokens.lg,
    justifyContent: "flex-end",
    padding: spacing.lg,
    backgroundColor: "#0C0E12",
  },
  coverlessKind: {
    color: accent.warm,
    textTransform: "capitalize",
    fontWeight: "700",
    marginBottom: spacing.xs,
  },
  coverlessTitle: {
    color: "#FFFFFF",
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: "700",
  },
  coverlessCopy: {
    color: "rgba(255,255,255,0.72)",
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    marginTop: spacing.sm,
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
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  statusText: {
    flex: 1,
    fontSize: typography.bodySm.fontSize,
    color: textTokens.secondary,
  },
  errorRow: {
    marginBottom: spacing.sm,
    padding: spacing.sm,
    borderRadius: radiusTokens.md,
    backgroundColor: glass.tint.profileBase,
  },
  errorText: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
  },
  retryBtn: {
    alignSelf: "flex-start",
    marginTop: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radiusTokens.full,
    backgroundColor: accent.warm,
  },
  retryText: {
    color: "#111318",
    fontWeight: "700",
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
  // ORCH-1083: reserves the exact QR footprint (QR_SIZE) so the Suspense fallback
  // does not cause a layout jump when the lazy QR chunk resolves.
  qrFallback: {
    width: QR_SIZE,
    height: QR_SIZE,
    alignItems: "center",
    justifyContent: "center",
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
  platformBtnDisabled: {
    opacity: 0.45,
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
