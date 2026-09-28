import { createClient } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";

const SUPABASE_URL = "https://bwmwuzwhinnzkjicdzot.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_rFXMDRiyZSGrL6oaH2uH5g_-n2y-CqI";

/**
 * Tope de tiempo para las consultas y la sesión. En Android el cliente HTTP
 * de React Native no tiene timeouts: si la señal muere a mitad de una
 * consulta, la pantalla se quedaba cargando para siempre en vez de mostrar el
 * error con "Reintentar". Storage (subida de fotos) queda sin tope: una foto
 * grande con mala señal puede tardar más y cortarla sería peor.
 */
const TOPE_MS = 45_000;

function fetchConTope(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const obj = input as { href?: string; url?: string };
  const url = typeof input === "string" ? input : obj.href ?? obj.url ?? String(input);
  if (url.includes("/storage/v1/")) return fetch(input, init);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TOPE_MS);
  const externo = init?.signal;
  const alCancelar = () => ctrl.abort();
  if (externo) {
    if (externo.aborted) ctrl.abort();
    else externo.addEventListener("abort", alCancelar);
  }
  return fetch(input, { ...init, signal: ctrl.signal }).finally(() => {
    clearTimeout(timer);
    externo?.removeEventListener("abort", alCancelar);
  });
}

// La sesión sigue en AsyncStorage: pasarla a expo-secure-store exige instalar
// el módulo nativo (nuevo build) y migrar la sesión guardada, o todos los
// usuarios quedarían deslogueados al actualizar. Pendiente (SEG-19).
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  global: { fetch: fetchConTope },
});
