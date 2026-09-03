import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { RestaurantV1 } from "../components/RestaurantV1";
import { loadPublication, normalizePublicHost } from "../lib/publication";
import { homePage } from "../lib/pageRouting";

export const dynamic = "force-dynamic";

async function currentPublication() {
  const incoming = await headers();
  const host = normalizePublicHost(incoming.get("x-forwarded-host") || incoming.get("host"));
  return loadPublication(host);
}

export async function generateMetadata(): Promise<Metadata> {
  try {
    const { artifact } = await currentPublication();
    const seo = artifact.site_settings.seo;
    return {
      title: seo?.title || artifact.site_settings.display_name,
      description: seo?.description || artifact.site_settings.short_description,
      alternates: { canonical: seo?.canonical_url },
      openGraph: { title: seo?.title || artifact.site_settings.display_name, description: seo?.description, url: seo?.canonical_url, images: seo?.social_image ? [{ url: seo.social_image.url, width: seo.social_image.width, height: seo.social_image.height, alt: seo.social_image.alt }] : [] },
    };
  } catch { return { title: "Not found", robots: { index: false, follow: false } }; }
}

export default async function HomePage() {
  let publication: Awaited<ReturnType<typeof currentPublication>>;
  try {
    publication = await currentPublication();
  } catch { notFound(); }
  const { artifact, resolution } = publication;
  const page = homePage(artifact);
  if (!page) notFound();
  return <div data-publication-id={resolution.publication_id} data-artifact-digest={resolution.artifact_digest} data-page="home"><RestaurantV1 artifact={artifact} page={page} /></div>;
}
