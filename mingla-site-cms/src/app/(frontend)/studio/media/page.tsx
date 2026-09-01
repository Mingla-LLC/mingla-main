import { headers } from "next/headers";
import { redirect } from "next/navigation";
import StudioMediaManager from "../../../../components/StudioMediaManager";
import { sessionFromHeaders } from "../../../../lib/session";

export const metadata = {
  title: "Media — Mingla Studio",
  robots: { index: false, follow: false },
};

export default async function StudioMediaPage() {
  const session = await sessionFromHeaders(await headers());
  if (!session) redirect("/mingla/session-expired");
  return <StudioMediaManager />;
}
