import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

export type LayoutDirection = "TB" | "LR";

interface LayoutDirectionContextValue {
  direction: LayoutDirection;
  setDirection: (d: LayoutDirection) => void;
}

const LayoutDirectionContext = createContext<LayoutDirectionContextValue>({
  direction: "TB",
  setDirection: () => {},
});

export function useLayoutDirection() {
  return useContext(LayoutDirectionContext);
}

const STORAGE_KEY = "pathdesigner-layout-direction";

const initDirection = (): LayoutDirection => {
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved === "LR" ? "LR" : "TB";
};

export function LayoutDirectionProvider({ children }: { children: ReactNode }) {
  const [direction, setDirectionState] = useState<LayoutDirection>(initDirection);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, direction);
  }, [direction]);

  return (
    <LayoutDirectionContext.Provider value={{ direction, setDirection: setDirectionState }}>
      {children}
    </LayoutDirectionContext.Provider>
  );
}
