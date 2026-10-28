import PreviewChrome from "../../../components/PreviewChrome";
import StudioSafeReturn from "../../../components/StudioSafeReturn";
import { cmsConfig } from "../../../lib/config";
import { businessPreviewFrameAncestor } from "../../../lib/origins";
import {
  decodePreviewGrant,
  decodePreviewReturnContext,
  studioReturnLocationFromContext,
} from "../../../lib/session";
import { previewPagePath } from "../../../lib/previewPath";

export const metadata = {
  title: "Private preview — Mingla Studio",
  robots: { index: false, follow: false },
};

export default async function PreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; path?: string; fa?: string }>;
}) {
  const params = await searchParams;
  const token = params.token ?? null;
  const grant = await decodePreviewGrant(token);
  if (!grant || !token) {
    const context = await decodePreviewReturnContext(token);
    return (
      <StudioSafeReturn
        returnUrl={
          context
            ? studioReturnLocationFromContext(context, "preview_expired")
            // #2829 W9f — configured Business origin (local Business web locally).
            : cmsConfig().businessOrigin
        }
        title="This private preview ended."
        body="Nothing was published. Return to the exact Website workspace for a fresh preview."
      />
    );
  }
  const query = new URLSearchParams({ site_id: grant.site_id, token });
  // #2829 W2 — open the preview at the page the owner chose in Mingla.
  const pagePath = previewPagePath(params.path);
  if (pagePath) query.set("path", pagePath);
  // #2829 W9f — a Business Vercel preview framing this page names itself;
  // only that exact pattern travels on to the runtime's frame-ancestors.
  const frameAncestor = businessPreviewFrameAncestor(params.fa);
  if (frameAncestor) query.set("fa", frameAncestor);
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
