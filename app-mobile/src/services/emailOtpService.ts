/**
 * emailOtpService — issue #3524.
 *
 * WHY THIS EXISTS. A guest buys a ticket with `alice@example.com` and taps
 * "Connect attendance" while signed in as somebody else. Seth's decision 1: show
 * them who they are signed in as, and on "that's not me", sign out and let them
 * verify the purchase address by code. The Explorer app had no way to do that —
 * `useAuthSimple` offered Google and Apple only, and the sole OTP in `app-mobile`
 * is Twilio PHONE verification inside onboarding, which cannot prove an email.
 *
 * WHY IT IS THE SAME MECHANISM AS THE CLAIM PREDICATE, not a second one. A
 * successful Supabase email OTP makes GoTrue write a `provider='email'` identity
 * row, and `verified_account_identifiers` reads exactly those rows. So the
 * account that verifies `alice@example.com` here is, by the same evidence, the
 * account `account_owns_order_contact` will accept for an order bought with that
 * address. One proof, two consumers.
 *
 * Supabase email OTP is already live on this project — the Host app
 * (`mingla-business/src/context/AuthContext.tsx`) and the Admin app both call
 * `signInWithOtp` against it. This is JS-only and reaches installed 1.1.6 builds
 * over the air.
 *
 * SHAPE. Both functions return a result object and NEVER throw, and neither logs
 * the code or the address. Naming and error shape deliberately mirror
 * `otpService.ts` so the two read as siblings rather than as two conventions.
 */

import { Platform } from "react-native";
import { supabase } from "./supabase";
import { mixpanelService } from "./mixpanelService";
import { reportNonFatal } from "../diagnostics/reportNonFatal";
// #1875's SINGLE transient/permanent decision point. Imported rather than
// re-expressed: that issue exists because the distinction had been scattered
// across catch branches, and an email-OTP fault must be judged by the same
// predicate a Google fault is.
import { classifyAuthFailure } from "../hooks/useAuthSimple";

export interface SendEmailSignInCodeResult {
  ok: boolean;
  error?: string;
}

export interface VerifyEmailSignInCodeResult {
  ok: boolean;
  error?: string;
}

/**
 * Map a provider message to a SENTENCE. A raw GoTrue string in a sheet is how a
 * guest ends up reading "AuthApiError: Email rate limit exceeded" at the moment
 * they are trying to get their ticket.
 */
const sendFailureMessage = (raw: string): string => {
  const message = raw.toLowerCase();
  if (message.includes("rate limit") || message.includes("too many")) {
    return "Too many codes requested. Wait a minute and try again.";
  }
  if (message.includes("invalid") && message.includes("email")) {
    return "That email address doesn’t look right. Check it and try again.";
  }
  if (message.includes("network") || message.includes("fetch")) {
    return "We couldn’t reach Mingla. Check your connection and try again.";
  }
  return "We couldn’t send the code. Try again.";
};

const verifyFailureMessage = (raw: string): string => {
  const message = raw.toLowerCase();
  if (message.includes("expired")) {
    return "That code has expired. Send a new one.";
  }
  if (message.includes("invalid") || message.includes("token")) {
    return "That code isn’t right. Check it and try again.";
  }
  if (message.includes("rate limit") || message.includes("too many")) {
    return "Too many attempts. Wait a minute and try again.";
  }
  if (message.includes("network") || message.includes("fetch")) {
    return "We couldn’t reach Mingla. Check your connection and try again.";
  }
  return "We couldn’t verify that code. Try again.";
};

/**
 * Send a one-time sign-in code to an email address.
 *
 * `shouldCreateUser: true` is deliberate and is the whole point for #3524: a
 * guest who bought a ticket without an account is EXACTLY the person this exists
 * for, and refusing to create the account would recreate the dead end. Their
 * ticket then lands on the new account through the identity rail, because the
 * OTP is what proves they own the purchase mailbox.
 */
