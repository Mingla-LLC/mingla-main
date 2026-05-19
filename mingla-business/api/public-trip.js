const {
  fetchPublicTripBySlug,
  firstQueryValue,
  renderTripHtml,
  renderNotFoundHtml,
  sendHtml,
} = require("../server/socialPreview");

module.exports = async function publicTripHandler(req, res) {
  const brandSlug = firstQueryValue(req.query.brandSlug);
  const tripSlug = firstQueryValue(req.query.tripSlug);

  if (typeof brandSlug !== "string" || typeof tripSlug !== "string") {
    sendHtml(res, renderNotFoundHtml("Trip not found"), 404);
    return;
  }

  try {
    const trip = await fetchPublicTripBySlug(brandSlug, tripSlug);
    if (trip === null) {
      sendHtml(res, renderNotFoundHtml("Trip not found"), 404);
      return;
    }
    sendHtml(res, renderTripHtml(trip));
  } catch {
    res.statusCode = 500;
    res.setHeader("content-type", "text/plain; charset=utf-8");
    res.end("Mingla public trip preview could not load.");
  }
};
