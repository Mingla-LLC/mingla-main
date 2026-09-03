import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RestaurantV1 } from "../../components/RestaurantV1";
import {
  loadPreviewArtifact,
  parsePreviewArtifactKey,
} from "../../lib/previewArtifact";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Private preview — not live",
  robots: { index: false, follow: false },
};

/**
 * #2830 — the ONE renderer, showing a draft.
 *
 * This route exists so "preview" and "published" cannot drift: both go through
 * `RestaurantV1` and the same stylesheet, from an artifact built by the same
 * builder. The only difference a viewer sees is the standing "not live" banner,
 * and the fact that nothing here is reachable from the public site.
 */
export default async function PreviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = params.k;
  const parsed = parsePreviewArtifactKey(Array.isArray(raw) ? raw[0] : raw);
  if (!parsed) notFound();
  let artifact;
  try {
    artifact = await loadPreviewArtifact(parsed);
  } catch {
    notFound();
  }
  return (
    <div data-preview="1" data-artifact-digest={parsed.digest}>
      <p className="preview-banner" role="status">
        Private preview — not live. Publishing is always a separate confirmation.
      </p>
      <RestaurantV1 artifact={artifact} />
    </div>
  );
}
