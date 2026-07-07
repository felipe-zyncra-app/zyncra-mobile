import { createContext, useContext, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type ThemeMode = "light" | "dark";

const LIGHT = {
  bg:           "#F4F4F9",
  bgAlt:        "#FFFFFF",
  card:         "rgba(255,255,255,0.72)",
  cardBorder:   "rgba(255,255,255,0.75)",
  cardSoft:     "rgba(255,255,255,0.55)",
  cardSoftBorder: "rgba(255,255,255,0.6)",
  text:         "#14111C",
  muted:        "#564E66",
  subtle:       "#8E879B",
  border:       "rgba(20,15,30,0.08)",
  divider:      "rgba(20,15,30,0.08)",
  inputBg:      "rgba(255,255,255,0.72)",
  inputBorder:  "rgba(255,255,255,0.75)",
  bottomBar:    "rgba(244,244,249,0.85)",
  bottomBorder: "rgba(255,255,255,0.6)",
  tabBarBg:     "rgba(255,255,255,0.55)",
  tabBarBorder: "rgba(255,255,255,0.6)",
  blurTint:     "light" as const,
  statusBar:    "dark" as const,
};

const DARK = {
  bg:           "#09090F",
  bgAlt:        "#111118",
  card:         "rgba(255,255,255,0.08)",
  cardBorder:   "rgba(255,255,255,0.10)",
  cardSoft:     "rgba(255,255,255,0.05)",
  cardSoftBorder: "rgba(255,255,255,0.08)",
  text:         "#F0EFF4",
  muted:        "#9B95A8",
  subtle:       "#6B6580",
  border:       "rgba(255,255,255,0.08)",
  divider:      "rgba(255,255,255,0.06)",
  inputBg:      "rgba(255,255,255,0.07)",
  inputBorder:  "rgba(255,255,255,0.10)",
  bottomBar:    "rgba(9,9,15,0.92)",
  bottomBorder: "rgba(255,255,255,0.08)",
  tabBarBg:     "rgba(17,17,24,0.75)",
  tabBarBorder: "rgba(255,255,255,0.08)",
  blurTint:     "dark" as const,
  statusBar:    "light" as const,
};

export type ThemeColors = Omit<typeof LIGHT, "blurTint" | "statusBar"> & {
  blurTint: "light" | "dark";
  statusBar: "dark" | "light";
};

type ThemeCtx = {
  mode: ThemeMode;
  t: ThemeColors;
  toggle: () => void;
};

const ThemeContext = createContext<ThemeCtx>({
  mode: "light",
  t: LIGHT,
  toggle: () => {},
});

const STORAGE_KEY = "@zyncra_theme";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>("light");

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((v) => {
      if (v === "dark" || v === "light") setMode(v);
    });
  }, []);

  const toggle = () => {
    const next = mode === "light" ? "dark" : "light";
    setMode(next);
    AsyncStorage.setItem(STORAGE_KEY, next);
  };

  const t = mode === "dark" ? DARK : LIGHT;

  return (
    <ThemeContext.Provider value={{ mode, t, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
