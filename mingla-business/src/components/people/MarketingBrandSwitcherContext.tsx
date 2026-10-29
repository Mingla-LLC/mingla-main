import React from "react";
import type { MarketingAction } from "../marketing/MarketingActionContext";

type MarketingShellValue = readonly [
  openBrandSwitcher: () => void,
  registerAction: (action: MarketingAction) => () => void,
];

const MarketingBrandSwitcherContext=React.createContext<MarketingShellValue|null>(null);
export const MarketingBrandSwitcherProvider=MarketingBrandSwitcherContext.Provider;
export function useMarketingBrandSwitcher():()=>void{
  return React.useContext(MarketingBrandSwitcherContext)?.[0]??(()=>{});
}

/** Tiny bridge keeps lazy program screens from hoisting the action owner into __common. */
export function useMarketingActionRegistration(action:MarketingAction|null):void{
  const shell=React.useContext(MarketingBrandSwitcherContext);
  React.useEffect(()=>{
    if(action)return shell?.[1](action);
  },[action,shell]);
}
