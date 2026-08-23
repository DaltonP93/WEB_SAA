import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { api } from "../api";
import { useConfirm } from "../components/ConfirmDialog";
import { useSesion } from "../hooks/useSesion";

/**
 * Usuarios del panel.
 *
 * La API quedó blindada —no se puede borrar ni bajarle el rol al último
 * superadmin, y cada rechazo tiene su código y su motivo— pero **esta pantalla
 * no mostraba nada de eso**:
 *
 * - La mutación de borrado no tenía `onError`. El 409 que impide cerrar el
 *   panel para siempre llegaba, se descartaba, y desde el otro lado se veía un
 *   clic que no hacía nada. La protección más importante del módulo era
 *   invisible justo cuando actuaba.
 * - Era la única pantalla que seguía usando el `confirm()` del navegador,
 *   contra el estándar del proyecto —`useConfirm()`— que ya usan Médicos,
 *   Páginas, Turnos, Multimedia y los CRUD genéricos. Y preguntaba
 *   "¿Eliminar?", sin decir a quién.
 * - Ofrecía el botón de borrarte a vos mismo, que la API rechaza con 400,
 *   pero recién después del clic.
 *
 * Ninguna comprobación de acá reemplaza a la del servidor: `requireRole` y las
 * guardas de `api/src/routes/admin/users.ts` siguen siendo lo que decide.
 * Esto es para no ofrecer lo que no se va a poder hacer, y para que cuando el
 * servidor diga que no, se lea el motivo.
 */

interface Usuario {
  id: number;
  email: string;
  name: string;
  role: "superadmin" | "editor";
  created_at?: string;
}

/** Lo que se está editando. Sin `id` cuando es alta. */
interface Borrador {
  id?: number;
  email?: string;
  name?: string;
  role: "superadmin" | "editor";
  password?: string;
}

/** Espejo del mínimo que valida el `schema` de la API. */
const MINIMO_CLAVE = 6;

/** El mensaje del servidor si lo hay; si no, uno que al menos diga qué falló. */
const motivo = (e: any, porDefecto: string) => e?.response?.data?.error ?? porDefecto;

