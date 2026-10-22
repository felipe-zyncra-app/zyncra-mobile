import { useEffect, useRef, useState } from "react";
import { Alert, AppState } from "react-native";
import * as Updates from "expo-updates";
import { debeAvisar, sePuedeRevisar } from "@/lib/actualizaciones";

/**
 * Avisa cuando hay una versión nueva descargada y la aplica si el dueño quiere.
 *
 * expo-updates ya revisa el servidor al arrancar y descarga lo nuevo, pero lo
 * aplicaba solo en el SIGUIENTE arranque, sin decir nada: el dueño abría la
 * app, no veía los cambios y creía que no se habían publicado (22-oct-2026).
 * Ahora: al arrancar (pasada la apertura) y cada vez que la app vuelve a
 * primer plano se revisa de nuevo (máx. cada 5 min), y apenas hay una
 * descargada se ofrece "Actualizar ahora". "Luego" no insiste: se aplica sola
 * en el próximo arranque, como antes.
 *
 * En desarrollo y en Expo Go expo-updates no está habilitado: no hace nada.
 */

/** Deja pasar la apertura de marca antes de revisar o de preguntar. */
const ESPERA_ARRANQUE_MS = 4000;

export type ResultadoBusqueda = "descargada" | "al_dia" | "sin_red" | "no_disponible";

/** Revisa el servidor y descarga lo nuevo. Quien la llama decide qué decir. */
export async function buscarActualizacion(): Promise<ResultadoBusqueda> {
  if (!Updates.isEnabled || __DEV__) return "no_disponible";
  try {
    const r = await Updates.checkForUpdateAsync();
    if (!r.isAvailable) return "al_dia";
    const f = await Updates.fetchUpdateAsync();
    return f.isNew || f.isRollBackToEmbedded ? "descargada" : "al_dia";
  } catch {
    return "sin_red";
  }
}

export default function AvisoActualizacion() {
  const { isUpdatePending, downloadedUpdate } = Updates.useUpdates();
  const activo = Updates.isEnabled && !__DEV__;
  const avisada = useRef<string | null>(null);
  const ultimaRevision = useRef<number | null>(null);
  const [listo, setListo] = useState(false);

  // Revisar al arrancar (tras la apertura) y al volver a primer plano.
  useEffect(() => {
    if (!activo) return;
    const revisar = () => {
      const ahora = Date.now();
      if (!sePuedeRevisar(ultimaRevision.current, ahora)) return;
      ultimaRevision.current = ahora;
      buscarActualizacion().catch(() => {});
    };
    const t = setTimeout(() => { setListo(true); revisar(); }, ESPERA_ARRANQUE_MS);
    const sub = AppState.addEventListener("change", s => { if (s === "active") revisar(); });
    return () => { clearTimeout(t); sub.remove(); };
  }, [activo]);

  // Hay una descargada (por el arranque automático o por revisar): ofrecerla.
  const idDescargada = downloadedUpdate?.updateId ?? null;
  useEffect(() => {
    if (!activo || !listo) return;
    if (!debeAvisar({ pendiente: isUpdatePending, idDescargada, yaAvisada: avisada.current })) return;
    avisada.current = idDescargada ?? "rollback";
    Alert.alert(
      "Hay una versión nueva de Zyncra",
      "Ya se descargó. ¿La aplicas ahora? La app se reinicia y tarda un segundo.",
      [
        { text: "Luego", style: "cancel" },
        { text: "Actualizar ahora", onPress: () => { Updates.reloadAsync().catch(() => {}); } },
      ],
    );
  }, [activo, listo, isUpdatePending, idDescargada]);

  return null;
}
