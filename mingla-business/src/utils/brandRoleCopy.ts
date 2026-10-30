import type { BrandRole } from "./brandRole";

/** Team-route presentation copy, separated from the eager role/rank authority. */
export const roleDisplayName = (role: BrandRole): string => {
  switch (role) {
    case "brand_owner":
      return "Brand owner";
    case "brand_admin":
      return "Brand admin";
    case "event_manager":
      return "Event manager";
    case "finance_manager":
      return "Finance manager";
    case "marketing_manager":
      return "Marketing manager";
    case "scanner":
      return "Scanner";
    case "venue_staff":
      return "Venue staff";
    default: {
      const _exhaust: never = role;
      return _exhaust;
    }
  }
};

export const roleDescription = (role: BrandRole): string => {
  switch (role) {
    case "brand_owner":
      return "Full control of the account, brands, and billing.";
    case "brand_admin":
      return "Manage brand settings, team, offerings, and finances.";
    case "event_manager":
      return "Create and edit events; manage tickets and scanners.";
    case "finance_manager":
      return "View and refund orders; manage payouts.";
    case "marketing_manager":
      return "Edit brand profile and public pages.";
    case "scanner":
      return "Scan tickets at the door (event-scoped).";
    case "venue_staff":
      return "Access only the selected venues and capabilities assigned by an admin.";
    default: {
      const _exhaust: never = role;
      return _exhaust;
    }
  }
};
