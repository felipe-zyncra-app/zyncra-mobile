import type { ComponentProps } from "react";
import type { Ionicons } from "@expo/vector-icons";

/**
 * Métodos de pago: nombre, ícono y color, en UN solo lugar. Antes la hoja de
 * cobro y el Panel tenían tablas distintas (Nequi salía verde agua en Cobros y
 * azul en el Panel; Tarjeta y Transferencia compartían color, y Nequi llevaba
 * el ícono de WhatsApp).
 */

type IoniconName = ComponentProps<typeof Ionicons>["name"];

export type MedioPago = { key: string; label: string; icon: IoniconName; color: string };

/** Los que ofrece la hoja de cobro, en este orden. */
export const MEDIOS: readonly MedioPago[] = [
  { key: "efectivo",      label: "Efectivo",      icon: "cash-outline",            color: "#10b981" },
  { key: "tarjeta",       label: "Tarjeta",       icon: "card-outline",            color: "#6366f1" },
  { key: "transferencia", label: "Transferencia", icon: "swap-horizontal-outline", color: "#06b6d4" },
  { key: "nequi",         label: "Nequi",         icon: "phone-portrait-outline",  color: "#db2777" },
  { key: "daviplata",     label: "Daviplata",     icon: "wallet-outline",          color: "#f59e0b" },
  { key: "qr",            label: "QR",            icon: "qr-code-outline",         color: "#8b5cf6" },
];

/** Venta con pago dividido: payment_method = "mixto" y el detalle en `payments`. */
// Gris medio: se lee sobre la tarjeta clara y sobre la oscura.
export const MEDIO_DIVIDIDO: MedioPago = { key: "mixto", label: "Dividido", icon: "layers-outline", color: "#64748b" };

export const MEDIO_OTRO: MedioPago = { key: "otro", label: "Otro", icon: "ellipsis-horizontal-circle-outline", color: "#736C82" };

/** El método si se conoce (incluye "mixto" y "otro"); undefined si no. */
export function medioDePago(key: string | null | undefined): MedioPago | undefined {
  if (key === MEDIO_DIVIDIDO.key) return MEDIO_DIVIDIDO;
  if (key === MEDIO_OTRO.key) return MEDIO_OTRO;
  return MEDIOS.find(m => m.key === key);
}

/**
 * Siempre devuelve algo que pintar: un método que el POS no conoce (lo trae
 * el portal o un dato viejo) sale con su propio nombre y el ícono de "Otro",
 * en vez de desaparecer.
 */
export function medioOGenerico(key: string | null | undefined): MedioPago {
  const conocido = medioDePago(key);
  if (conocido) return conocido;
  const k = (key ?? "").trim();
  if (!k) return MEDIO_OTRO;
  return { ...MEDIO_OTRO, key: k, label: k.charAt(0).toUpperCase() + k.slice(1) };
}
