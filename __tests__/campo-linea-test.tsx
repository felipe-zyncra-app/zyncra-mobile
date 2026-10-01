import { useState } from "react";
import { Text, TouchableOpacity } from "react-native";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { CampoLinea, leerCantidad, cantidadATexto } from "@/components/ChargeSheet";
import { leerMonto, montoATexto } from "@/lib/dinero";

// La hoja de cobro trae medio app: aquí solo importa el campo de la línea.
jest.mock("@/lib/supabase", () => ({ supabase: {} }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("@/lib/auth", () => ({ useAuth: () => ({ tenantId: "t1", role: "admin" }) }));
jest.mock("@/lib/tenant", () => ({ useTenant: () => ({ timezone: "America/Bogota", ready: true }) }));
jest.mock("@/lib/notifications", () => ({ cancelarRecordatorioCita: async () => {} }));

const colores = { texto: "#000", borde: "#ccc", fondo: "#fff", tenue: "#999" };

/** Una línea del cobro como la usa ChargeSheet: cantidad y valor por unidad. */
function Linea({ precioInicial = 0, max }: { precioInicial?: number; max?: number }) {
  const [qty, setQty] = useState(1);
  const [precio, setPrecio] = useState(precioInicial);
  return (
    <>
      <CampoLinea value={qty} onCommit={setQty} leer={leerCantidad} aTexto={cantidadATexto}
        min={1} max={max} ancho={48} etiqueta="Cantidad" colores={colores} />
      <CampoLinea value={precio} onCommit={setPrecio}
        leer={v => leerMonto(v, { decimales: false })} aTexto={n => montoATexto(n, { decimales: false })}
        ancho={96} etiqueta="Valor por unidad" placeholder="Valor" colores={colores} />
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Una más" onPress={() => setQty(q => q + 1)}><Text>+</Text></TouchableOpacity>
      <Text>{`total ${qty * precio}`}</Text>
    </>
  );
}

// Injertos de Imperio Capilar: el servicio está en $0 en el catálogo y se
// cobra por cantidad, p. ej. 300 a $2.000 c/u.
describe("components/ChargeSheet · CampoLinea", () => {
  test("cantidad y valor escritos a mano dan el total de la línea", async () => {
    await render(<Linea />);
    await fireEvent.changeText(screen.getByLabelText("Cantidad"), "300");
    await fireEvent.changeText(screen.getByLabelText("Valor por unidad"), "2.000");
    expect(screen.getByText("total 600000")).toBeOnTheScreen();
  });

  test("borrar la cantidad para reescribirla no la deja en 1 mientras se escribe", async () => {
    await render(<Linea precioInicial={1000} />);
    const campo = screen.getByLabelText("Cantidad");
    await fireEvent.changeText(campo, "");
    expect(campo.props.value).toBe("");
    await fireEvent.changeText(campo, "25");
    expect(screen.getByText("total 25000")).toBeOnTheScreen();
  });

  test("al terminar de editar vacía, la cantidad vuelve al mínimo", async () => {
    await render(<Linea precioInicial={1000} />);
    const campo = screen.getByLabelText("Cantidad");
    await fireEvent.changeText(campo, "");
    await fireEvent(campo, "endEditing");
    expect(campo.props.value).toBe("1");
    expect(screen.getByText("total 1000")).toBeOnTheScreen();
  });

  test("la cantidad no pasa del tope (stock de un producto)", async () => {
    await render(<Linea precioInicial={1000} max={5} />);
    await fireEvent.changeText(screen.getByLabelText("Cantidad"), "40");
    expect(screen.getByText("total 5000")).toBeOnTheScreen();
  });

  test("un cambio desde afuera (el +) se ve en el campo", async () => {
    await render(<Linea precioInicial={1000} />);
    await fireEvent.press(screen.getByRole("button", { name: "Una más" }));
    expect(screen.getByLabelText("Cantidad").props.value).toBe("2");
  });
});
