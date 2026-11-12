/**
 * #4389 A3 — what Ari's create-brand card turns into when the confirm does not
 * create a brand: the server found one already in setup (DRAFT_EXISTS /
 * EXISTING_INCOMPLETE_BRAND → "You already started {name}. Continue it?") or
 * the confirmation timed out ("This expired. Ask again."). Pure, so the
 * mapping is tested without the chat screen.
 */
import { ARI_SETUP_COPY, payoutCountryLabel } from "./ariSetupCopy";

export type A3Notice =
  | { kind: "duplicate"; brandId: string | null; name: string }
  | { kind: "expired"; question: string };

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export function a3NoticeFor(input: {
  toolName: string | null | undefined;
  args: Record<string, unknown> | null | undefined;
  /** The confirm's error code, or null when it did not error. */
  code: string | null;
  message?: string | null;
  expired: boolean;
  brandNamesById?: Readonly<Record<string, string>>;
}): A3Notice | null {
  if (input.toolName !== "create_brand") return null;
  const args = input.args ?? {};
  const askedName = typeof args.name === "string" ? args.name.trim() : "";
  if (input.expired) {
    const funds = payoutCountryLabel(args.payout_country);
    const name = askedName || ARI_SETUP_COPY.a3.thisBrand;
    return {
      kind: "expired",
      question: funds !== null ? ARI_SETUP_COPY.a3.question(name, funds.name, funds.currency) : ARI_SETUP_COPY.a3.questionNoCountry(name),
    };
  }
  if (input.code === "DRAFT_EXISTS" || input.code === "EXISTING_INCOMPLETE_BRAND") {
    const brandId = UUID.exec(input.message ?? "")?.[0]?.toLowerCase() ?? null;
    const known = brandId !== null ? input.brandNamesById?.[brandId] : undefined;
    return { kind: "duplicate", brandId, name: known ?? askedName };
  }
  return null;
}
