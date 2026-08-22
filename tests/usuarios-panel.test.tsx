// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * La pantalla de Usuarios, que no mostraba lo que la API garantiza.
 *
 * Las guardas del servidor están probadas contra la base en
 * `tests/usuarios-blindaje.test.ts`: no se puede borrar ni bajarle el rol al
 * último superadmin, un email repetido da 409, un dato mal escrito da 400. Todo
 * eso funcionaba **y no se veía**:
 *
 * - La mutación de borrado no tenía `onError`. El 409 que impide cerrar el panel
 *   para siempre llegaba, se descartaba, y desde el otro lado se veía un clic
 *   que no hacía nada. La protección más importante del módulo era invisible
 *   justo en el momento en que actuaba. Una prueba de API no puede detectar
 *   esto: el servidor hizo lo correcto.
 * - Era la única pantalla que seguía usando el `confirm()` del navegador,
 *   contra el estándar del proyecto, y preguntaba "¿Eliminar?" sin decir a
 *   quién.
 *
 * Nada de lo que se comprueba acá reemplaza a la guarda del servidor: son cosas
 * distintas y las dos tienen que estar.
 */

interface Llamada {
  metodo: string;
  url: string;
  cuerpo?: unknown;
}

const llamadas: Llamada[] = [];
const respuestas: Record<string, unknown> = {};
const errores: Record<string, { status: number; error: string }> = {};

function quizasFallar(clave: string) {
  const e = errores[clave];
  if (!e) return;
  throw Object.assign(new Error(String(e.status)), {
    response: { status: e.status, data: { error: e.error } },
  });
}

vi.mock("../apps/admin/src/api", () => ({
  api: {
    get: async (url: string) => {
      llamadas.push({ metodo: "GET", url });
      quizasFallar(`GET ${url}`);
      return { data: respuestas[url] ?? [] };
    },
    post: async (url: string, cuerpo?: unknown) => {
      llamadas.push({ metodo: "POST", url, cuerpo });
      quizasFallar(`POST ${url}`);
      return { data: {} };
    },
    put: async (url: string, cuerpo?: unknown) => {
      llamadas.push({ metodo: "PUT", url, cuerpo });
      quizasFallar(`PUT ${url}`);
      return { data: {} };
    },
    delete: async (url: string) => {
      llamadas.push({ metodo: "DELETE", url });
      quizasFallar(`DELETE ${url}`);
      return { data: null };
    },
  },
}));

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("react-hot-toast", () => ({
  default: { success: (m: string) => toastSuccess(m), error: (m: string) => toastError(m) },
  toast: { success: (m: string) => toastSuccess(m), error: (m: string) => toastError(m) },
}));

let UsersPage: any;
let ConfirmProvider: any;

const YO = { id: 1, email: "admin@sanatorio.local", name: "Admin", role: "superadmin" as const };
const OTRO_SUPER = { id: 2, email: "dir@sanatorio.local", name: "Dirección", role: "superadmin" as const };
const EDITOR = { id: 3, email: "edi@sanatorio.local", name: "Editora", role: "editor" as const };

function conUsuarios(...us: any[]) {
  respuestas["/admin/users"] = us;
}

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ConfirmProvider>
        <UsersPage />
      </ConfirmProvider>
    </QueryClientProvider>,
  );
}

/** La fila de un usuario, por su nombre. */
async function fila(nombre: string): Promise<HTMLElement> {
  const n = await screen.findByText((t, el) => el?.textContent?.startsWith(nombre) === true && el.tagName === "DIV" && el.className.includes("font-semibold"));
  return n.closest("div.p-4") as HTMLElement;
}

const botonDe = (f: HTMLElement, texto: string) =>
  Array.from(f.querySelectorAll("button")).find((b) => b.textContent === texto) as HTMLButtonElement;

/**
 * Acepta el diálogo de confirmación.
 *
 * Se acota al diálogo a propósito: su botón de aceptar y el "Eliminar" de la
 * fila comparten la clase `btn-danger`, así que buscarlo por texto en todo el
 * documento encuentra dos y falla por ambigüedad — sin decir nada sobre lo que
 * se está probando.
 */
async function aceptarDialogo(titulo: string, boton: string) {
  const h = await screen.findByText(titulo);
  const dialogo = h.parentElement as HTMLElement;
  fireEvent.click(
    Array.from(dialogo.querySelectorAll("button")).find((b) => b.textContent === boton)!,
  );
}

