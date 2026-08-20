// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * El formulario público de turnos, con DOM real.
 *
 * El flujo tiene un orden que no se puede invertir: **primero** se registra la
 * solicitud, **después** se sale a WhatsApp. Al revés, la navegación se lleva
 * la página antes de que el registro termine y la solicitud no existe para
 * nadie —que es exactamente el estado del que venimos—.
 *
 * Lo que sólo se ve ejecutando el componente:
 *
 * - que un error de la API **no borre** lo que la persona escribió;
 * - que el doble clic no dispare dos veces;
 * - que la salida sea una navegación y no un `window.open()`, que después de
 *   un `await` el navegador bloquea como popup;
 * - que la clave de envío sea la misma en el reintento y distinta en una
 *   solicitud nueva;
 * - que nada quede guardado en el navegador.
 */

const CANALES = [{ key: "whatsapp-turnos", kind: "whatsapp", value: "+595 981 111 222", active: true }];
const ESPECIALIDADES = [
  { id: 7, slug: "cardiologia", name: "Cardiología" },
  { id: 9, slug: "pediatria", name: "Pediatría" },
];
const DOCTOR = { id: 42, slug: "ana-prueba", name: "Ana Prueba", specialties: [{ id: 7, name: "Cardiología" }] };

/** Peticiones que el formulario mandó a la API, en orden. */
let enviados: { url: string; body: any }[] = [];
/** Qué debe hacer el próximo POST. */
let siguientePost: "ok" | "error" | "colgado" = "ok";
let resolverColgado: (() => void) | null = null;
/** Destinos a los que el componente pidió navegar. */
let navegaciones: string[] = [];
/** ¿Hay CAPTCHA configurado? */
let captchaConfigurado = false;
/** Slug del médico en la query string. */
let doctorParam = "";

vi.mock("../apps/web/src/api", () => ({
  api: {
    get: async (url: string) => {
      if (url.includes("contact-channels")) return { data: CANALES };
      if (url.includes("specialties")) return { data: ESPECIALIDADES };
      if (url.includes("doctors/")) return { data: DOCTOR };
      return { data: [] };
    },
    post: async (url: string, body: any) => {
      enviados.push({ url, body });
      if (siguientePost === "colgado") {
        await new Promise<void>((r) => {
          resolverColgado = r;
        });
      }
      if (siguientePost === "error") {
        throw { response: { data: { error: "no se pudo registrar la solicitud" } } };
      }
      return { data: { id: 1 } };
    },
  },
}));

vi.mock("../apps/web/src/lib/navigate", () => ({
  irA: (url: string) => navegaciones.push(url),
}));

/**
 * El widget real tiene su propio archivo de pruebas. Acá se reemplaza para
 * poder decidir si está configurado y emitir el token a voluntad — el contrato
 * que se ejercita es el mismo que usa `ContactForm`: `onToken` y `onError`.
 */
vi.mock("../apps/web/src/components/Captcha", () => ({
  useCaptchaConfig: () => ({
    config: captchaConfigurado ? { provider: "turnstile", siteKey: "site-de-prueba" } : null,
    isLoading: false,
  }),
  default: ({ onToken }: { onToken: (t: string | null) => void }) =>
    captchaConfigurado ? (
      <button type="button" onClick={() => onToken("token-de-prueba")}>
        resolver captcha
      </button>
    ) : null,
}));

vi.mock("react-router-dom", async () => {
  const real = await vi.importActual<any>("react-router-dom");
  return {
    ...real,
    useSearchParams: () => [new URLSearchParams(doctorParam ? `doctor=${doctorParam}` : "")],
  };
});

let AppointmentForm: any;
let MemoryRouter: any;

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AppointmentForm />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const campo = (label: RegExp) => screen.getByLabelText(label) as HTMLInputElement;
const escribir = (label: RegExp, valor: string) => fireEvent.change(campo(label), { target: { value: valor } });
const boton = () => screen.getByRole("button", { name: /Solicitar turno por WhatsApp|Enviando/i });

