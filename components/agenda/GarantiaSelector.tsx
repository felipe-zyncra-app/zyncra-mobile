import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { View, Text, TextInput, TouchableOpacity, Switch, ActivityIndicator, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { Colors, Fonts, Radius } from "@/constants/theme";
import { useTheme, type ThemeColors } from "@/lib/theme";
import { fmtDia } from "@/lib/tz";
import { mensajeError } from "@/lib/db";
import { useGuardRespuestas } from "@/lib/useRecarga";

/** Lo que el modal guarda en la cita (is_warranty, warranty_of, warranty_reason). */
export type Garantia = {
  activa: boolean;
  /** Cita que se repara. */
  originalId: string | null;
  motivo: string;
  /** El cliente tiene citas anteriores: entonces hay que elegir cuál se repara. */
  hayCitas: boolean;
};

export const SIN_GARANTIA: Garantia = { activa: false, originalId: null, motivo: "", hayCitas: false };

/** ¿Se puede seguir? Con citas anteriores, la original es obligatoria. */
export function garantiaLista(g: Garantia): boolean {
  return !g.activa || !g.hayCitas || g.originalId !== null;
}

type CitaPrevia = {
  id: string;
  appointment_date: string;
  service_id: string | null;
  services: { name: string } | null;
  professionals: { name: string } | null;
};

/**
 * "Es garantía" en Nueva cita: se repara sin costo un servicio anterior (se
 * dañó una uña, se soltó un aplique…). Se elige la cita original entre las
 * últimas del cliente; al elegirla se propone su mismo servicio.
 */
export default function GarantiaSelector({ tenantId, clientId, hoy, value, onChange, onServicio }: {
  tenantId: string;
  /** null = cliente nuevo (no tiene citas que reparar). */
  clientId: string | null;
  hoy: string;
  value: Garantia;
  onChange: Dispatch<SetStateAction<Garantia>>;
  onServicio: (serviceId: string) => void;
}) {
  const { t } = useTheme();
  const s = useMemo(() => crearEstilos(t), [t]);
  const guard = useGuardRespuestas();
  const [citas, setCitas] = useState<CitaPrevia[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [intento, setIntento] = useState(0);

  const activa = value.activa && !!clientId;
  useEffect(() => {
    if (!activa || !clientId) return;
    const turno = guard.nuevo();
    setCitas(null);
    setError(null);
    supabase.from("appointments")
      .select("id, appointment_date, service_id, services(name), professionals(name)")
      .eq("tenant_id", tenantId).eq("client_id", clientId)
      .neq("status", "cancelled").neq("status", "no_show")
      .lte("appointment_date", hoy)
      .order("appointment_date", { ascending: false }).order("appointment_time", { ascending: false })
      .limit(12)
      .then(({ data, error: e }) => {
        if (!turno.vigente()) return;
        if (e) { setError(e); return; }
        const lista = (data ?? []) as unknown as CitaPrevia[];
        setCitas(lista);
        onChange(g => ({ ...g, hayCitas: lista.length > 0 }));
      });
  }, [onChange, activa, clientId, tenantId, hoy, intento, guard]);

  const elegir = (c: CitaPrevia) => {
    onChange(g => ({ ...g, originalId: c.id }));
    if (c.service_id) onServicio(c.service_id);
  };

  return (
    <View style={[s.card, activa && { borderColor: "rgba(124,58,237,0.45)" }]}>
      <View style={s.fila}>
        <View style={s.icono}><Ionicons name="shield-checkmark-outline" size={18} color={MORADO} /></View>
        <View style={{ flex: 1 }}>
          <Text style={s.titulo}>Es una garantía</Text>
          <Text style={s.sub}>
            {clientId ? "Reparación sin costo de un servicio anterior. Se cobra en $0 y no genera comisión."
              : "Solo para clientes que ya tienen citas: elige uno existente en el paso anterior."}
          </Text>
        </View>
        <Switch
          value={activa}
          disabled={!clientId}
          onValueChange={v => onChange(v ? { ...SIN_GARANTIA, activa: true } : SIN_GARANTIA)}
          trackColor={{ true: MORADO, false: t.line }}
          accessibilityLabel="Es una garantía"
        />
      </View>

      {activa && (
        <View style={{ marginTop: 12, gap: 8 }}>
          <Text style={s.label}>¿Qué cita se repara?</Text>
          {error ? (
            <TouchableOpacity onPress={() => setIntento(i => i + 1)} accessibilityRole="button">
              <Text style={[s.sub, { color: Colors.red }]}>No se pudieron cargar sus citas. {mensajeError(error)} Toca para reintentar.</Text>
            </TouchableOpacity>
          ) : !citas ? (
            <ActivityIndicator color={MORADO} style={{ paddingVertical: 8 }} />
          ) : citas.length === 0 ? (
            <Text style={s.sub}>El cliente no tiene citas anteriores. Se guarda la garantía sin ligarla a otra cita.</Text>
          ) : citas.map(c => {
            const on = value.originalId === c.id;
            return (
              <TouchableOpacity
                key={c.id}
                style={[s.cita, on && s.citaOn]}
                onPress={() => elegir(c)}
                activeOpacity={0.75}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[s.citaNombre, on && { color: MORADO }]} numberOfLines={1}>{c.services?.name ?? "Sin servicio"}</Text>
                  <Text style={s.sub} numberOfLines={1}>
                    {fmtDia(c.appointment_date, "corto")}{c.professionals?.name ? ` · ${c.professionals.name}` : ""}
                  </Text>
                </View>
                {on && <Ionicons name="checkmark-circle" size={18} color={MORADO} />}
              </TouchableOpacity>
            );
          })}

          <Text style={[s.label, { marginTop: 6 }]}>Motivo (opcional)</Text>
          <TextInput
            style={s.input}
            value={value.motivo}
            onChangeText={motivo => onChange(g => ({ ...g, motivo }))}
            placeholder="Ej: se partió la uña del anular"
            placeholderTextColor={t.subtle}
            maxLength={200}
          />
        </View>
      )}
    </View>
  );
}

const MORADO = "#7c3aed";

function crearEstilos(t: ThemeColors) {
  return StyleSheet.create({
    card:       { backgroundColor: t.cardSolid, borderWidth: 1, borderColor: t.line, borderRadius: Radius.lg, padding: 14, marginBottom: 14 },
    fila:       { flexDirection: "row", alignItems: "center", gap: 12 },
    icono:      { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(124,58,237,0.10)" },
    titulo:     { fontSize: 14, fontFamily: Fonts.semibold, color: t.text },
    sub:        { fontSize: 12, fontFamily: Fonts.regular, color: t.muted, lineHeight: 16 },
    label:      { fontSize: 11, fontFamily: Fonts.bold, color: t.muted, textTransform: "uppercase", letterSpacing: 0.6 },
    cita:       { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderColor: t.line, borderRadius: Radius.md, padding: 12 },
    citaOn:     { borderColor: MORADO, backgroundColor: "rgba(124,58,237,0.06)" },
    citaNombre: { fontSize: 13.5, fontFamily: Fonts.semibold, color: t.text },
    input:      { fontSize: 14, fontFamily: Fonts.regular, color: t.text, backgroundColor: t.inputBg, borderWidth: 1, borderColor: t.inputBorder, borderRadius: Radius.md, padding: 12 },
  });
}
