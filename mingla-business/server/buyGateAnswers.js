// #4518 N1 — the answers the Buy button waits on travel WITH the page data,
// from our own site. Before this, the browser asked the database host for
// them directly, so a phone that could reach us but not that host showed
// "Booking unavailable" about a brand whose setup was complete.
//
// ONE copy for the event, trip and experience bundles (rule 8).
//
// Each answer is added only when the read succeeded and was unambiguous. A
// read that fails adds nothing, and the client falls back to asking for
// itself, exactly as before this change. Neither field loosens anything: the
// reservation path re-checks both, under its own locks, when the buyer pays.
//   brandCanCollect      boolean, verbatim from pg_brand_can_collect. Only
//                        when the caller asks for it: the experience payload
//                        already carries a server-computed `bookable`, and a
//                        second copy would be two owners of one fact.
//   checkoutAccessMode   "unrestricted" only. A restricted sale is decided
//                        per buyer and is never answered from a shared cache.
//
// `data.id` is the offering's `events.id` (the key the access state and the
// client hint store both use); `data.brandId` its brand.
const { requestRpcJson } = require("./supabaseRpc");

const withBuyGateAnswers = async (data, options) => {
  if (data === null || typeof data !== "object") return data;
  const askCanCollect = options !== undefined && options.brandCanCollect === true;
  const brandId = typeof data.brandId === "string" ? data.brandId : null;
  const eventId = typeof data.id === "string" ? data.id : null;
  const [canCollect, access] = await Promise.allSettled([
    !askCanCollect
      ? Promise.reject(new Error("not_asked"))
      : brandId === null
        ? Promise.reject(new Error("no_brand_id"))
        : requestRpcJson("pg_brand_can_collect", { p_brand_id: brandId }),
    eventId === null
      ? Promise.reject(new Error("no_event_id"))
      : requestRpcJson("pg_public_ticket_checkout_access_state", {
          p_event_id: eventId,
        }),
  ]);
  const out = { ...data };
  if (canCollect.status === "fulfilled" && typeof canCollect.value === "boolean") {
    out.brandCanCollect = canCollect.value;
  }
  if (
    access.status === "fulfilled" &&
    access.value !== null &&
    typeof access.value === "object" &&
    access.value.mode === "unrestricted"
  ) {
    out.checkoutAccessMode = "unrestricted";
  }
  return out;
};

module.exports = { withBuyGateAnswers };
