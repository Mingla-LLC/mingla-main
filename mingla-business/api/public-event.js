const { firstQueryValue, handlePublicSearchDocument } = require("../server/publicSearchDocument");

module.exports = async function publicEventHandler(req, res) {
  const brandSlug = firstQueryValue(req.query.brandSlug);
  const eventSlug = firstQueryValue(req.query.eventSlug);
  return handlePublicSearchDocument({ req, res, kind: "event", slugs: [brandSlug, eventSlug] });
};
