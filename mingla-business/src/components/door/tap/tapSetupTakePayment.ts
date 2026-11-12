/**
 * #4389 — "Take a payment" on "On for this brand". The door-sale helper (and
 * the event list it reads) loads on demand, as Home's Take a payment does, so
 * the setup screen's chunk stays small.
 */
interface RouterLike {
  push: (href: never) => void;
}

export const loadHasDoorSaleEvent = async (brandId: string): Promise<boolean> => {
  const { hasDoorSaleEvent } = await import("../../../utils/openDoorSale");
  return hasDoorSaleEvent(brandId);
};

export const openDoorSaleFromTapSetup = async (router: RouterLike, brandId: string): Promise<void> => {
  const { openDoorSale } = await import("../../../utils/openDoorSale");
  await openDoorSale(router, brandId, null, { source: "tap_setup" });
};
