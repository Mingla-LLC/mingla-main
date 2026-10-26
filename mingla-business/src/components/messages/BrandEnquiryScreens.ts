/**
 * #4111 — the one module behind LazyBrandEnquiryScreens. Both enquiry screens
 * come from here, so the Messages list and the enquiry thread share ONE lazy
 * chunk and their display and service code never hoists into `__common`.
 */

export { BrandEnquiryListSection } from "./BrandEnquiryListSection";
export { BrandEnquiryThreadScreen } from "./BrandEnquiryThreadScreen";
