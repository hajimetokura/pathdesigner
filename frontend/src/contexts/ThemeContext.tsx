import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

export type ThemeName = "clean" | "terracotta";

interface ThemeContextValue {
  theme: ThemeName;
  setTheme: (t: ThemeName) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "clean",
  setTheme: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

const STORAGE_KEY = "pathdesigner-theme";

// Set data-theme before first render to avoid FOUC
const initTheme = (): ThemeName => {
  const saved = localStorage.getItem(STORAGE_KEY);
  const t: ThemeName = saved === "terracotta" ? "terracotta" : "clean";
  document.documentElement.setAttribute("data-theme", t);
  return t;
};

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeName>(initTheme);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme: setThemeState }}>
      {children}
    </ThemeContext.Provider>
  );
}
