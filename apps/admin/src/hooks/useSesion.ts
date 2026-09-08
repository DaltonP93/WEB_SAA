import { useQuery } from "@tanstack/react-query";
import { api } from "../api";

/**
 * Quién está usando el panel.
 *
 * Hasta ahora el panel no lo sabía. El token lleva el rol adentro y la API
 * expone `GET /auth/me`, pero ninguna pantalla lo consultaba, así que todas
 * dibujaban lo mismo para un `editor` y para un `superadmin`. Eso produce dos
 * problemas distintos:
 *
 * 1. **Se ofrecen acciones que el servidor va a rechazar.** Un editor veía el
 *    botón de confirmar el alcance de Biopsias, lo apretaba y recibía un 403.
 *    Un permiso que sólo se descubre al chocar contra él no es una interfaz.
 * 2. **No se puede proteger a nadie de sí mismo.** Sin saber qué id tiene la
 *    sesión, la lista de usuarios no puede evitar ofrecerte el botón de
 *    borrarte a vos mismo — que la API rechaza, pero recién después del clic.
 *
 * ## Esto no es una autorización
 *
 * Lo que decide quién puede hacer qué es `requireRole` en la API, y sigue
 * siendo así: cualquiera puede editar `localStorage` y decir que es
 * superadmin. Esto sólo evita ofrecer lo que no se va a poder hacer. Ninguna
 * comprobación de acá reemplaza una del servidor, y ninguna pantalla debe
 * apoyarse en esto para proteger un dato.
 *
 * ## Por qué `/auth/me` y no el token
 *
 * El token se puede decodificar en el navegador y traería el rol sin una
 * petición. Pero el rol de una sesión abierta puede haber cambiado —un
 * superadmin bajado a editor sigue con su token viejo en la pestaña— y el
 * token diría el rol de cuando se emitió. `/auth/me` lo resuelve contra el
 * servidor.
 */

export interface Sesion {
  id: number;
  email: string;
  name: string;
  /** Uno de los ocho roles del modelo de permisos (ver `api/src/permisos.ts`). */
  role: string;
  /** Capacidades derivadas del rol por el servidor (`recurso.acción`). */
  capabilities?: string[];
}

export function useSesion() {
  const q = useQuery<Sesion | null>({
    queryKey: ["adm-sesion"],
    queryFn: async () => (await api.get("/auth/me")).data?.user ?? null,
    // Cambia cuando alguien cambia de rol, que no es algo que pase mientras
    // se mira una pantalla. Refrescarlo en cada foco sería una petición por
    // cada vez que el operador vuelve a la pestaña, para nada.
    staleTime: 5 * 60_000,
    retry: false,
  });

  const capacidades = q.data?.capabilities ?? [];

  return {
    sesion: q.data ?? null,
    cargando: q.isLoading,
    /**
     * `false` mientras carga y si falló.
     *
     * Es deliberado: ante la duda, **no** se ofrece la acción. Mostrar el botón
     * y que el servidor conteste 403 es peor que no mostrarlo — el operador ya
     * escribió el texto cuando se entera de que no podía.
     */
    esSuperadmin: q.data?.role === "superadmin",
    capacidades,
    /**
     * ¿La sesión tiene la capacidad? `false` mientras carga o si falló (mismo
     * criterio de "ante la duda, no ofrecer"). No es autorización: la aplica el
     * backend; esto sólo oculta lo que no se va a poder hacer.
     */
    puede: (cap: string) => capacidades.includes(cap),
  };
}
