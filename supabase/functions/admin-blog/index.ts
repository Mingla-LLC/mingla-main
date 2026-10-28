import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { classifyLinkStatus, collectBlogLinkReferences, isBlogNotReadyError, isPrivateAddress, resolveMarketingRevalidateSecret, validateLinkCheckUrl } from "./model.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const MARKETING_ORIGIN = "https://usemingla.com";
const REVALIDATE_SECRET = resolveMarketingRevalidateSecret(Deno.env.get("AD_CONVERSION_TOKENS")) ?? "";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function assertPublicDestination(url: URL) {
  if (isPrivateAddress(url.hostname)) throw new Error("private_address");
  const addresses = new Set<string>();
  for (const kind of ["A", "AAAA"] as const) {
    try { for (const address of await Deno.resolveDns(url.hostname, kind)) addresses.add(address); } catch { /* one family may be absent */ }
  }
  if (!addresses.size) throw new Error("dns_failed");
  if ([...addresses].some(isPrivateAddress)) throw new Error("private_address");
}

async function fetchChecked(raw: string) {
  let current = validateLinkCheckUrl(raw);
  for (let hop = 0; hop <= 5; hop += 1) {
    await assertPublicDestination(current);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      let response = await fetch(current, { method: "HEAD", redirect: "manual", signal: controller.signal, headers: { "User-Agent": "MinglaLinkCheck/1.0 (+https://usemingla.com)" } });
      if (response.status === 403 || response.status === 405) {
        response = await fetch(current, { method: "GET", redirect: "manual", signal: controller.signal, headers: { "Range": "bytes=0-0", "User-Agent": "MinglaLinkCheck/1.0 (+https://usemingla.com)" } });
      }
      const location = response.headers.get("location");
      if (response.status >= 300 && response.status <= 399 && location) {
        if (hop === 5) return { url: raw, status: response.status, ok: false, reason: "too_many_redirects" };
        current = validateLinkCheckUrl(new URL(location, current).toString());
        continue;
      }
      return { url: raw, status: response.status, ok: classifyLinkStatus(response.status), reason: null };
    } finally { clearTimeout(timer); }
  }
  return { url: raw, status: 0, ok: false, reason: "too_many_redirects" };
}

async function mapConcurrent<T, R>(items: T[], concurrency: number, task: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) { const index = next++; results[index] = await task(items[index]); }
  }));
  return results;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const authorization = req.headers.get("authorization");
  if (!authorization) return json({ error: "unauthorized" }, 401);
  const service = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: { user }, error: authError } = await service.auth.getUser(authorization.replace(/^Bearer\s+/i, ""));
  if (authError || !user) return json({ error: "unauthorized" }, 401);
  const permissions = await userClient.rpc("issue_4137_blog_my_permissions");
  if (permissions.error) return json({ error: isBlogNotReadyError(permissions.error) ? "blog_not_ready" : "server" }, isBlogNotReadyError(permissions.error) ? 503 : 500);
  if (!permissions.data?.can_write) return json({ error: "forbidden" }, 403);
  const body = await req.json().catch(() => ({})) as { action?: string; postId?: string };

  if (body.action === "check_links") {
    if (!body.postId) return json({ error: "post_id_required" }, 400);
    const post = await service.from("blog_posts").select("id,draft_version_id").eq("id", body.postId).is("deleted_at", null).maybeSingle();
    if (post.error) return json({ error: isBlogNotReadyError(post.error) ? "blog_not_ready" : "server" }, isBlogNotReadyError(post.error) ? 503 : 500);
    if (!post.data?.draft_version_id) return json({ error: "post_not_found" }, 404);
    const version = await service.from("blog_post_versions").select("id,document").eq("id", post.data.draft_version_id).maybeSingle();
    if (version.error) return json({ error: isBlogNotReadyError(version.error) ? "blog_not_ready" : "server" }, isBlogNotReadyError(version.error) ? 503 : 500);
    if (!version.data) return json({ error: "post_not_found" }, 404);
    const references = collectBlogLinkReferences(version.data.document, MARKETING_ORIGIN);
    const results = await mapConcurrent(references, 6, async ({ url }) => {
      try { return await fetchChecked(url); }
      catch (error) { return { url, status: 0, ok: false, reason: error instanceof Error ? error.message : "request_failed" }; }
    });
    const receipt = await service.from("blog_post_link_checks").insert({ post_id: post.data.id, version_id: version.data.id, ok: results.every((item) => item.ok), results, checked_by: user.id }).select("id,checked_at,ok,results").single();
    if (receipt.error) return json({ error: isBlogNotReadyError(receipt.error) ? "blog_not_ready" : "server" }, isBlogNotReadyError(receipt.error) ? 503 : 500);
    return json(receipt.data);
  }
  if (body.action === "revalidate") {
    if (!permissions.data?.can_publish) return json({ error: "forbidden" }, 403);
    if (!REVALIDATE_SECRET) return json({ error: "revalidate_not_configured" }, 503);
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(`${MARKETING_ORIGIN}/api/blog/revalidate`, { method: "POST", signal: controller.signal, headers: { "x-mingla-revalidate-secret": REVALIDATE_SECRET } });
      return json({ ok: response.ok, status: response.status }, response.ok ? 200 : 502);
    } catch { return json({ ok: false, status: 0 }, 502); }
    finally { clearTimeout(timer); }
  }
  return json({ error: "action_unknown" }, 400);
});
