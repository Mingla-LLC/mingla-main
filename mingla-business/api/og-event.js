const {
  buildEventOgCardProps,
  fetchPublicEventById,
  firstQueryValue,
  renderOgPng,
  sendPng,
} = require("../server/socialPreview");
const { businessRowSnapshot, renderCardIdentityPng, useDirectionC } = require("../server/cardIdentityRenderer");

module.exports = async function eventOgHandler(req, res) {
  const eventId = firstQueryValue(req.query.eventId);

  try {
    const event =
      typeof eventId === "string" ? await fetchPublicEventById(eventId) : null;
    const props = buildEventOgCardProps(event);
    if (!props.coverUrl) { res.statusCode = 404; return res.end(); }
    const buffer = useDirectionC(req) ? await renderCardIdentityPng(businessRowSnapshot(props), "s5Og") : await renderOgPng(props);
    sendPng(res, buffer);
  } catch { res.statusCode = 500; res.end(); }
};
