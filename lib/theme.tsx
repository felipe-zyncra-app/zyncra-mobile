import { createContext, useContext, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type ThemeMode = "light" | "dark";

const LIGHT = {
  bg:           "#F4F4F9",
  bgAlt:        "#FFFFFF",
  // Cards sólidas estilo portal web (antes glass): blanco + borde hairline
  card:         "#FFFFFF",
  cardBorder:   "rgba(20,15,30,0.08)",
  cardSoft:     "#FFFFFF",
  cardSoftBorder: "rgba(20,15,30,0.08)",
  text:         "#14111C",
  muted:        "#564E66",
  subtle:       "#8E879B",
  border:       "rgba(20,15,30,0.08)",
  divider:      "rgba(20,15,30,0.08)",
  inputBg:      "#FFFFFF",
  inputBorder:  "rgba(20,15,30,0.12)",
  bottomBar:    "rgba(244,244,249,0.85)",
  bottomBorder: "rgba(255,255,255,0.6)",
  tabBarBg:     "rgba(255,255,255,0.55)",
  tabBarBorder: "rgba(255,255,255,0.6)",
  // ── Tokens estilo portal web (tinta sobre lienzo claro) ──
  canvas:       "#F4F4F9",
  cardSolid:    "#FFFFFF",
  line:         "rgba(20,15,30,0.08)",
  lineStrong:   "rgba(20,15,30,0.16)",
  ink:          "#14111C",
  chipBg:       "rgba(20,15,30,0.04)",
  trackBg:      "rgba(20,15,30,0.06)",
  blurTint:     "light" as const,
  statusBar:    "dark" as const,
};

const DARK = {
  bg:           "#0D0D14",
  bgAlt:        "#16161F",
  // Cards sólidas sobre la base de la sidebar oscura del web
  card:         "#16161F",
  cardBorder:   "rgba(255,255,255,0.08)",
  cardSoft:     "#16161F",
  cardSoftBorder: "rgba(255,255,255,0.08)",
  text:         "#F0EFF4",
  muted:        "#9B95A8",
  subtle:       "#6B6580",
  border:       "rgba(255,255,255,0.08)",
  divider:      "rgba(255,255,255,0.06)",
  inputBg:      "#16161F",
  inputBorder:  "rgba(255,255,255,0.12)",
  bottomBar:    "rgba(13,13,20,0.92)",
  bottomBorder: "rgba(255,255,255,0.08)",
  tabBarBg:     "rgba(22,22,31,0.75)",
  tabBarBorder: "rgba(255,255,255,0.08)",
  // ── Tokens estilo portal web, mapeados sobre la sidebar oscura (#0C0C14) ──
  canvas:       "#0D0D14",
  cardSolid:    "#16161F",
  line:         "rgba(255,255,255,0.08)",
  lineStrong:   "rgba(255,255,255,0.16)",
  ink:          "#F0EFF4",
  chipBg:       "rgba(255,255,255,0.06)",
  trackBg:      "rgba(255,255,255,0.08)",
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
