/**
 * RefundPolicyDisplay — re-export shim.
 *
 * ORCH-1016: the implementation moved to the shared @mingla/offering-rendering
 * package so the consumer-app trip detail and the business public/preview pages
 * render the IDENTICAL refund ladder (copy + semantics LOCKED). This file is now
 * a thin re-export shim (same pattern as EventCoverMedia per COMMS-0007 /
 * feedback_eventcovermedia_shared_package). Do NOT add markup here — edit the
 * shared package. The business `RefundPolicy` type is structurally identical to
 * the package's `RefundPolicyShape`, so existing call sites are unchanged.
 *
 * Original: ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] buyer-facing ladder.
 */

export {
  RefundPolicyDisplay,
  type RefundPolicyDisplayProps,
} from "@mingla/offering-rendering";
