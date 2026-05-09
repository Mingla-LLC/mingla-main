const {
  buildBrandOgCardProps,
  fetchPublicBrandBySlug,
  firstQueryValue,
  renderOgPng,
  sendPng,
} = require("../server/socialPreview");

module.exports = async function brandOgHandler(req, res) {
  const brandSlug = firstQueryValue(req.query.brandSlug);

  try {
    const publicBrand =
      typeof brandSlug === "string" ? await fetchPublicBrandBySlug(brandSlug) : null;
    const buffer = await renderOgPng(buildBrandOgCardProps(publicBrand));
    sendPng(res, buffer);
  } catch {
    const buffer = await renderOgPng({
      cardKind: "brand",
      title: "Mingla Business",
      subtitle: "Create and share events on Mingla.",
      kicker: "Mingla Business",
      coverUrl: null,
      eventCountLabel: "0 events",
      nextEventLabel: "",
    });
    sendPng(res, buffer);
  }
};
