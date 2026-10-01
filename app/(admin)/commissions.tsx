import { useState } from "react";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTheme } from "@/lib/theme";
import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import { ScreenHeader, SegmentedControl } from "@/components/ui";
import TabResumen from "@/components/nomina/TabResumen";
import TabNovedades from "@/components/nomina/TabNovedades";
import TabReglas from "@/components/nomina/TabReglas";
import TabHistorial from "@/components/nomina/TabHistorial";

/**
 * Nómina del equipo (antes "Comisiones"; 2026-10-01). Igual que el panel web:
 * Resumen por periodo con el detalle y el pago de cada profesional, Novedades
 * (bonificaciones, propinas, descuentos), Reglas (básico, comisión por
 * servicio y de productos) e Historial con la colilla de cada pago.
 *
 * El cálculo es del servidor (/api/nomina/*, ver lib/nomina.ts): antes esta
 * pantalla calculaba por su cuenta y no coincidía con el web.
 */

type Pestana = "resumen" | "novedades" | "reglas" | "historial";

const PESTANAS: { value: Pestana; label: string }[] = [
  { value: "resumen", label: "Resumen" },
  { value: "novedades", label: "Novedades" },
  { value: "reglas", label: "Reglas" },
  { value: "historial", label: "Historial" },
];

export default function NominaScreen() {
  const router = useRouter();
  const { t } = useTheme();
  const { tenantId } = useAuth();
  const { timezone } = useTenant();
  const [pestana, setPestana] = useState<Pestana>("resumen");

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={["top"]}>
      <ScreenHeader
        crumb="Equipo"
        title="Nómina"
        subtitle="Básico, comisiones, propinas y pagos de tu equipo"
        onBack={() => router.back()}
      />
      <View style={{ paddingHorizontal: 20, paddingBottom: 12 }}>
        <SegmentedControl options={PESTANAS} value={pestana} onChange={setPestana} />
      </View>
      {tenantId ? (
        <View style={{ flex: 1 }}>
          {pestana === "resumen" && <TabResumen tenantId={tenantId} timezone={timezone} />}
          {pestana === "novedades" && <TabNovedades tenantId={tenantId} timezone={timezone} />}
          {pestana === "reglas" && <TabReglas tenantId={tenantId} timezone={timezone} />}
          {pestana === "historial" && <TabHistorial tenantId={tenantId} timezone={timezone} />}
        </View>
      ) : null}
    </SafeAreaView>
  );
}
