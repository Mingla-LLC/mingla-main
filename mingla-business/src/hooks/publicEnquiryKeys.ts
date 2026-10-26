// #4111 — buyer-side enquiry query keys (the host inbox keeps its own keys).
export const publicEnquiryKeys = {
  profile: (brandId: string) => ["buyerBrand", "enquiryProfile", brandId] as const,
  myPlans: (brandId: string, userId: string) =>
    ["buyerBrand", "enquiryMyPlans", brandId, userId] as const,
  brandIdentity: (slug: string) => ["buyerBrand", "enquiryIdentity", slug] as const,
  guestThread: (token: string) => ["buyerEnquiry", "guestThread", token] as const,
};
