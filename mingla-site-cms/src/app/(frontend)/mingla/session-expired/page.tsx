import { headers } from "next/headers";
import StudioSafeReturn from "../../../../components/StudioSafeReturn";
import {
  cookieValue,
  decodeSessionReturnContext,
  studioReturnLocationFromContext,
  STUDIO_COOKIE,
} from "../../../../lib/session";

export default async function SessionExpired() {
  const requestHeaders = await headers();
  const context = await decodeSessionReturnContext(
    cookieValue(requestHeaders, STUDIO_COOKIE),
  );
  const returnUrl = context
    ? studioReturnLocationFromContext(context, "session_expired")
    : "https://business.usemingla.com";
  return (
    <StudioSafeReturn
      returnUrl={returnUrl}
      title="Your editing session ended."
      body="Your saved drafts are safe. Return to the exact Website workspace and open Studio again."
    />
  );
}
