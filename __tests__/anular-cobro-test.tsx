import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import AnularCobroModal from "@/components/AnularCobroModal";

// Anular un cobro exige la contraseña (DIN-08) y muestra el motivo si no se pudo.
// (jest.mock se eleva sobre los imports, así que los mocks ya aplican.)
const mockVoidSale = jest.fn();
jest.mock("@/lib/record-sale", () => ({
  voidSale: (...args: unknown[]) => mockVoidSale(...args),
}));
jest.mock("@/lib/tenant", () => ({ useTenant: () => ({ timezone: "America/Bogota" }) }));

const cobro = {
  id: "venta-1",
  total: 45000,
  created_at: "2026-09-26T01:30:00Z", // 25-sep 8:30 PM en Bogotá
  appointment_id: "cita-1",
  cliente: "Ana",
  detalle: "Corte",
};

beforeEach(() => mockVoidSale.mockReset());

test("sin contraseña no deja anular", async () => {
  await render(<AnularCobroModal cobro={cobro} onClose={() => {}} onAnulado={() => {}} />);
  const boton = screen.getByRole("button", { name: "Anular cobro" });
  expect(boton).toBeDisabled();
  await fireEvent.press(boton);
  expect(mockVoidSale).not.toHaveBeenCalled();
  // La fecha se muestra en la zona del negocio, no en UTC.
  expect(screen.getByText(/25 sep 2026/)).toBeOnTheScreen();
});

test("manda la contraseña y avisa al terminar", async () => {
  mockVoidSale.mockResolvedValue({ ok: true });
  const onAnulado = jest.fn();
  await render(<AnularCobroModal cobro={cobro} onClose={() => {}} onAnulado={onAnulado} />);
  await fireEvent.changeText(screen.getByLabelText("Contraseña"), "secreta");
  await fireEvent.press(screen.getByRole("button", { name: "Anular cobro" }));
  await waitFor(() => expect(onAnulado).toHaveBeenCalledWith(undefined));
  expect(mockVoidSale).toHaveBeenCalledWith("venta-1", "cita-1", { contrasena: "secreta" });
});

test("si no se pudo, muestra el mensaje y no cierra", async () => {
  mockVoidSale.mockResolvedValue({ ok: false, error: "HAS_INVOICE", message: "Este cobro tiene factura electrónica." });
  const onAnulado = jest.fn();
  await render(<AnularCobroModal cobro={cobro} onClose={() => {}} onAnulado={onAnulado} />);
  await fireEvent.changeText(screen.getByLabelText("Contraseña"), "secreta");
  await fireEvent.press(screen.getByRole("button", { name: "Anular cobro" }));
  expect(await screen.findByText("Este cobro tiene factura electrónica.")).toBeOnTheScreen();
  expect(onAnulado).not.toHaveBeenCalled();
});
