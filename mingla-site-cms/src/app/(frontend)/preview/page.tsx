import { redirect } from "next/navigation";
import { decodePreviewGrant } from "../../../lib/session";
export const metadata = { title: "Private preview — Mingla Studio", robots: { index: false, follow: false } };
export default async function PreviewPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const token = (await searchParams).token ?? null;
  const grant = await decodePreviewGrant(token);
  if (!grant || !token) redirect("/mingla/session-expired");
  const query = new URLSearchParams({ site_id: grant.site_id, token });
  return <main style={{ fontFamily: "Arial", padding: 24 }}><div style={{ padding: 12, background: "#fff2db", border: "1px solid #e2a34f", borderRadius: 8 }}><strong>Private preview — not live</strong><p>This preview is bound to one exact website draft. Publishing is always a separate confirmation.</p></div><iframe title="Private Restaurant Website v1 preview — not live" src={`/api/mingla/previews?${query}`} style={{ width: "100%", height: "calc(100vh - 140px)", border: 0, marginTop: 16 }} /></main>;
}
