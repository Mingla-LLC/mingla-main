const { firstQueryValue, handlePublicSearchDocument } = require("../server/publicSearchDocument");
module.exports = async function publicVenueHandler(req, res) {
  const brandSlug = firstQueryValue(req.query.brandSlug);
  const venueSlug = firstQueryValue(req.query.venueSlug);
  return handlePublicSearchDocument({ req, res, kind: "venue", slugs: [brandSlug, venueSlug] });
};
