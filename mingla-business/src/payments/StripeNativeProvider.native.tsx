// META-ORCH-0827 Pass 2 — native Stripe provider lives in @mingla/payments-native.
// This file is a thin re-export so existing imports keep working (Metro
// resolves StripeNativeProvider.native.tsx on iOS/Android; .web.tsx is the
// no-op web variant; .tsx is the common fallback).
export { StripeNativeProvider } from "@mingla/payments-native";
