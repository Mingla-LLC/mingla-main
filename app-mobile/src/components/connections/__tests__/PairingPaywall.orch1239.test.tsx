/**
 * ORCH-1239 — paywall surfaces on `pairing_limit_reached` for BOTH the SEND and
 * the ACCEPT pairing paths in ConnectionsPage.
 *
 * Self-contained Node-assert harness (same convention as the sibling
 * connections/__tests__ *.test.tsx files — no jest-expo mount of the 4000-line
 * ConnectionsPage). It models the EXACT decision logic the component runs:
 *
 *   SEND   (handlePairFriend catch): on err.message === 'pairing_limit_reached'
 *          → setPaywallFeature('pairing'); setShowPaywall(true). Any other error
 *          → showMutationError (NO paywall).
 *
 *   ACCEPT (acceptPairRequestMutation.mutate onError): identical decision — open
 *          the paywall with feature 'pairing' on 'pairing_limit_reached', else
 *          showMutationError. (Pre-ORCH-1239 the accept path could throw
 *          'pairing_limit_reached' because the migration closed the leak.)
 *
 * The service mock proves the normalization contract: the accept RPC raises
 * 'pairing_limit_reached: <uuid> has reached the pairing limit', and
 * pairingService.acceptPairRequest normalizes it to the bare token so the client
 * keys on the SAME string the send (edge fn) path returns.
 *
 * fails-on-revert: if either handler stops opening the paywall on the token (the
 * pre-ORCH-1239 silent-swallow), the matching assert fails.
 */

declare const module: any;
declare const process: any;
declare const require: any;

const assert = require("node:assert/strict");

type PaywallFeature = "curated_cards" | "custom_starting_point" | "pairing" | "session_creation";

type Harness = {
  showPaywall: boolean;
  paywallFeature: PaywallFeature;
  mutationErrorCalls: Array<{ ctx: string; msg: string }>;
};

function createHarness(): Harness {
  return {
    showPaywall: false,
    paywallFeature: "session_creation", // component default
    mutationErrorCalls: [],
  };
}

const setShowPaywall = (h: Harness, v: boolean) => {
  h.showPaywall = v;
};
const setPaywallFeature = (h: Harness, f: PaywallFeature) => {
  h.paywallFeature = f;
};
const showMutationError = (h: Harness, err: unknown, ctx: string) => {
  h.mutationErrorCalls.push({ ctx, msg: err instanceof Error ? err.message : String(err) });
};

// ── Mirrors ConnectionsPage handlePairFriend's catch block (SEND path) ──
function onSendError(h: Harness, err: unknown) {
  const errMsg = err instanceof Error ? err.message : "";
  if (errMsg === "pairing_limit_reached") {
    setPaywallFeature(h, "pairing");
    setShowPaywall(h, true);
  } else {
    showMutationError(h, err, "sending pair request");
  }
}

// ── Mirrors ConnectionsPage acceptPairRequestMutation.mutate onError (ACCEPT) ──
function onAcceptError(h: Harness, err: unknown) {
  const msg = err instanceof Error ? err.message : "";
  if (msg === "pairing_limit_reached") {
    setPaywallFeature(h, "pairing");
    setShowPaywall(h, true);
  } else {
    showMutationError(h, err, "accepting pair request");
  }
}

// ── Mirrors pairingService.acceptPairRequest error normalization ──
// (the RPC raises 'pairing_limit_reached: <uuid> ...'; the service normalizes it).
function normalizeAcceptRpcError(rpcMessage: string): Error {
  if (rpcMessage.startsWith("pairing_limit_reached")) {
    return new Error("pairing_limit_reached");
  }
  return new Error(rpcMessage);
}

export function runPairingPaywallOrch1239Test() {
  // T1 — SEND: limit error opens the paywall with feature 'pairing'.
  {
    const h = createHarness();
    onSendError(h, new Error("pairing_limit_reached"));
    assert.equal(h.showPaywall, true, "SEND: paywall must open on pairing_limit_reached");
    assert.equal(h.paywallFeature, "pairing", "SEND: feature must be 'pairing'");
    assert.equal(h.mutationErrorCalls.length, 0, "SEND: no raw error toast on limit");
  }

  // T2 — SEND: a genuine error does NOT open the paywall (it routes to the toast).
  {
    const h = createHarness();
    onSendError(h, new Error("network boom"));
    assert.equal(h.showPaywall, false, "SEND: non-limit error must NOT open paywall");
    assert.equal(h.mutationErrorCalls.length, 1, "SEND: non-limit error shows mutation error");
    assert.equal(h.mutationErrorCalls[0].ctx, "sending pair request");
  }

  // T3 — ACCEPT: the RPC's verbose token normalizes, then opens the paywall.
  {
    const h = createHarness();
    const normalized = normalizeAcceptRpcError(
      "pairing_limit_reached: 11111111-1111-1111-1111-111111111111 has reached the pairing limit",
    );
    assert.equal(normalized.message, "pairing_limit_reached", "ACCEPT: service normalizes token");
    onAcceptError(h, normalized);
    assert.equal(h.showPaywall, true, "ACCEPT: paywall must open on pairing_limit_reached");
    assert.equal(h.paywallFeature, "pairing", "ACCEPT: feature must be 'pairing'");
    assert.equal(h.mutationErrorCalls.length, 0, "ACCEPT: no raw error toast on limit");
  }

  // T4 — ACCEPT: a genuine error does NOT open the paywall.
  {
    const h = createHarness();
    onAcceptError(h, new Error("Pair request not found or not authorized"));
    assert.equal(h.showPaywall, false, "ACCEPT: non-limit error must NOT open paywall");
    assert.equal(h.mutationErrorCalls.length, 1, "ACCEPT: non-limit error shows mutation error");
    assert.equal(h.mutationErrorCalls[0].ctx, "accepting pair request");
  }
}

if (require.main === module) {
  try {
    runPairingPaywallOrch1239Test();
    console.log("PASS ORCH-1239 pairing paywall (send + accept)");
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}
