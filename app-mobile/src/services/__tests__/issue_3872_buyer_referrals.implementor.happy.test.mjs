import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const read = (path) => readFileSync(`${root}/${path}`, "utf8");

test("#3872 B5 Explorer exposes one wallet without balance or withdrawal language", () => {
  // Walkthrough build: one Earnings screen for gig, referral and Local money in
  // three words (On the way / Ready / Paid), no provider names.
  const wallet = read("src/components/wallet/EarningsWalletScreen.tsx");
  const profile = read("src/components/ProfilePage.tsx");
  assert.match(wallet, /title="Earnings"/);
  assert.match(wallet, /not a balance to withdraw/);
  assert.match(wallet, /On the way/);
  assert.match(wallet, /label="Ready"/);
  assert.match(wallet, /label="Paid"/);
  assert.match(wallet, /wallet_viewed/);
  assert.match(wallet, /voucher_redeemed/);
  assert.match(wallet, /referral_link_shared/);
  assert.match(wallet, /5% referral service fee/);
  assert.match(profile, /Gig fees, referral rewards, Local pay and your payout account/);
  assert.doesNotMatch(wallet, /Withdraw now|Cash out|Stripe|Paystack/);
});

test("#3872 B5 personal earning links appear on listing, success and ticket surfaces", () => {
  const event = read("src/screens/Event/ConsumerEventDetailScreen.tsx");
  const cart = read("src/components/expandedCard/TicketCartSheet.tsx");
  const ticket = read("app/purchases/[kind]/[id].tsx");
  const card = read("src/components/wallet/EarnBySharingCard.tsx");
  assert.match(event, /<EarnBySharingCard[\s\S]*listingKind="event"/);
  assert.match(cart, /successFooter/);
  assert.match(ticket, /<EarnBySharingCard[\s\S]*listingKind="event"/);
  assert.match(card, /fetchBuyerReferralLink/);
  assert.match(card, /if \(!offer\.data\) return null/);
  assert.match(card, /referral_link_shared/);
  assert.doesNotMatch(card, /does not have an earning offer right now/);
  const shareAdapter = read("src/services/contentShareAdapter.ts");
  const shareSheet = read("src/components/share/UnifiedShareProvider.tsx");
  assert.match(shareAdapter, /fetchBuyerReferralLink/);
  assert.match(shareAdapter, /applyBuyerReferralLink/);
  assert.match(shareSheet, /Show my name when I share/);
  assert.match(shareSheet, /showSharer: nextValue/);
});

test("#3872 B5 the in-app bank check shows the resolved account name before saving", () => {
  const payout = read("src/components/wallet/PayoutConnect.tsx");
  const service = read("src/services/payoutService.ts");
  assert.match(service, /action: 'resolve_account'/);
  assert.match(payout, /Is this you\?/);
  assert.match(payout, /Yes, connect this account/);
  assert.match(payout, /const check = async[\s\S]*await payoutService\.checkAccount/);
  assert.match(payout, /const confirm = async[\s\S]*await payoutService\.saveAccount/);
  assert.doesNotMatch(payout, /Stripe|Paystack/);
});

test("#3872 B5 claim stays authenticated and sends only the raw token to its hashing edge", () => {
  const claim = read("app/claim/earnings.tsx");
  const service = read("src/services/referralEarningsService.ts");
  assert.match(claim, /claimGuestEarnings/);
  assert.match(claim, /exact email/);
  assert.match(service, /payee-claim-by-email/);
  assert.doesNotMatch(service, /payee_claim_tokens/);
});
