import { render, screen, fireEvent } from "@testing-library/react-native";
import { ScreenHeader, IconButton, iconLabel } from "@/components/ui";

// Comprueba que el render de componentes (react-native + reanimated + expo)
// funciona en Jest, y que los botones de ícono tienen nombre accesible.
describe("components/ui", () => {
  test("ScreenHeader: el botón Volver tiene nombre y llama a onBack", async () => {
    const onBack = jest.fn();
    await render(<ScreenHeader title="Servicios" onBack={onBack} />);

    await fireEvent.press(screen.getByRole("button", { name: "Volver" }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("header", { name: "Servicios" })).toBeOnTheScreen();
  });

  test("ScreenHeader: la acción derecha deduce el nombre del ícono", async () => {
    await render(<ScreenHeader title="Equipo" rightAction={{ icon: "add", onPress: () => {} }} />);
    expect(screen.getByRole("button", { name: "Agregar" })).toBeOnTheScreen();
  });

  test("IconButton expone su label al lector de pantalla", async () => {
    const onPress = jest.fn();
    await render(<IconButton icon="trash-outline" label="Eliminar proveedor" onPress={onPress} />);

    await fireEvent.press(screen.getByRole("button", { name: "Eliminar proveedor" }));
    expect(onPress).toHaveBeenCalled();
  });

  test("iconLabel: el label explícito gana sobre el deducido", () => {
    expect(iconLabel("add")).toBe("Agregar");
    expect(iconLabel("add", "Nuevo servicio")).toBe("Nuevo servicio");
    expect(iconLabel("alarm-outline")).toBeUndefined();
  });
});
