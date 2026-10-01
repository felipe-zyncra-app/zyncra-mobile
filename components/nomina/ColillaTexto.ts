import { fmtMoneyFull } from "@/lib/format";
import { diaLocalDe, fmtDia } from "@/lib/tz";
import type { Colilla } from "@/lib/nomina";
import { etiquetaTramo } from "./comun";
import { citas, etiquetaNovedad, horaCorta, textoBasico } from "./ResumenTextos";

/**
 * Colilla de pago en texto, para compartirla con Share (WhatsApp, correo,
 * notas). Es la misma información de la colilla imprimible del web
 * (src/app/admin/commissions/colilla.ts), sin archivos de por medio. Los
 * montos son los que guardó el servidor al liquidar.
 */

/** Tope de líneas de citas y ventas: una quincena larga no debe volverse un muro de texto. */
export const MAX_LINEAS_TEXTO = 60;

export function textoColilla(c: Colilla, timeZone: string): string {
  const l = c.liquidacion;
  const d = l.detail;
  const out: string[] = [];
  const negocio = c.negocio.nombre.trim() || "Tu negocio";

  out.push(`*${negocio}* · Colilla de pago`);
  out.push(c.profesional.cargo ? `${c.profesional.nombre} · ${c.profesional.cargo}` : c.profesional.nombre);
  out.push(`Periodo: ${etiquetaTramo({ desde: l.period_start, hasta: l.period_end })}`);
  out.push(`Pagado el ${fmtDia(diaLocalDe(l.paid_at, timeZone), "corto")}`);
  out.push("");

  out.push(`Comisión por servicios (${citas(Number(l.appointments_count) || 0)} · ${fmtMoneyFull(l.service_sales)}): ${fmtMoneyFull(l.service_commission)}`);
  if (Number(l.product_sales) > 0) {
    out.push(`Comisión por productos (${fmtMoneyFull(l.product_sales)}): ${fmtMoneyFull(l.product_commission)}`);
  }
  const b = d?.basico ?? null;
  if (Number(l.base_amount) > 0 || b) {
    const sub = b
      ? ` (${textoBasico(b)}${b.manual ? `, ajustado; calculado ${fmtMoneyFull(b.calculado)}` : ""})`
      : Number(l.base_days) > 0 ? ` (${l.base_days} días)` : "";
    out.push(`Básico${sub}: ${fmtMoneyFull(l.base_amount)}`);
  }
  const novedades = d?.novedades ?? [];
  if (novedades.length > 0) {
    for (const n of novedades) {
      const signo = n.kind === "deduction" ? "−" : "";
      out.push(`${etiquetaNovedad(n)} (${fmtDia(n.entry_date, "dia-mes")}): ${signo}${fmtMoneyFull(n.amount)}`);
    }
  } else {
    // Colilla sin detalle (no debería pasar): al menos los totales de novedades.
    if (Number(l.tips_amount) > 0) out.push(`Propinas: ${fmtMoneyFull(l.tips_amount)}`);
    if (Number(l.bonus_amount) > 0) out.push(`Bonificaciones: ${fmtMoneyFull(l.bonus_amount)}`);
    if (Number(l.deduction_amount) > 0) out.push(`Descuentos y adelantos: −${fmtMoneyFull(l.deduction_amount)}`);
  }
  out.push("");
  const total = Number(l.total_amount) || 0;
  out.push(total < 0
    ? `*Saldo a favor del negocio: ${fmtMoneyFull(Math.abs(total))}*`
    : `*Total pagado: ${fmtMoneyFull(total)}*`);
  if (l.note?.trim()) out.push(`Nota: ${l.note.trim()}`);

  const lineas = d?.lineas ?? [];
  if (lineas.length > 0) {
    out.push("");
    out.push("Citas y ventas:");
    for (const x of lineas.slice(0, MAX_LINEAS_TEXTO)) {
      const hora = horaCorta(x.hora);
      const cuando = `${fmtDia(x.dia, "dia-mes")}${hora ? ` ${hora}` : ""}`;
      const que = `${x.nombre}${x.cantidad > 1 ? ` ×${x.cantidad}` : ""}${x.tipo === "producto" ? " (producto)" : ""}`;
      out.push(`• ${cuando} · ${x.cliente ?? "Sin cliente"} · ${que}: ${fmtMoneyFull(x.valor)} → ${fmtMoneyFull(x.comision)}`);
    }
    if (lineas.length > MAX_LINEAS_TEXTO) {
      const resto = lineas.length - MAX_LINEAS_TEXTO;
      out.push(`… y ${resto} ${resto === 1 ? "línea más" : "líneas más"}.`);
    }
  }

  out.push("");
  out.push(`Generada con Zyncra · ${l.id.slice(0, 8)}`);
  return out.join("\n");
}
