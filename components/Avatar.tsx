import { useEffect, useState } from "react";
import { View, Text, Image } from "react-native";
import { Colors } from "@/constants/theme";

type Props = {
  name: string;
  size?: number;
  photoUrl?: string | null;
  color?: string;
};

export default function Avatar({ name, size = 44, photoUrl, color = Colors.blue }: Props) {
  // Si la foto no carga (enlace roto, sin red) se muestran las iniciales en
  // vez de un círculo vacío.
  const [fallo, setFallo] = useState(false);
  useEffect(() => { setFallo(false); }, [photoUrl]);

  if (photoUrl && !fallo) {
    return (
      <Image
        source={{ uri: photoUrl }}
        style={{ width: size, height: size, borderRadius: size / 2 }}
        onError={() => setFallo(true)}
        accessibilityIgnoresInvertColors
      />
    );
  }

  const initials = (name ?? "")
    .split(" ")
    .map((w) => w[0])
    .filter(Boolean)
    .join("")
    .slice(0, 2)
    .toUpperCase() || "?";

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color + "14",
        borderWidth: 1.5,
        borderColor: color + "30",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ color, fontSize: size * 0.33, fontFamily: "SpaceGrotesk_700Bold" }}>
        {initials}
      </Text>
    </View>
  );
}
