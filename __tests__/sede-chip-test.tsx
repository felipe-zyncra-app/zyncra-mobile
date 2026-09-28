import { render, screen, fireEvent } from "@testing-library/react-native";
import SedeChip, { nombreCorto, nombreSede, sedeDeFila } from "@/components/SedeChip";

// Rótulo de la sede en las pantallas de dinero (ARQ-10 / DIN-12): solo se
// nombra con varias sedes, y el chip lleva al selector de Ajustes → Sedes.
// (jest.mock se eleva sobre los imports, así que el mock ya aplica.)
const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));

const sedes = [
  { id: "norte", name: "Sede Norte" },
  { id: "sur", name: "Sede Sur" },
];

describe("nombreSede", () => {
  test("con varias sedes nombra la activa", () => {
    expect(nombreSede(sedes, "sur")).toBe("Sede Sur");
  });

  test("con una sola sede o sin sede activa no hace falta rotular", () => {
    expect(nombreSede([sedes[0]], "norte")).toBeNull();
    expect(nombreSede(sedes, null)).toBeNull();
    expect(nombreSede([], "norte")).toBeNull();
  });

  test("si la sede activa ya no está en la lista, igual avisa que es una sola", () => {
    expect(nombreSede(sedes, "borrada")).toBe("Sede activa");
  });
});

describe("sedeDeFila", () => {
  test("nombra la sede del cobro y avisa los guardados sin sede", () => {
    expect(sedeDeFila(sedes, "norte")).toBe("Sede Norte");
    expect(sedeDeFila(sedes, null)).toBe("Sin sede");
    expect(sedeDeFila(sedes, "otra")).toBe("Otra sede");
  });
});

test("nombreCorto recorta solo los nombres largos", () => {
  expect(nombreCorto("Sede Norte")).toBe("Sede Norte");
  expect(nombreCorto("Sede Centro Comercial Andino Piso 3")).toBe("Sede Centro Comerci…");
  expect(nombreCorto("Sede Centro Comercial Andino Piso 3").length).toBe(20);
});

describe("SedeChip", () => {
  beforeEach(() => mockPush.mockReset());

  test("sin nombre no pinta nada", async () => {
    await render(<SedeChip nombre={null} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  test("lleva al selector de sedes", async () => {
    await render(<SedeChip nombre="Sede Norte" sobreColor />);
    await fireEvent.press(screen.getByRole("button", { name: "Sede activa: Sede Norte. Cambiar de sede" }));
    expect(mockPush).toHaveBeenCalledWith("/settings/locations");
  });
});
