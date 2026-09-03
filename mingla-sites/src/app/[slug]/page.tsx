import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { RestaurantV1 } from "../../components/RestaurantV1";
import { loadPublication, normalizePublicHost } from "../../lib/publication";
import { pageForSlug } from "../../lib/pageRouting";

export const dynamic = "force-dynamic";

async function currentPublication() {
  const incoming = await headers();
  const host = normalizePublicHost(
    incoming.get("x-forwarded-host") || incoming.get("host"),
  );
  return loadPublication(host);
}

/**
 * #2830 — every page other than home.
 *
 * Home stays at "/" and lives in ../page.tsx. This route resolves one slug to
 * one page in the same publication artifact, so About, Menu, Gallery and
 * Contact are real URLs a customer can link to, bookmark and share, and each
 * carries its own title and description instead of inheriting the homepage's.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  try {
    const { slug } = await params;
    const { artifact } = await currentPublication();
    const page = pageForSlug(artifact, slug);
    if (!page) return { title: "Not found", robots: { index: false, follow: false } };
    const site = artifact.site_settings;
    const canonical = site.seo?.canonical_url
      ? new URL(`/${page.slug}`, site.seo.canonical_url).toString()
      : undefined;
    return {
      title: page.seo?.title || `${page.title} — ${site.display_name}`,
      description: page.seo?.description || site.short_description,
      alternates: { canonical },
    };
  } catch {
    return { title: "Not found", robots: { index: false, follow: false } };
  }
}

export default async function ArtifactPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  let publication: Awaited<ReturnType<typeof currentPublication>>;
  try {
    publication = await currentPublication();
  } catch {
    notFound();
  }
  const { artifact, resolution } = publication;
  const page = pageForSlug(artifact, slug);
  if (!page) notFound();
  return (
    <div
      data-publication-id={resolution.publication_id}
      data-artifact-digest={resolution.artifact_digest}
      data-page={page.role}
    >
      <RestaurantV1 artifact={artifact} page={page} />
    </div>
  );
}
