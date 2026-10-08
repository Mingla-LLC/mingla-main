/**
 * #3682 — auto-follow after purchase / RSVP / booking (signed-in buyers).
 * Fail-open: never block checkout confirmation on follow failures.
 */

export type AutoFollowSource =
  | "purchase"
  | "rsvp"
  | "booking"
  | "brand_page"
  | "web_email";

export async function autoFollowBrandBestEffort(
  // deno-lint-ignore no-explicit-any
  supabase: { rpc: (...args: any[]) => Promise<{ data: unknown; error: { message: string } | null }> },
  input: {
    userId: string | null | undefined;
    brandId: string | null | undefined;
    source?: AutoFollowSource;
  },
): Promise<void> {
  const userId = typeof input.userId === "string" ? input.userId.trim() : "";
  const brandId = typeof input.brandId === "string" ? input.brandId.trim() : "";
  if (userId.length === 0 || brandId.length === 0) {
    return;
  }
  const { error } = await supabase.rpc("biz_auto_follow_brand", {
    p_user_id: userId,
    p_brand_id: brandId,
    p_source: input.source ?? "purchase",
  });
  if (error) {
    console.warn(
      "[autoFollowBrand] non-fatal",
      error.message,
      userId,
      brandId,
    );
  }
}
