import { createContext, useContext, useEffect, useState } from "react";
import { useColorScheme } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

/** Esquema realmente pintado. Nunca es "system": ya está resuelto. */
export type ThemeMode = "light" | "dark";
/** Lo que el usuario eligió en Ajustes. "system" sigue al dispositivo. */
export type ThemePreference = ThemeMode | "system";

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
  tabBarBg:     "rgba(17,17,24,0.75)",
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
  /** Esquema en uso, ya resuelto contra el dispositivo. */
  mode: ThemeMode;
  /** Elección del usuario: "system" | "light" | "dark". */
  preference: ThemePreference;
  t: ThemeColors;
  setPreference: (p: ThemePreference) => void;
  /** Alterna claro/oscuro fijando la preferencia (deja de seguir al sistema). */
  toggle: () => void;
};

const ThemeContext = createContext<ThemeCtx>({
  mode: "light",
  preference: "system",
  t: LIGHT,
  setPreference: () => {},
  toggle: () => {},
});

const STORAGE_KEY = "@zyncra_theme";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Apariencia del dispositivo. Cambia sola cuando el SO alterna claro/oscuro
  // (ajuste manual o el horario automático de noche), y este hook re-renderiza.
  // Devuelve null si el SO aún no la reporta; se trata como claro.
  const device = useColorScheme();
  // Por defecto seguimos al dispositivo; una cuenta nueva no elige nada.
  const [preference, setPref] = useState<ThemePreference>("system");

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((v) => {
      // Los valores que guardó la versión anterior ("light"/"dark") siguen
      // siendo preferencias válidas: quien ya había elegido, la conserva.
      if (v === "dark" || v === "light" || v === "system") setPref(v);
    });
  }, []);

  const setPreference = (p: ThemePreference) => {
    setPref(p);
    AsyncStorage.setItem(STORAGE_KEY, p);
  };

  const mode: ThemeMode =
    preference === "system" ? (device === "dark" ? "dark" : "light") : preference;

  const toggle = () => setPreference(mode === "light" ? "dark" : "light");

  const t = mode === "dark" ? DARK : LIGHT;

  return (
    <ThemeContext.Provider value={{ mode, preference, t, setPreference, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