export async function sendEmailSignInCode(
  email: string,
): Promise<SendEmailSignInCodeResult> {
  const address = email.trim().toLowerCase();
  if (address.length === 0) {
    return { ok: false, error: "Enter the email you used at checkout." };
  }
  try {
    const { error } = await supabase.auth.signInWithOtp({
      email: address,
      options: { shouldCreateUser: true },
    });
    if (error) return { ok: false, error: sendFailureMessage(error.message) };
    return { ok: true };
  } catch (err) {
    // No address, no code, no provider payload in the log. The sentence the
    // guest sees is the only output.
    return {
      ok: false,
      error: sendFailureMessage(
        err instanceof Error ? err.message : "unknown",
      ),
    };
  }
}

/** Verify the emailed code. On success GoTrue establishes the session AND writes
 * the `provider='email'` identity the claim predicate reads. */
export async function verifyEmailSignInCode(
  email: string,
  code: string,
): Promise<VerifyEmailSignInCodeResult> {
  const address = email.trim().toLowerCase();
  const token = code.trim();
  if (address.length === 0 || token.length === 0) {
    return { ok: false, error: "Enter the code we emailed you." };
  }
  try {
    const { error } = await supabase.auth.verifyOtp({
      email: address,
      token,
      type: "email",
    });
    if (error) return { ok: false, error: verifyFailureMessage(error.message) };
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: verifyFailureMessage(
        err instanceof Error ? err.message : "unknown",
      ),
    };
  }
}

/**
 * #3524 — SIGN IN BY EMAILED CODE, with the app's own failure reporting.
 *
 * WHY THESE LIVE HERE AND NOT ON `useAuthSimple`. They hold no hook state —
 * no `user`, no `isMountedRef`, no effect — so there is nothing a hook gives
 * them. Putting them in the hook also meant editing `useAuthSimple.ts`, whose
 * contents #1875 pins byte-for-byte outside its own declared regions precisely
 * so the sign-in paths cannot drift under a nearby change. Reaching for that
 * file for two stateless wrappers would have spent that guarantee for nothing.
 *
 * WHY THEY EXIST AT ALL. A guest buys a ticket with `alice@example.com`, and
 * the ticket can only land on an account that has proved it owns that address.
 * If no Google or Apple account stands behind it, neither provider can prove
 * it, so before #3524 that guest could not claim their ticket at all.
 *
 * Failures go through `classifyAuthFailure` and `reportNonFatal`, the SAME
 * channel a Google failure takes (#1044's contract), so an email-OTP fault is
 * as visible in monitoring as any other. Unlike the native paths these raise NO
 * Alert: they are called from an inline panel that renders the sentence itself,
 * and an Alert on top of that would be the same message twice. The address is
 * never logged, and never becomes a reason string.
 */
export async function signInWithEmailCode(
  email: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const result = await sendEmailSignInCode(email);
    if (!result.ok) {
      const failure = classifyAuthFailure(
        "EmailOtpSendFailed",
        undefined,
        undefined,
        result.error ?? "",
        Platform.OS,
      );
      // A blip that the guest can simply retry is not a fault worth a capture;
      // `shouldReportAuthFailure` is not consulted because it discriminates on
      // NATIVE provider status codes, of which this path has none.
      if (failure === "permanent") {
        reportNonFatal(
          "auth.signInWithEmailCode.send",
          new Error("email_otp_send_failed"),
          { provider: "email", platform: Platform.OS },
        );
      }
    }
    return result;
  } catch (err) {
    reportNonFatal(
      "auth.signInWithEmailCode.send",
      err instanceof Error ? err : new Error("email_otp_send_threw"),
      { provider: "email", platform: Platform.OS },
    );
    return { ok: false, error: "We couldn\u2019t send the code. Try again." };
  }
}

export async function verifyEmailCode(
  email: string,
  code: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const result = await verifyEmailSignInCode(email, code);
    if (!result.ok) {
      // The SAME failure channel a Google failure uses. The address is not the
      // reason string and is never passed here.
      mixpanelService.trackLoginFailed("email", result.error ?? "verify_failed");
    }
    return result;
  } catch (err) {
    reportNonFatal(
      "auth.verifyEmailCode",
      err instanceof Error ? err : new Error("email_otp_verify_threw"),
      { provider: "email", platform: Platform.OS },
    );
    return {
      ok: false,
      error: "We couldn\u2019t verify that code. Try again.",
    };
  }
}
