/**
 * #4111 D1/D2 — "Stay in the loop" for signed-out buyer-web visitors. Sends
 * through edge `public-brand-subscribe` (double opt-in; the answer is the same
 * whether or not the email has a Mingla account), then shows "Check your
 * email" with "Use a different email".
 */
import React, { useCallback, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import type {
  BrandPageFootLoop,
  StayInLoopRequest,
} from "@mingla/brand-rendering/enquiry/BrandPageFoot";
import type { EnquiryPhoneFieldArgs } from "@mingla/brand-rendering/enquiry/BrandMessageSheet";

import { captureWeb } from "../../analytics/webAnalytics";

const LazyEnquiryPhoneField = React.lazy(async () => {
  const module = await import("./EnquiryPhoneField");
  return { default: module.EnquiryPhoneField };
});

type LoopState = Pick<BrandPageFootLoop, "state" | "sentTo" | "sentSms" | "errorMessage">;

const IDLE: LoopState = { state: "idle", sentTo: null, sentSms: false, errorMessage: null };

export function useStayInLoop(input: {
  brandId: string;
  brandSlug: string;
  countryIso?: string | null;
  /** Fired after a request is accepted (the Follow control shows Pending). */
  onRequested?: () => void;
}): BrandPageFootLoop {
  const { brandId, brandSlug, countryIso, onRequested } = input;
  const [loop, setLoop] = useState<LoopState>(IDLE);

  const onSubmit = useCallback(
    (request: StayInLoopRequest): void => {
      setLoop({ state: "sending", sentTo: null, sentSms: false, errorMessage: null });
      void (async () => {
        try {
          const service = await import("../../services/publicEnquiryService");
          const outcome = await service.requestBrandSubscribe({ brandId, ...request });
          if (!outcome.ok) {
            setLoop({ state: "error", sentTo: null, sentSms: false, errorMessage: outcome.message });
            return;
          }
          setLoop({
            state: "sent",
            sentTo: request.email,
            sentSms: request.wantsSms && request.phoneE164 !== null,
            errorMessage: null,
          });
          onRequested?.();
          captureWeb("brand_subscribe_requested", {
            surface: "buyer_web",
            brand_id: brandId,
            brand_slug: brandSlug,
            wants_sms: request.wantsSms,
          });
        } catch (error: unknown) {
          console.warn(
            "[brand-subscribe] request failed",
            error instanceof Error ? error.message : String(error),
          );
          setLoop({
            state: "error",
            sentTo: null,
            sentSms: false,
            errorMessage: "We couldn't sign you up. Check your connection and try again.",
          });
        }
      })();
    },
    [brandId, brandSlug, onRequested],
  );

  const onReset = useCallback((): void => setLoop(IDLE), []);

  const renderPhoneField = useCallback(
    (args: EnquiryPhoneFieldArgs): React.ReactElement => (
      <React.Suspense fallback={<View style={styles.phoneFallback} />}>
        <LazyEnquiryPhoneField {...args} startCountries={[countryIso]} />
      </React.Suspense>
    ),
    [countryIso],
  );

  return useMemo(
    () => ({ ...loop, onSubmit, onReset, renderPhoneField }),
    [loop, onReset, onSubmit, renderPhoneField],
  );
}

const styles = StyleSheet.create({
  phoneFallback: { minHeight: 48 },
});
