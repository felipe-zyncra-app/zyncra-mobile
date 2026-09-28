import { Alert } from "react-native";
import { Colors } from "@/constants/theme";

/** Cita tal como la leen la Agenda y sus modales. */
export type ApptAgenda = {
  id: string;
  appointment_date: string;
  appointment_time: string;
  status: string;
  service_id: string | null;
  client_id: string | null;
  professional_id: string | null;
  location_id?: string | null;
  clients: { name: string; phone?: string | null } | null;
  services: { name: string; price?: number | null; duration_minutes?: number | null; duration_min?: number | null } | null;
  professionals: { id: string; name: string } | null;
  /** Servicios adicionales de la cita: cuentan en el precio a cobrar (DIN-23). */
  appointment_services?: { price: number | string | null }[] | null;
};

/** Fila de blocked_slots: ausencia de un profesional o cierre del negocio (professional_id null). */
export type BloqueoAgenda = {
  id: string;
  start_time: string;
  end_time: string;
  professional_id: string | null;
  reason: string | null;
};

/** Cobro (pos_sales) de una cita. */
export type VentaCita = { id: string; total: number };

export const PRO_PALETTE = ["#e11d48", "#7c3aed", "#0284c7", "#059669", "#d97706", "#db2777"];

export function proColor(id: string, list: { id: string }[]): string {
  const idx = list.findIndex(p => p.id === id);
  return idx < 0 ? Colors.subtle : PRO_PALETTE[idx % PRO_PALETTE.length];
}

export function proInitials(name: string): string {
  return name.split(" ").filter(Boolean).map(w => w[0]).join("").slice(0, 2).toUpperCase();
}

/** Alert de dos botones como promesa: true si el usuario confirma. */
export function confirmar(titulo: string, mensaje: string, textoOk = "Continuar", destructivo = false): Promise<boolean> {
  return new Promise(resolve => {
    Alert.alert(titulo, mensaje, [
      { text: "Cancelar", style: "cancel", onPress: () => resolve(false) },
      { text: textoOk, style: destructivo ? "destructive" : "default", onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}
