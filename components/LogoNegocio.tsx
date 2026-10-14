import { useEffect, useState } from "react";
import { View, Text, Image, type StyleProp, type ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Fonts, Gradients } from "@/constants/theme";

/**
 * Logo del negocio (Mi Marca) y, si no hay o no carga, sus iniciales sobre el
 * degradado de Zyncra. Mismo criterio que el encabezado del panel web.
 */
export default function LogoNegocio({ name, logoUrl, size = 46, radius = 14, style }: {
  name: string;
  logoUrl?: string | null;
  size?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const [fallo, setFallo] = useState(false);
  useEffect(() => { setFallo(false); }, [logoUrl]);

  if (logoUrl && !fallo) {
    return (
      <View style={[{ width: size, height: size, borderRadius: radius, backgroundColor: "#fff", overflow: "hidden", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(20,15,30,0.08)" }, style]}>
        <Image
          source={{ uri: logoUrl }}
          style={{ width: size - 6, height: size - 6 }}
          resizeMode="contain"
          onError={() => setFallo(true)}
          accessibilityIgnoresInvertColors
          accessibilityLabel={`Logo de ${name}`}
        />
      </View>
    );
  }

  const palabras = name.trim().split(/\s+/).filter(Boolean);
  const iniciales = (palabras.length > 1 ? palabras.slice(0, 2).map(w => w[0]).join("") : (palabras[0] ?? "").slice(0, 2)).toUpperCase() || "?";
  return (
    <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
      style={[{ width: size, height: size, borderRadius: radius, alignItems: "center", justifyContent: "center" }, style]}>
      <Text style={{ color: "#fff", fontSize: Math.round(size * 0.37), fontFamily: Fonts.bold, letterSpacing: -0.3 }}>{iniciales}</Text>
    </LinearGradient>
  );
}
