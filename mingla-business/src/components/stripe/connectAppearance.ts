/**
 * #4420 — Graphite appearance for every Stripe Connect embedded component
 * (web Account Onboarding / Account Management / Tax registrations, the
 * partner variants, and the native onboarding SDK).
 *
 * Before this, each init passed only `colorPrimary`, so Stripe drew its
 * default white surface inside our dark host app. This is the single place
 * that maps our design tokens onto Stripe's appearance variables
 * (https://docs.stripe.com/connect/embedded-appearance-options).
 *
 * Client appearance only: no account, session, key or payout logic lives
 * here. Stripe wants opaque colours, so only solid tokens are used (the
 * status tints use their opaque `solidTint` composites).
 */
import { color, radius } from "../../constants/designSystem";

export const CONNECT_FONT_FAMILY =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

const px = (n: number): string => `${n}px`;

export const MINGLA_CONNECT_APPEARANCE = {
  overlays: "dialog",
  variables: {
    fontFamily: CONNECT_FONT_FAMILY,
    borderRadius: px(radius.sm),
    buttonBorderRadius: px(radius.full),
    formBorderRadius: px(radius.sm),
    overlayBorderRadius: px(radius.xl),
    badgeBorderRadius: px(radius.full),

    colorBackground: color.canvas,
    offsetBackgroundColor: color.card,
    formBackgroundColor: color.card2,
    colorText: color.text1,
    colorSecondaryText: color.text2,
    formPlaceholderTextColor: color.text3,
    colorBorder: color.card3,
    formHighlightColorBorder: color.text2,
    // Focus and selection read white, like our own focus ring. Orange stays
    // for progress / steppers only (spec §3.2).
    colorPrimary: color.focus,
    formAccentColor: color.focus,
    actionPrimaryColorText: color.text1,
    actionSecondaryColorText: color.text2,
    colorDanger: color.errorText,

    // Primary button = Paper on ink, secondary = card control.
    buttonPrimaryColorBackground: color.paper,
    buttonPrimaryColorBorder: color.paper,
    buttonPrimaryColorText: color.ink,
    buttonSecondaryColorBackground: color.card2,
    buttonSecondaryColorBorder: color.card3,
    buttonSecondaryColorText: color.text1,
    buttonDangerColorBackground: color.danger,
    buttonDangerColorBorder: color.danger,
    buttonDangerColorText: color.onDanger,

    badgeNeutralColorBackground: color.card2,
    badgeNeutralColorText: color.text2,
    badgeNeutralColorBorder: color.card3,
    badgeSuccessColorBackground: color.solidTint.success,
    badgeSuccessColorText: color.successText,
    badgeSuccessColorBorder: color.solidTint.success,
    badgeWarningColorBackground: color.solidTint.warning,
    badgeWarningColorText: color.warningText,
    badgeWarningColorBorder: color.solidTint.warning,
    badgeDangerColorBackground: color.solidTint.error,
    badgeDangerColorText: color.errorText,
    badgeDangerColorBorder: color.solidTint.error,
  },
} as const;
