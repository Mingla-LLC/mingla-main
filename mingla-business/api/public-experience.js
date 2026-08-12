const {
  fetchPublicExperienceBySlug,
  firstQueryValue,
  renderExperienceHtml,
  renderNotFoundHtml,
  sendHtml,
} = require("../server/socialPreview");

module.exports = async function publicExperienceHandler(req, res) {
  const brandSlug = firstQueryValue(req.query.brandSlug);
  const experienceSlug = firstQueryValue(req.query.experienceSlug);

  if (typeof brandSlug !== "string" || typeof experienceSlug !== "string") {
    sendHtml(res, renderNotFoundHtml("Experience not found"), 404);
    return;
  }

  try {
    const experience = await fetchPublicExperienceBySlug(
      brandSlug,
      experienceSlug,
    );
    if (experience === null) {
      sendHtml(res, renderNotFoundHtml("Experience not found"), 404);
      return;
    }
    sendHtml(res, renderExperienceHtml(experience));
  } catch {
    res.statusCode = 500;
    res.setHeader("content-type", "text/plain; charset=utf-8");
    res.end("Mingla public experience preview could not load.");
  }
};