/** Completa lo mínimo válido. */
function completar() {
  escribir(/Nombre completo/i, "Paciente De Prueba");
  escribir(/^Teléfono$/i, "+595 981 000 222");
  escribir(/^Email$/i, "paciente.de.prueba@ejemplo.test");
  fireEvent.click(screen.getByRole("checkbox"));
}

beforeEach(async () => {
  enviados = [];
  navegaciones = [];
  siguientePost = "ok";
  resolverColgado = null;
  captchaConfigurado = false;
  doctorParam = "";
  localStorage.clear();
  const rr = await import("react-router-dom");
  MemoryRouter = rr.MemoryRouter;
  AppointmentForm = (await import("../apps/web/src/blocks/AppointmentForm")).default;
});

afterEach(() => cleanup());

describe("campos del formulario", () => {
  it("pide nombre, teléfono, email y consentimiento como obligatorios", async () => {
    montar();
    await waitFor(() => expect(boton()).toBeTruthy());

    expect(campo(/Nombre completo/i).required).toBe(true);
    expect(campo(/^Teléfono$/i).required).toBe(true);
    expect(campo(/^Email$/i).required).toBe(true);
    expect((screen.getByRole("checkbox") as HTMLInputElement).required).toBe(true);
  });

  it("la especialidad y la fecha preferida son opcionales", async () => {
    montar();
    await waitFor(() => expect(screen.getByLabelText(/Especialidad/i)).toBeTruthy());

    expect((screen.getByLabelText(/Especialidad/i) as HTMLSelectElement).required).toBe(false);
    expect(campo(/Fecha y hora preferidas/i).required).toBe(false);
  });

  it("el consentimiento enlaza a la política de privacidad", async () => {
    montar();
    const enlace = await screen.findByRole("link", { name: /Política de privacidad/i });
    expect(enlace.getAttribute("href")).toBe("/privacidad");
  });

  it("tiene un honeypot fuera de la vista y del recorrido de teclado", async () => {
    montar();
    await waitFor(() => expect(boton()).toBeTruthy());

    const trampa = document.querySelector("#appt-website") as HTMLInputElement;
    expect(trampa, "sin honeypot el formulario queda abierto a los bots").toBeTruthy();
    expect(trampa.tabIndex).toBe(-1);
    expect(trampa.closest("[aria-hidden]")).toBeTruthy();
  });
});

describe("validación antes de enviar", () => {
  it("sin el consentimiento marcado no se manda nada", async () => {
    montar();
    await waitFor(() => expect(boton()).toBeTruthy());

    escribir(/Nombre completo/i, "Paciente De Prueba");
    escribir(/^Teléfono$/i, "+595 981 000 222");
    escribir(/^Email$/i, "paciente.de.prueba@ejemplo.test");
    fireEvent.submit(boton().closest("form")!);

    await screen.findByRole("alert");
    expect(enviados, "se mandó una solicitud sin consentimiento").toHaveLength(0);
    expect(screen.getByRole("alert").textContent).toMatch(/aceptaci[óo]n/i);
  });

  it("con un correo inválido no se manda nada", async () => {
    montar();
    await waitFor(() => expect(boton()).toBeTruthy());

    escribir(/Nombre completo/i, "Paciente De Prueba");
    escribir(/^Teléfono$/i, "+595 981 000 222");
    escribir(/^Email$/i, "no-es-un-correo");
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.submit(boton().closest("form")!);

    await screen.findByRole("alert");
    expect(enviados).toHaveLength(0);
  });
});

