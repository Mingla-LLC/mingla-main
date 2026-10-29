/**
 * #4168 — one action contract for every Blast tab.
 *
 * The compact button beside the tabs and the mobile floating button consume
 * the same descriptor, so labels, icons, destinations and accessibility names
 * cannot drift apart. Stateful tabs can temporarily register a local action
 * (for example Referrals opening its offer sheet) without creating another
 * independent button implementation.
 */
import React from "react";
import { usePathname, useRouter } from "expo-router";

import {
  detectMarketingSubNavActive,
  type MarketingSubNavId,
} from "./marketingSubNavTabs";
import {
  MARKETING_TAB_ACTIONS,
  type MarketingActionDefinition,
} from "./marketingTabActions";
export { MARKETING_TAB_ACTIONS } from "./marketingTabActions";

export interface MarketingAction extends Omit<MarketingActionDefinition, "href"> {
  id: string;
  onPress: () => void;
}
type RegisteredAction = {
  tab: MarketingSubNavId;
  token: symbol;
  action: MarketingAction;
};

interface MarketingActionContextValue {
  activeTab: MarketingSubNavId;
  action: MarketingAction;
  register: (action: MarketingAction) => () => void;
}
const MarketingActionContext = React.createContext<MarketingActionContextValue | null>(
  null,
);

export function MarketingActionProvider({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const pathname = usePathname();
  const router = useRouter();
  const activeTab = detectMarketingSubNavActive(pathname);
  const [registered, setRegistered] = React.useState<RegisteredAction | null>(null);
  const definition = MARKETING_TAB_ACTIONS[activeTab];
  const fallback = React.useMemo<MarketingAction>(
    () => ({
      id: `blast-${activeTab}`,
      label: definition.label,
      compactLabel: definition.compactLabel,
      icon: definition.icon,
      onPress: () => router.push(definition.href as never),
    }),
    [activeTab, definition, router],
  );
  const register = React.useCallback(
    (action: MarketingAction): (() => void) => {
      const token = Symbol(action.id);
      setRegistered({ tab: activeTab, token, action });
      return () => {
        setRegistered((current) =>
          current?.token === token ? null : current,
        );
      };
    },
    [activeTab],
  );
  const value = React.useMemo<MarketingActionContextValue>(
    () => ({
      activeTab,
      action:
        registered?.tab === activeTab ? registered.action : fallback,
      register,
    }),
    [activeTab, fallback, register, registered],
  );
  return (
    <MarketingActionContext.Provider value={value}>
      {children}
    </MarketingActionContext.Provider>
  );
}

export function useMarketingAction(): MarketingAction {
  const value = React.useContext(MarketingActionContext);
  if (!value) {
    throw new Error("useMarketingAction must be used inside MarketingActionProvider");
  }
  return value.action;
}

export function useMarketingActionRegistrar(): MarketingActionContextValue["register"] {
  const value = React.useContext(MarketingActionContext);
  if (!value) {
    throw new Error("useMarketingActionRegistrar must be used inside MarketingActionProvider");
  }
  return value.register;
}
