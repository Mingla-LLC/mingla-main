/**
 * Shared async target for every Stripe Connect web route.
 *
 * ORCH-1085: Expo Router async route splitting hoists modules imported by
 * multiple route chunks into the eager __common chunk. The five Connect route
 * shells therefore import this one shared async target instead of importing
 * their bodies independently, keeping @stripe/connect-js and
 * @stripe/react-connect-js out of the phone boot path.
 */

export { default as ConnectAccountManagementBody } from "./ConnectAccountManagementBody.web";
export { default as ConnectOnboardingBody } from "./ConnectOnboardingBody.web";
export { default as ConnectPartnerAccountManagementBody } from "./ConnectPartnerAccountManagementBody.web";
export { default as ConnectPartnerOnboardingBody } from "./ConnectPartnerOnboardingBody.web";
export { default as ConnectTaxRegistrationsBody } from "./ConnectTaxRegistrationsBody.web";
