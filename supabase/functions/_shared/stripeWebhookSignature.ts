import type { StripeClient } from "./stripe.ts";

export interface StripeWebhookSecret {
  name: "connect" | "platform" | "previous";
  value: string;
}

export interface VerifiedStripeWebhookEvent {
  event: {
    id: string;
    type: string;
    account?: string | null;
    data: { object: Record<string, unknown> };
  };
  secretName: StripeWebhookSecret["name"];
}

export function getStripeWebhookSecretsFromEnv(): StripeWebhookSecret[] {
  const entries: StripeWebhookSecret[] = [];
  const connect = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  const platform = Deno.env.get("STRIPE_WEBHOOK_SECRET_PLATFORM");
  const previous = Deno.env.get("STRIPE_WEBHOOK_SECRET_PREVIOUS");
  if (connect) entries.push({ name: "connect", value: connect });
  if (platform) entries.push({ name: "platform", value: platform });
  if (previous) entries.push({ name: "previous", value: previous });
  return entries;
}

export async function verifyStripeWebhookSignature(
  stripe: StripeClient,
  rawBody: string,
  signature: string,
  secrets: readonly StripeWebhookSecret[],
): Promise<VerifiedStripeWebhookEvent> {
  const failures: string[] = [];
  for (const secret of secrets) {
    try {
      // @ts-ignore — Stripe SDK webhook event type is runtime-verified.
      const event = await stripe.webhooks.constructEventAsync(
        rawBody,
        signature,
        secret.value,
      );
      return { event, secretName: secret.name };
    } catch (err) {
      failures.push(`${secret.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new Error(failures.join("; ") || "no webhook secrets configured");
}
