// #4452 §5.6 forms-track: first open / first click, then the original URL.
import { SAFE_HOME, verifyClick, verifyOpen } from "./sign.ts";

// A 1×1 transparent GIF.
const GIF = Uint8Array.from(atob("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="), (c) => c.charCodeAt(0));

export interface TrackDeps {
  secret: string;
  record: (sendId: string, kind: "open" | "click") => Promise<void>;
}

export async function handleTrack(req: Request, deps: TrackDeps): Promise<Response> {
  const url = new URL(req.url);
  const open = url.searchParams.get("o");
  if (open !== null) {
    const sendId = deps.secret ? await verifyOpen(deps.secret, open) : null;
    if (sendId) await deps.record(sendId, "open").catch(() => {});
    return new Response(GIF, { status: 200, headers: { "Content-Type": "image/gif", "Cache-Control": "no-store, private" } });
  }
  const target = deps.secret
    ? await verifyClick(deps.secret, url.searchParams.get("s"), url.searchParams.get("u"), url.searchParams.get("h"))
    : null;
  if (!target) return new Response(null, { status: 302, headers: { Location: SAFE_HOME, "Cache-Control": "no-store" } });
  await deps.record(url.searchParams.get("s") as string, "click").catch(() => {});
  return new Response(null, { status: 302, headers: { Location: target, "Cache-Control": "no-store" } });
}
