const {
  fetchPublicBrandBySlug,
  firstQueryValue,
  renderBrandHtml,
  renderNotFoundHtml,
  sendHtml,
} = require("../server/socialPreview");

module.exports = async function publicBrandHandler(req, res) {
  const brandSlug = firstQueryValue(req.query.brandSlug);

  if (typeof brandSlug !== "string") {
    sendHtml(res, renderNotFoundHtml("Brand not found"), 404);
    return;
  }

  try {
    const rows = await fetchPublicBrandBySlug(brandSlug);
    if (rows.length === 0) {
      sendHtml(res, renderNotFoundHtml("Brand not found"), 404);
      return;
    }
    sendHtml(res, renderBrandHtml(rows));
  } catch {
    res.statusCode = 500;
    res.setHeader("content-type", "text/plain; charset=utf-8");
    res.end("Mingla public brand preview could not load.");
  }
};