describe("CAPTCHA", () => {
  it("sin configurar, el botón está habilitado y el envío pasa", async () => {
    montar();
    await waitFor(() => expect(boton()).toBeTruthy());
    completar();

    expect((boton() as HTMLButtonElement).disabled).toBe(false);
    fireEvent.submit(boton().closest("form")!);
    await waitFor(() => expect(enviados).toHaveLength(1));
  });

  it("configurado, el botón queda bloqueado hasta que hay token", async () => {
    captchaConfigurado = true;
    montar();
    await waitFor(() => expect(boton()).toBeTruthy());
    completar();

    expect((boton() as HTMLButtonElement).disabled, "sin token no se puede enviar").toBe(true);

    fireEvent.click(screen.getByRole("button", { name: /resolver captcha/i }));
    await waitFor(() => expect((boton() as HTMLButtonElement).disabled).toBe(false));

    fireEvent.submit(boton().closest("form")!);
    await waitFor(() => expect(enviados).toHaveLength(1));
    expect(enviados[0].body.captchaToken).toBe("token-de-prueba");
  });
});

describe("envío exitoso", () => {
  it("registra primero y recién después navega a WhatsApp", async () => {
    montar();
    await waitFor(() => expect(boton()).toBeTruthy());
    completar();
    escribir(/Mensaje/i, "Prefiero por la mañana.");
    fireEvent.submit(boton().closest("form")!);

    await waitFor(() => expect(navegaciones).toHaveLength(1));
    expect(enviados, "el registro tiene que ocurrir antes de la salida").toHaveLength(1);
    expect(enviados[0].url).toBe("/public/appointments");
    expect(navegaciones[0]).toMatch(/^https:\/\/wa\.me\/595981111222\?text=/);
  });

  it("manda el consentimiento y una clave de envío con formato válido", async () => {
    montar();
    await waitFor(() => expect(boton()).toBeTruthy());
    completar();
    fireEvent.submit(boton().closest("form")!);

    await waitFor(() => expect(enviados).toHaveLength(1));
    expect(enviados[0].body.consent).toBe(true);
    expect(enviados[0].body.submissionKey).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
  });

  it("el mensaje de WhatsApp lleva los datos ya recortados", async () => {
    montar();
    await waitFor(() => expect(boton()).toBeTruthy());
    escribir(/Nombre completo/i, "  Paciente De Prueba  ");
    escribir(/^Teléfono$/i, "+595 981 000 222");
    escribir(/^Email$/i, "paciente.de.prueba@ejemplo.test");
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.submit(boton().closest("form")!);

    await waitFor(() => expect(navegaciones).toHaveLength(1));
    const texto = decodeURIComponent(navegaciones[0].split("text=")[1]);
    expect(texto).toContain("Nombre: Paciente De Prueba");
    expect(texto).not.toContain("  Paciente");
  });

  it("limpia el formulario y no guarda nada en el navegador", async () => {
    montar();
    await waitFor(() => expect(boton()).toBeTruthy());
    completar();
    fireEvent.submit(boton().closest("form")!);

    await waitFor(() => expect(navegaciones).toHaveLength(1));
    expect(campo(/Nombre completo/i).value).toBe("");
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
    expect(localStorage.length, "el borrador no puede quedar en el navegador").toBe(0);
  });

  it("no usa window.open: después de un await el navegador lo bloquea", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    montar();
    await waitFor(() => expect(boton()).toBeTruthy());
    completar();
    fireEvent.submit(boton().closest("form")!);

    await waitFor(() => expect(navegaciones).toHaveLength(1));
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
  });
});

describe("médico y especialidad", () => {
  it("con ?doctor= preselecciona el médico y su especialidad", async () => {
    doctorParam = "ana-prueba";
    montar();
    await screen.findByText(/Reservando con/i);
    await waitFor(() =>
      expect((screen.getByLabelText(/Especialidad/i) as HTMLSelectElement).value).toBe("7"),
    );

    completar();
    fireEvent.submit(boton().closest("form")!);

    await waitFor(() => expect(enviados).toHaveLength(1));
    expect(enviados[0].body.doctorId).toBe(42);
    expect(enviados[0].body.specialtyId).toBe(7);
  });

  it("sin ?doctor= no manda ningún médico", async () => {
    montar();
    await waitFor(() => expect(boton()).toBeTruthy());
    completar();
    fireEvent.submit(boton().closest("form")!);

    await waitFor(() => expect(enviados).toHaveLength(1));
    expect(enviados[0].body.doctorId).toBeUndefined();
  });
});

