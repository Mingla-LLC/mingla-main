const { fetchPublicVenueBySlug, firstQueryValue, renderVenueHtml, renderNotFoundHtml, sendHtml } = require("../server/socialPreview");
module.exports = async function publicVenueHandler(req, res) {
  const brandSlug = firstQueryValue(req.query.brandSlug);
  const venueSlug = firstQueryValue(req.query.venueSlug);
  if (typeof brandSlug !== "string" || typeof venueSlug !== "string") return sendHtml(res, renderNotFoundHtml("Venue not found"), 404);
  try {
    const venue = await fetchPublicVenueBySlug(brandSlug, venueSlug);
    if (!venue) return sendHtml(res, renderNotFoundHtml("Venue not found"), 404);
    return sendHtml(res, renderVenueHtml(venue));
  } catch { res.statusCode = 500; res.end("Mingla public venue preview could not load."); }
};
