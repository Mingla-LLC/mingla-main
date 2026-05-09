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
    const rows =
      typeof brandSlug === "string" ? await fetchPublicBrandBySlug(brandSlug) : [];
    const buffer = await renderOgPng(buildBrandOgCardProps(rows));
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
