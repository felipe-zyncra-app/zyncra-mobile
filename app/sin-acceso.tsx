import { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Colors, Fonts, Radius } from "@/constants/theme";
import { useTheme } from "@/lib/theme";
import { useAuth, RUTA_TERMINAR_REGISTRO } from "@/lib/auth";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

/**
 * Sesión válida sin acceso a la app. Antes estos casos terminaban en el login
 * con la sesión todavía abierta (o con el botón en "Entrando…" para siempre):
 *  · sin-rol:     registro a medias (la cuenta se crea antes del código del
 *                 correo), admin de sede, usuario sin negocio.
 *  · desactivado: el dueño apagó al colaborador en Ajustes → Equipo.
 *  · error:       no se pudo consultar el rol (sin red). Se reintenta solo al
 *                 volver a primer plano; aquí también a mano.
 * Siempre hay una salida: reintentar, terminar el registro o cerrar sesión.
 */
export default function SinAcceso() {
  const { t } = useTheme();
  const router = useRouter();
  const { estado, errorAcceso, user, reintentar, cerrarSesion } = useAuth();
  const [ocupado, setOcupado] = useState<"reintentar" | "salir" | null>(null);

  const onReintentar = async () => {
    setOcupado("reintentar");
    try { await reintentar(); } finally { setOcupado(null); }
  };
  const onSalir = async () => {
    setOcupado("salir");
    try { await cerrarSesion(); } finally { setOcupado(null); }
  };

  if (estado === "cargando" || estado === "admin" || estado === "staff" || estado === "sin-sesion") {
    // Resolviendo, o el guard está por llevarlo a su área.
    return (
      <View style={[s.root, s.centro, { backgroundColor: t.bg }]}>
        <ActivityIndicator color={Colors.red} size="large" />
        <Text style={[s.cargando, { color: t.muted }]}>Verificando tu cuenta…</Text>
      </View>
    );
  }

  let icono: IoniconName = "cloud-offline-outline";
  let titulo = "No pudimos conectar";
  let cuerpo = errorAcceso ?? "Revisa tu conexión a internet e inténtalo de nuevo.";
  let terminarRegistro = false;

  if (estado === "desactivado") {
    icono = "person-remove-outline";
    titulo = "Tu acceso fue desactivado";
    cuerpo = "El dueño del negocio desactivó tu cuenta de colaborador. Si crees que es un error, comunícate con él para que la vuelva a activar.";
  } else if (estado === "sin-rol") {
    icono = "storefront-outline";
    titulo = "Tu cuenta no tiene un negocio";
    cuerpo = "Esta cuenta todavía no tiene un negocio en Zyncra. Si empezaste el registro y no lo terminaste, puedes terminarlo ahora sin crear otra cuenta. Si te invitaron a un equipo o administras una sede, pídele al dueño del negocio que te dé acceso.";
    terminarRegistro = true;
  }

  return (
    <SafeAreaView style={[s.root, { backgroundColor: t.bg }]}>
      <View style={s.centro}>
        <View style={[s.card, { backgroundColor: t.card, borderColor: t.cardBorder }]}>
          <View style={[s.iconWrap, { backgroundColor: t.chipBg }]}>
            <Ionicons name={icono} size={28} color={Colors.red} />
          </View>
          <Text style={[s.titulo, { color: t.text }]}>{titulo}</Text>
          <Text style={[s.cuerpo, { color: t.muted }]}>{cuerpo}</Text>
          {user?.email ? (
            <Text style={[s.cuenta, { color: t.subtle }]}>Sesión iniciada como {user.email}</Text>
          ) : null}

          {terminarRegistro && (
            <TouchableOpacity
              style={[s.btn, s.btnPrimario]}
              activeOpacity={0.85}
              disabled={ocupado !== null}
              onPress={() => router.replace(RUTA_TERMINAR_REGISTRO)}
            >
              <Text style={s.btnPrimarioTxt}>Terminar registro</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[s.btn, terminarRegistro ? [s.btnSecundario, { borderColor: t.lineStrong }] : s.btnPrimario]}
            activeOpacity={0.85}
            disabled={ocupado !== null}
            onPress={onReintentar}
          >
            {ocupado === "reintentar"
              ? <ActivityIndicator color={terminarRegistro ? t.text : "white"} />
              : <Text style={terminarRegistro ? [s.btnSecundarioTxt, { color: t.text }] : s.btnPrimarioTxt}>Reintentar</Text>}
          </TouchableOpacity>

          <TouchableOpacity
            style={[s.btn, s.btnSecundario, { borderColor: t.lineStrong }]}
            activeOpacity={0.85}
            disabled={ocupado !== null}
            onPress={onSalir}
          >
            {ocupado === "salir"
              ? <ActivityIndicator color={t.text} />
              : <Text style={[s.btnSecundarioTxt, { color: t.text }]}>Cerrar sesión</Text>}
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root:             { flex: 1 },
  centro:           { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 20 },
  cargando:         { marginTop: 14, fontSize: 13, fontFamily: Fonts.regular },
  card:             { width: "100%", maxWidth: 420, borderRadius: Radius.xl, borderWidth: 1, padding: 24, alignItems: "center" },
  iconWrap:         { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", marginBottom: 16 },
  titulo:           { fontSize: 20, fontFamily: Fonts.bold, textAlign: "center", marginBottom: 8 },
  cuerpo:           { fontSize: 14, lineHeight: 20, fontFamily: Fonts.regular, textAlign: "center", marginBottom: 12 },
  cuenta:           { fontSize: 12, fontFamily: Fonts.regular, textAlign: "center", marginBottom: 20 },
  btn:              { width: "100%", minHeight: 48, borderRadius: Radius.md, alignItems: "center", justifyContent: "center", marginTop: 10, paddingHorizontal: 16 },
  btnPrimario:      { backgroundColor: Colors.red },
  btnPrimarioTxt:   { color: "white", fontSize: 15, fontFamily: Fonts.bold },
  btnSecundario:    { borderWidth: 1, backgroundColor: "transparent" },
  btnSecundarioTxt: { fontSize: 15, fontFamily: Fonts.semibold },
});
