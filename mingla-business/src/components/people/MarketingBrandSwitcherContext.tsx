import React from "react";

const MarketingBrandSwitcherContext=React.createContext<(()=>void)|null>(null);
export const MarketingBrandSwitcherProvider=MarketingBrandSwitcherContext.Provider;
export function useMarketingBrandSwitcher():()=>void{
  const open=React.useContext(MarketingBrandSwitcherContext);
  return open??(()=>{});
}
