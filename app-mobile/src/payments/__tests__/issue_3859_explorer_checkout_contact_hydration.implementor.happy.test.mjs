import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  EXPLORER_CHECKOUT_CONTACT_SEED_AUTHORITY,
  explorerCheckoutContactSeedDecision,
} from "../explorerCheckoutContact.mjs";

const appMobileRoot = process.env.MINGLA_ISSUE_3859_SOURCE_ROOT ??
  fileURLToPath(new URL("../../..", import.meta.url));
const cartSource = readFileSync(
  `${appMobileRoot}/src/components/expandedCard/TicketCartSheet.tsx`,
  "utf8",
);

test("#3859 an untouched blank first render accepts late signed-in account contact", () => {
  const firstBlankRender = explorerCheckoutContactSeedDecision(
    EXPLORER_CHECKOUT_CONTACT_SEED_AUTHORITY.awaitingAccount,
    true,
    false,
  );
  assert.deepEqual(firstBlankRender, {
    shouldApply: true,
    nextAuthority: EXPLORER_CHECKOUT_CONTACT_SEED_AUTHORITY.awaitingAccount,
  });

  const hydratedAccountRender = explorerCheckoutContactSeedDecision(
    firstBlankRender.nextAuthority,
    true,
    true,
  );
  assert.deepEqual(hydratedAccountRender, {
    shouldApply: true,
    nextAuthority: EXPLORER_CHECKOUT_CONTACT_SEED_AUTHORITY.resolvedAccount,
  });
});

test("#3859 resolved or buyer-owned booking contact rejects late overwrites", () => {
  for (const authority of [
    EXPLORER_CHECKOUT_CONTACT_SEED_AUTHORITY.resolvedAccount,
    EXPLORER_CHECKOUT_CONTACT_SEED_AUTHORITY.buyerOwned,
  ]) {
    assert.deepEqual(
      explorerCheckoutContactSeedDecision(authority, true, true),
      { shouldApply: false, nextAuthority: authority },
    );
  }
});

test("#3859 closing the cart releases contact authority for the next booking", () => {
  assert.deepEqual(
    explorerCheckoutContactSeedDecision(
      EXPLORER_CHECKOUT_CONTACT_SEED_AUTHORITY.buyerOwned,
      false,
      true,
    ),
    {
      shouldApply: false,
      nextAuthority: EXPLORER_CHECKOUT_CONTACT_SEED_AUTHORITY.awaitingAccount,
    },
  );
});

test("#3859 the real cart wires hydration authority to every editable contact field", () => {
  assert.match(cartSource, /explorerCheckoutContactSeedDecision\(/);
  assert.match(
    cartSource,
    /contactSeedAuthorityRef\.current = seedDecision\.nextAuthority/,
  );
  assert.doesNotMatch(cartSource, /contactOpenSeededRef/);
  assert.doesNotMatch(
    cartSource,
    /validation\.invalidFields\.map\(\(field\) => \[field, true\]\)/,
  );

  const buyerOwnedAssignments = cartSource.match(
    /EXPLORER_CHECKOUT_CONTACT_SEED_AUTHORITY\.buyerOwned/g,
  ) ?? [];
  assert.ok(
    buyerOwnedAssignments.length >= 5,
    "name, email, phone, country, and Change must all lock buyer-owned input",
  );
});
