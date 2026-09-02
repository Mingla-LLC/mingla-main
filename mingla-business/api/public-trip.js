const { firstQueryValue, handlePublicSearchDocument } = require("../server/publicSearchDocument");

module.exports = async function publicTripHandler(req, res) {
  const brandSlug = firstQueryValue(req.query.brandSlug);
  const tripSlug = firstQueryValue(req.query.tripSlug);
  return handlePublicSearchDocument({ req, res, kind: "trip", slugs: [brandSlug, tripSlug] });
};
