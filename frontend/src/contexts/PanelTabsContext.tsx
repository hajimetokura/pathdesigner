import { createContext, useContext } from "react";
import type { PanelTab } from "../components/SidePanel";

export interface PanelTabsContextValue {
  openTab: (tab: PanelTab) => void;
  updateTab: (tab: PanelTab) => void;
  closeTab: (tabId: string) => void;
}

export const PanelTabsContext = createContext<PanelTabsContextValue | null>(null);

export function usePanelTabs(): PanelTabsContextValue {
  const ctx = useContext(PanelTabsContext);
  if (!ctx) throw new Error("usePanelTabs must be used within PanelTabsContext.Provider");
  return ctx;
}