describe("el error no le hace perder los datos a nadie", () => {
  it("conserva lo escrito, muestra el error y no navega", async () => {
    siguientePost = "error";
    montar();
    await waitFor(() => expect(boton()).toBeTruthy());
    completar();
    escribir(/Mensaje/i, "Prefiero por la mañana.");
    fireEvent.submit(boton().closest("form")!);

    await screen.findByRole("alert");
    expect(campo(/Nombre completo/i).value, "se perdió lo que había escrito").toBe("Paciente De Prueba");
    expect(campo(/Mensaje/i).value).toBe("Prefiero por la mañana.");
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
    expect(navegaciones, "no se puede mandar a WhatsApp como si se hubiera registrado").toHaveLength(0);
  });

  it("se puede reintentar con la misma clave de envío", async () => {
    siguientePost = "error";
    montar();
    await waitFor(() => expect(boton()).toBeTruthy());
    completar();
    fireEvent.submit(boton().closest("form")!);
    await screen.findByRole("alert");

    siguientePost = "ok";
    fireEvent.submit(boton().closest("form")!);
    await waitFor(() => expect(navegaciones).toHaveLength(1));

    expect(enviados).toHaveLength(2);
    expect(
      enviados[1].body.submissionKey,
      "con otra clave el reintento crearía una segunda solicitud",
    ).toBe(enviados[0].body.submissionKey);
  });

  it("ofrece continuar sólo por WhatsApp, avisando que no queda registrada", async () => {
    siguientePost = "error";
    montar();
    await waitFor(() => expect(boton()).toBeTruthy());
    completar();
    fireEvent.submit(boton().closest("form")!);
    await screen.findByRole("alert");

    const salida = await screen.findByRole("link", { name: /continuar s[óo]lo por WhatsApp/i });
    expect(salida.getAttribute("href")).toMatch(/^https:\/\/wa\.me\//);
    expect(document.body.textContent).toMatch(/no queda registrada/i);
  });
});

describe("una solicitud a la vez", () => {
  it("el doble clic no manda dos veces", async () => {
    siguientePost = "colgado";
    montar();
    await waitFor(() => expect(boton()).toBeTruthy());
    completar();

    const form = boton().closest("form")!;
    fireEvent.submit(form);
    await waitFor(() => expect((boton() as HTMLButtonElement).disabled).toBe(true));
    fireEvent.submit(form);
    fireEvent.submit(form);

    expect(enviados, "el segundo y el tercer envío tenían que quedar bloqueados").toHaveLength(1);

    siguientePost = "ok";
    resolverColgado?.();
    await waitFor(() => expect(navegaciones).toHaveLength(1));
  });

  it("una solicitud nueva después de una exitosa usa otra clave", async () => {
    montar();
    await waitFor(() => expect(boton()).toBeTruthy());
    completar();
    fireEvent.submit(boton().closest("form")!);
    await waitFor(() => expect(navegaciones).toHaveLength(1));

    completar();
    fireEvent.submit(boton().closest("form")!);
    await waitFor(() => expect(enviados).toHaveLength(2));

    expect(
      enviados[1].body.submissionKey,
      "repetir la clave haría que la segunda solicitud se ignorara como duplicada",
    ).not.toBe(enviados[0].body.submissionKey);
  });
});

describe("sin WhatsApp cargado", () => {
  it("el botón queda deshabilitado y se explica por qué", async () => {
    const api = await import("../apps/web/src/api");
    vi.spyOn(api.api, "get").mockImplementation(async (url: string) => {
      if (url.includes("contact-channels")) return { data: [] } as any;
      if (url.includes("specialties")) return { data: ESPECIALIDADES } as any;
      return { data: [] } as any;
    });
    montar();

    await screen.findByText(/WhatsApp de turnos todav[íi]a no est[áa] configurado/i);
    expect((screen.getByRole("button", { name: /WhatsApp no disponible/i }) as HTMLButtonElement).disabled).toBe(true);
    vi.restoreAllMocks();
  });
});