beforeEach(async () => {
  llamadas.length = 0;
  for (const k of Object.keys(errores)) delete errores[k];
  toastError.mockClear();
  toastSuccess.mockClear();
  respuestas["/auth/me"] = { user: YO };
  conUsuarios(YO, OTRO_SUPER, EDITOR);

  UsersPage = (await import("../apps/admin/src/pages/UsersPage")).default;
  ConfirmProvider = (await import("../apps/admin/src/components/ConfirmDialog")).ConfirmProvider;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("panel de Usuarios", () => {
  describe("el rechazo del servidor se ve", () => {
    /**
     * La prueba que importa de todo el archivo.
     *
     * Se fuerza el 409 que devuelve la API al intentar borrar al último
     * superadmin y se exige que el motivo llegue a la pantalla. Sin `onError`,
     * la promesa se rechaza, nadie la escucha, y el operador ve un clic que no
     * hace nada — sin saber si falló, si se guardó, o si hay que reintentar.
     */
    it("el 409 del último superadmin llega al operador, no se descarta", async () => {
      // Dos superadmin en la lista, así que el panel no lo deshabilita solo y
      // la petición sale de verdad: es el rechazo del servidor lo que se prueba.
      conUsuarios(YO, OTRO_SUPER);
      errores["DELETE /admin/users/2"] = {
        status: 409,
        error: "no se puede borrar al último superadmin: nadie podría volver a administrar usuarios",
      };
      montar();

      const f = await fila("Dirección");
      fireEvent.click(botonDe(f, "Eliminar"));
      await aceptarDialogo("Eliminar usuario", "Eliminar");

      await waitFor(() =>
        expect(toastError).toHaveBeenCalledWith(
          "no se puede borrar al último superadmin: nadie podría volver a administrar usuarios",
        ),
      );
      expect(toastSuccess, "se avisó de un borrado que no ocurrió").not.toHaveBeenCalled();
    });

    it("el 409 de email repetido también", async () => {
      errores["POST /admin/users"] = { status: 409, error: "ya existe un usuario con ese email" };
      montar();

      fireEvent.click(await screen.findByText("+ Nuevo"));
      fireEvent.change(screen.getByLabelText("Email"), { target: { value: "dir@sanatorio.local" } });
      fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Repetida" } });
      fireEvent.change(screen.getByLabelText(/Contraseña/), { target: { value: "unaclavelarga" } });
      fireEvent.click(screen.getByText("Guardar"));

      await waitFor(() => expect(toastError).toHaveBeenCalledWith("ya existe un usuario con ese email"));
    });
  });

  describe("no se ofrece lo que la API va a rechazar", () => {
    it("no se puede pedir el borrado del propio usuario", async () => {
      montar();
      const f = await fila("Admin");
      const boton = botonDe(f, "Eliminar");

      // La API lo rechaza con 400, pero recién después del clic.
      expect(boton.disabled, "se ofrecía borrarse a uno mismo").toBe(true);
      expect(boton.title).toMatch(/tu propio usuario/i);
    });

    it("no se puede pedir el borrado del último superadmin", async () => {
      conUsuarios(OTRO_SUPER, EDITOR);
      respuestas["/auth/me"] = { user: EDITOR };
      montar();

      const f = await fila("Dirección");
      const boton = botonDe(f, "Eliminar");
      expect(boton.disabled).toBe(true);
      expect(boton.title).toMatch(/último superadmin/i);
    });

    it("con dos superadmin, borrar uno sí se ofrece", async () => {
      montar();
      const f = await fila("Dirección");
      // La protección es sobre el último, no sobre el rol: si no dejara borrar
      // ninguno, no se podría quitar a alguien que ya no trabaja acá.
      expect(botonDe(f, "Eliminar").disabled).toBe(false);
    });

    it("avisa cuando queda un solo superadmin, antes de que alguien lo intente", async () => {
      conUsuarios(YO, EDITOR);
      montar();

      const aviso = await screen.findByRole("status");
      expect(aviso.textContent).toMatch(/un solo superadmin/i);
      expect(aviso.textContent).toMatch(/nadie puede volver a administrar/i);
    });

    it("sin ese caso, no hay aviso", async () => {
      montar();
      await fila("Admin");
      expect(screen.queryByRole("status")).toBeNull();
    });

    it("avisa al bajarle el rol al último superadmin, en el propio formulario", async () => {
      conUsuarios(YO, EDITOR);
      montar();

      const f = await fila("Admin");
      fireEvent.click(botonDe(f, "Editar"));
      fireEvent.change(screen.getByLabelText("Rol"), { target: { value: "editor" } });

      // El mismo agujero que el borrado, por la otra puerta: la API lo rechaza
      // con 409 y el panel lo dice antes.
      expect(screen.getByText(/el servidor va a rechazar el cambio de rol/i)).toBeTruthy();
    });
  });

  describe("el diálogo de borrado es el del proyecto y dice a quién", () => {
    it("usa el diálogo del panel, no el confirm() del navegador", async () => {
      const nativo = vi.fn(() => true);
      vi.stubGlobal("confirm", nativo);
      montar();

      const f = await fila("Dirección");
      fireEvent.click(botonDe(f, "Eliminar"));

      expect(await screen.findByText("Eliminar usuario")).toBeTruthy();
      // Era la única pantalla que seguía usando el nativo, contra el estándar
      // que ya usan Médicos, Páginas, Turnos y Multimedia.
      expect(nativo, "volvió el confirm() del navegador").not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    });

    it("el mensaje nombra a quién se va a borrar", async () => {
      montar();
      const f = await fila("Dirección");
      fireEvent.click(botonDe(f, "Eliminar"));

      await screen.findByText("Eliminar usuario");
      // "¿Eliminar?" a secas no deja comprobar que se está por borrar a quien
      // se cree.
      expect(document.body.textContent).toContain("Dirección");
      expect(document.body.textContent).toContain("dir@sanatorio.local");
    });

    it("cancelar no borra nada", async () => {
      montar();
      const f = await fila("Dirección");
      fireEvent.click(botonDe(f, "Eliminar"));
      fireEvent.click(await screen.findByText("Cancelar"));

      await waitFor(() => expect(screen.queryByText("Eliminar usuario")).toBeNull());
      expect(llamadas.some((c) => c.metodo === "DELETE")).toBe(false);
    });

    it("confirmar sí borra", async () => {
      montar();
      const f = await fila("Dirección");
      fireEvent.click(botonDe(f, "Eliminar"));
      await aceptarDialogo("Eliminar usuario", "Eliminar");

      await waitFor(() =>
        expect(llamadas.some((c) => c.metodo === "DELETE" && c.url === "/admin/users/2")).toBe(true),
      );
    });
  });

  describe("el formulario no deja mandar lo que la API rechaza", () => {
    it("al crear, exige email, nombre y una contraseña de largo suficiente", async () => {
      montar();
      fireEvent.click(await screen.findByText("+ Nuevo"));
      const guardar = () => screen.getByText("Guardar") as HTMLButtonElement;

      expect(guardar().disabled, "se podía crear sin nada").toBe(true);

      fireEvent.change(screen.getByLabelText("Email"), { target: { value: "nueva@sanatorio.local" } });
      expect(guardar().disabled).toBe(true);

      fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Nueva" } });
      expect(guardar().disabled, "se podía crear sin contraseña").toBe(true);

      fireEvent.change(screen.getByLabelText(/Contraseña/), { target: { value: "corta" } });
      expect(guardar().disabled, "se aceptó una contraseña de 5 caracteres").toBe(true);

      fireEvent.change(screen.getByLabelText(/Contraseña/), { target: { value: "seisomas" } });
      expect(guardar().disabled).toBe(false);
    });

    it("al editar, la contraseña vacía significa no cambiarla", async () => {
      montar();
      const f = await fila("Editora");
      fireEvent.click(botonDe(f, "Editar"));

      // Vacía es válido; corta no.
      expect((screen.getByText("Guardar") as HTMLButtonElement).disabled).toBe(false);
      fireEvent.change(screen.getByLabelText(/Contraseña/), { target: { value: "abc" } });
      expect((screen.getByText("Guardar") as HTMLButtonElement).disabled).toBe(true);
    });
  });

  describe("qué se muestra de cada usuario", () => {
    it("no imprime el hash de la contraseña aunque llegue en la respuesta", async () => {
      // La API no lo manda —`CAMPOS` lo excluye— pero si alguna vez volviera,
      // la pantalla no tiene que ser el lugar donde se publique.
      conUsuarios({ ...EDITOR, password_hash: "$2b$10$UNHASHQUENODEBERIASALIR" });
      montar();
      await fila("Editora");

      expect(document.body.textContent).not.toContain("$2b$");
      expect(document.body.textContent).not.toContain("UNHASHQUENODEBERIASALIR");
    });

    it("marca cuál de todos sos vos", async () => {
      montar();
      const f = await fila("Admin");
      expect(f.textContent).toMatch(/vos/);
    });
  });
});