export default function UsersPage() {
  const qc = useQueryClient();
  const confirmar = useConfirm();
  const { sesion } = useSesion();
  const [editando, setEditando] = useState<Borrador | null>(null);

  const lista = useQuery<Usuario[]>({
    queryKey: ["adm-users"],
    queryFn: async () => (await api.get("/admin/users")).data,
  });

  const guardar = useMutation({
    mutationFn: async (p: Borrador) =>
      p.id ? api.put(`/admin/users/${p.id}`, p) : api.post("/admin/users", p),
    onSuccess: () => {
      toast.success("Guardado");
      setEditando(null);
      qc.invalidateQueries({ queryKey: ["adm-users"] });
    },
    // El 409 de email repetido y el 400 de un dato mal escrito llegan con su
    // motivo: mostrarlo es la diferencia entre corregirlo y volver a probar.
    onError: (e: any) => toast.error(motivo(e, "No se pudo guardar")),
  });

  const borrar = useMutation({
    mutationFn: async (id: number) => api.delete(`/admin/users/${id}`),
    onSuccess: () => {
      toast.success("Eliminado");
      qc.invalidateQueries({ queryKey: ["adm-users"] });
    },
    // Sin esto, el 409 del último superadmin desaparecía sin dejar rastro.
    onError: (e: any) => toast.error(motivo(e, "No se pudo eliminar")),
  });

  const usuarios = lista.data ?? [];
  /**
   * Cuántos superadmin quedan.
   *
   * Se usa sólo para **avisar** antes de intentar algo que el servidor va a
   * rechazar. Quien decide sigue siendo la API, que lo cuenta contra la base:
   * este número sale de una lista que puede estar desactualizada si alguien
   * más está editando al mismo tiempo.
   */
  const superadmins = usuarios.filter((u) => u.role === "superadmin").length;

  const esUltimoSuperadmin = (u: Usuario) => u.role === "superadmin" && superadmins <= 1;
  const esUnoMismo = (u: Usuario) => sesion?.id === u.id;

  async function pedirBorrado(u: Usuario) {
    const ok = await confirmar({
      title: "Eliminar usuario",
      // Con el nombre adentro: "¿Eliminar?" a secas no deja comprobar que se
      // está por borrar a quien se cree.
      message: `¿Eliminar a "${u.name}" (${u.email})? Esta acción no se puede deshacer.`,
      confirmLabel: "Eliminar",
      danger: true,
    });
    if (ok) borrar.mutate(u.id);
  }

  const nuevo = () => setEditando({ role: "editor" });

  const puedeGuardar =
    editando !== null &&
    (editando.email ?? "").trim().length > 0 &&
    (editando.name ?? "").trim().length > 0 &&
    // Al crear, la contraseña es obligatoria; al editar, vacío significa "no
    // la cambies". Un valor corto es un error en los dos casos.
    (editando.id
      ? !editando.password || editando.password.length >= MINIMO_CLAVE
      : (editando.password ?? "").length >= MINIMO_CLAVE);

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Usuarios</h1>
        <button onClick={nuevo} className="btn-primary">
          + Nuevo
        </button>
      </div>

      {superadmins === 1 && (
        <div className="card p-4 mb-4 border-amber-300 bg-amber-50" role="status">
          <p className="text-sm text-amber-900">
            Queda <strong>un solo superadmin</strong>. No se lo puede eliminar ni pasar a editor: si
            no queda ninguno, nadie puede volver a administrar usuarios desde el panel.
          </p>
        </div>
      )}

      {editando && (
        <div className="card p-4 mb-4 grid md:grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="u-email">
              Email
            </label>
            <input
              id="u-email"
              className="input"
              value={editando.email ?? ""}
              onChange={(e) => setEditando({ ...editando, email: e.target.value })}
            />
          </div>
          <div>
            <label className="label" htmlFor="u-name">
              Nombre
            </label>
            <input
              id="u-name"
              className="input"
              value={editando.name ?? ""}
              onChange={(e) => setEditando({ ...editando, name: e.target.value })}
            />
          </div>
          <div>
            <label className="label" htmlFor="u-role">
              Rol
            </label>
            <select
              id="u-role"
              className="input"
              value={editando.role}
              onChange={(e) =>
                setEditando({ ...editando, role: e.target.value as Borrador["role"] })
              }
            >
              <option value="editor">Editor</option>
              <option value="superadmin">Superadmin</option>
            </select>
            {editando.id !== undefined &&
              editando.role === "editor" &&
              usuarios.find((u) => u.id === editando.id)?.role === "superadmin" &&
              superadmins <= 1 && (
                <p className="text-xs text-amber-800 mt-1">
                  Es el último superadmin: el servidor va a rechazar el cambio de rol.
                </p>
              )}
          </div>
          <div>
            <label className="label" htmlFor="u-password">
              Contraseña {editando.id ? "(dejar vacío para no cambiarla)" : ""}
            </label>
            <input
              id="u-password"
              className="input"
              type="password"
              value={editando.password ?? ""}
              onChange={(e) => setEditando({ ...editando, password: e.target.value })}
            />
            <p className="text-xs text-gray-600 mt-1">Mínimo {MINIMO_CLAVE} caracteres.</p>
          </div>
          <div className="md:col-span-2 flex justify-end gap-2">
            <button onClick={() => setEditando(null)} className="btn-secondary">
              Cancelar
            </button>
            <button
              onClick={() => editando && guardar.mutate(editando)}
              disabled={!puedeGuardar || guardar.isPending}
              className="btn-primary"
            >
              {guardar.isPending ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </div>
      )}

      <div className="card divide-y">
        {lista.isLoading && <div className="p-4 text-sm text-gray-500">Cargando…</div>}
        {usuarios.map((u) => {
          const ultimo = esUltimoSuperadmin(u);
          const propio = esUnoMismo(u);
          return (
            <div key={u.id} className="p-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold truncate">
                  {u.name}
                  {propio && <span className="text-xs font-normal text-gray-500"> · vos</span>}
                </div>
                <div className="text-xs text-gray-500 truncate">
                  {u.email} · {u.role}
                </div>
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <button onClick={() => setEditando(u)} className="btn-secondary">
                  Editar
                </button>
                <button
                  onClick={() => pedirBorrado(u)}
                  // Los dos casos que la API rechaza, deshabilitados con su
                  // motivo a la vista en vez de un 400/409 después del clic.
                  disabled={propio || ultimo || borrar.isPending}
                  title={
                    propio
                      ? "No podés eliminar tu propio usuario"
                      : ultimo
                        ? "Es el último superadmin: nadie podría volver a administrar usuarios"
                        : undefined
                  }
                  className="btn-danger disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Eliminar
                </button>
              </div>
            </div>
          );
        })}
        {!lista.isLoading && usuarios.length === 0 && (
          <div className="p-4 text-sm text-gray-500">No hay usuarios cargados.</div>
        )}
      </div>
    </div>
  );
}
