import PreviewChrome from "../../../components/PreviewChrome";
import StudioSafeReturn from "../../../components/StudioSafeReturn";
import { MINGLA_BUSINESS_ORIGIN } from "../../../lib/origins";
import {
  decodePreviewGrant,
  decodePreviewReturnContext,
  studioReturnLocationFromContext,
} from "../../../lib/session";

export const metadata = {
  title: "Private preview — Mingla Studio",
  robots: { index: false, follow: false },
};

export default async function PreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const token = (await searchParams).token ?? null;
  const grant = await decodePreviewGrant(token);
  if (!grant || !token) {
    const context = await decodePreviewReturnContext(token);
    return (
      <StudioSafeReturn
        returnUrl={
          context
            ? studioReturnLocationFromContext(context, "preview_expired")
            : MINGLA_BUSINESS_ORIGIN
        }
        title="This private preview ended."
        body="Nothing was published. Return to the exact Website workspace for a fresh preview."
      />
    );
  }
  const query = new URLSearchParams({ site_id: grant.site_id, token });
  return (
    <PreviewChrome
      frameSrc={`/api/mingla/previews?${query}`}
      closeUrl={studioReturnLocationFromContext(grant)}
      publishUrl={studioReturnLocationFromContext(grant, "preview_publish")}
      revision={grant.source_revision}
      expiresAt={grant.expires_at}
    />
  );
}
