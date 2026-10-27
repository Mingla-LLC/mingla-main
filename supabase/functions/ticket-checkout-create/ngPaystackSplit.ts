// Issue #3645: the split decision moved to _shared/ngPaystackSplit.ts so every
// Paystack money path (checkout deposit, instalment charges, pay links) uses one
// rule. Re-exported here so existing imports and tests keep resolving.
export { paystackTicketSplitFields, type PaystackTicketSplitFields } from "../_shared/ngPaystackSplit.ts";
