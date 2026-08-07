const {
  buildTripOgCardProps,
  fetchPublicTripById,
  firstQueryValue,
  renderOgPng,
  sendPng,
} = require("../server/socialPreview");
const { businessRowSnapshot, renderCardIdentityPng, useDirectionC } = require("../server/cardIdentityRenderer");

module.exports = async function tripOgHandler(req, res) {
  const tripId = firstQueryValue(req.query.tripId);

  try {
    const trip =
      typeof tripId === "string" ? await fetchPublicTripById(tripId) : null;
    const props = buildTripOgCardProps(trip);
    if (!props.coverUrl) { res.statusCode = 404; return res.end(); }
    const buffer = useDirectionC(req) ? await renderCardIdentityPng(businessRowSnapshot(props), "s5Og") : await renderOgPng(props);
    sendPng(res, buffer);
  } catch { res.statusCode = 500; res.end(); }
};
