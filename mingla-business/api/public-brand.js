const { firstQueryValue, handlePublicSearchDocument } = require("../server/publicSearchDocument");

module.exports = async function publicBrandHandler(req, res) {
  const brandSlug = firstQueryValue(req.query.brandSlug);
  return handlePublicSearchDocument({ req, res, kind: "brand", slugs: [brandSlug] });
};
