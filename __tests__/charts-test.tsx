import { render, screen, fireEvent } from "@testing-library/react-native";
import { Donut } from "@/components/charts";

// Los segmentos del donut (SVG) no llegan al lector de pantalla: la leyenda
// es la forma accesible de resaltarlos, así que cada fila es un botón con
// nombre (medio, porcentaje y monto) y estado seleccionado.
describe("components/charts · Donut", () => {
  const datos = [
    { label: "Efectivo", value: 60000, color: "#10b981" },
    { label: "Nequi", value: 40000, color: "#0027fe" },
  ];
  const fmt = (v: number) => `$${v}`;

  test("cada fila de la leyenda es un botón con nombre", async () => {
    await render(<Donut data={datos} fmt={fmt} centerLabel="cobrado" />);
    expect(screen.getByRole("button", { name: "Efectivo, 60%, $60000" })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Nequi, 40%, $40000" })).toBeOnTheScreen();
  });

  test("tocar una fila la marca seleccionada y volver a tocarla la suelta", async () => {
    await render(<Donut data={datos} fmt={fmt} />);
    const nequi = screen.getByRole("button", { name: "Nequi, 40%, $40000" });
    expect(nequi).not.toBeSelected();

    await fireEvent.press(nequi);
    expect(screen.getByRole("button", { name: "Nequi, 40%, $40000" })).toBeSelected();

    await fireEvent.press(screen.getByRole("button", { name: "Nequi, 40%, $40000" }));
    expect(screen.getByRole("button", { name: "Nequi, 40%, $40000" })).not.toBeSelected();
  });
});
