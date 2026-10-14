const TARGET_LABELS: Readonly<Record<string, string>> = {
  application_fee: "Service fee",
  brand: "Brand",
  brand_invitation: "Team invite",
  brand_paystack_recipient: "Bank details",
  brand_team_members: "Team member",
  creator_account: "Creator account",
  detached_refund: "Refund",
  event: "Event",
  event_rsvp_contribution: "RSVP contribution",
  offering: "Offering",
  order: "Order",
  order_installment: "Instalment",
  partner_brand_link: "Partner brand",
  partner_paystack_account: "Partner payout account",
  partner_split: "Partner payout",
  partner_stripe_connect_account: "Partner payout account",
  payout: "Payout",
  paystack_subaccount: "Payout account",
  paystack_transaction: "Payment",
  paystack_webhook_event: "Payment event",
  place_pool: "Place listing",
  refund: "Refund",
  reservation: "Reservation",
  reservation_checkout_session: "Reservation checkout",
  scanner_invitation: "Scanner invite",
  stripe_connect_account: "Payout account",
  stripe_external_account: "Bank account",
  stripe_webhook_event: "Payment event",
  team_member: "Team member",
  ticket_checkout_session: "Ticket checkout",
  venue_claim: "Venue claim",
  venue_order: "Venue order",
};

const shortTargetId = (targetId: string): string => `…${targetId.slice(-6)}`;

export const resolveAuditTargetLabel = (
  targetType: string | null,
): string | null => {
  if (targetType === null) return null;
  return TARGET_LABELS[targetType] ?? "Record";
};

export const formatAuditTargetSummary = (
  targetType: string | null,
  targetId: string | null,
): string => {
  const label = resolveAuditTargetLabel(targetType);
  if (label === null) return "—";
  return targetId === null ? label : `${label} ${shortTargetId(targetId)}`;
};
