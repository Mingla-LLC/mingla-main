const { firstQueryValue, handlePublicSearchDocument } = require("../server/publicSearchDocument");

module.exports = async function publicExperienceHandler(req, res) {
  const brandSlug = firstQueryValue(req.query.brandSlug);
  const experienceSlug = firstQueryValue(req.query.experienceSlug);
  return handlePublicSearchDocument({ req, res, kind: "experience", slugs: [brandSlug, experienceSlug] });
};
