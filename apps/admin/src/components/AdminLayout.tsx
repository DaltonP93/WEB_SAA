import { useEffect, useRef } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import LucideIcon from "./LucideIcon";
import TopProgressBar from "./TopProgressBar";
import { useSesion } from "../hooks/useSesion";

type NavItem = { to: string; label: string; icon: string; end?: boolean; badge?: "msg" | "turnos"; cap?: string };

const TOP: NavItem = { to: "/", label: "Inicio", icon: "home", end: true };

const SECTIONS: { title: string; items: NavItem[] }[] = [
  {
    title: "Contenido",
    items: [
      { to: "/pages", label: "Páginas", icon: "file-text" },
      { to: "/menus", label: "Menús", icon: "menu" },
      { to: "/doctors", label: "Médicos", icon: "stethoscope" },
      { to: "/specialties", label: "Especialidades", icon: "heart-pulse" },
      { to: "/services", label: "Servicios", icon: "hospital" },
      { to: "/studies", label: "Estudios", icon: "flask-conical" },
      { to: "/contact-channels", label: "Canales de contacto", icon: "message-circle" },
      { to: "/schedules", label: "Horarios", icon: "clock" },
      { to: "/media", label: "Multimedia", icon: "image" },
    ],
  },
  {
    title: "Operación",
    items: [
      { to: "/turnos", label: "Turnos", icon: "calendar-check", badge: "turnos" },
      { to: "/datos-pendientes", label: "Datos pendientes", icon: "clipboard-list" },
      { to: "/messages", label: "Mensajes", icon: "mail", badge: "msg" },
      { to: "/newsletter", label: "Newsletter", icon: "mail-plus" },
    ],
  },
  {
    title: "Sistema",
    items: [
      { to: "/settings", label: "Branding y settings", icon: "palette" },
      { to: "/redirects", label: "Redirects", icon: "milestone" },
      { to: "/users", label: "Usuarios", icon: "users", cap: "users.manage" },
      { to: "/auditoria", label: "Auditoría", icon: "scroll-text", cap: "audit.read" },
    ],
  },
];

export default function AdminLayout() {
  const nav = useNavigate();
  const { pathname } = useLocation();
  const { puede } = useSesion();

  const msgs = useQuery({ queryKey: ["adm-msg"], queryFn: async () => (await api.get("/admin/contact-messages")).data });
  // El contador sale del `total` del servidor, no del largo de la lista: la
  // respuesta viene acotada por un límite y contar lo que llegó daría de menos
  // en cuanto haya más solicitudes pendientes que el tope de una página.
  const turnos = useQuery({
    queryKey: ["adm-appointments", { status: "pendiente", from: "", to: "" }],
    queryFn: async () => (await api.get("/admin/appointments?status=pendiente")).data,
  });

  const msgCount = ((msgs.data ?? []) as any[]).filter((m) => m.status === "nuevo").length;
  const turnosCount = Number((turnos.data as { total?: number } | undefined)?.total ?? 0);
  const badges: Record<string, number> = { msg: msgCount, turnos: turnosCount };

  function logout() {
    localStorage.removeItem("token");
    nav("/login");
  }

  // El scroll del panel vive en el <main>, no en la ventana: al cambiar de
  // sección hay que devolverlo al tope a mano. Se asigna `scrollTop` en vez de
  // `scrollTo()` porque el salto es instantáneo igual y jsdom no implementa el
  // método en elementos.
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (mainRef.current) mainRef.current.scrollTop = 0;
  }, [pathname]);

  return (
    <div className="flex h-screen">
      <TopProgressBar />
      <aside className="w-60 bg-brand text-white flex flex-col">
        <div className="px-4 py-4 border-b border-white/10 bg-gradient-to-r from-brand to-brand-700">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-md bg-white/15 backdrop-blur flex items-center justify-center font-bold text-sm tracking-wide">
              SA
            </div>
            <div className="leading-tight">
              <div className="font-bold text-sm">Sanatorio Adventista</div>
              <div className="text-[10px] uppercase tracking-wider opacity-75">Panel admin</div>
            </div>
          </div>
        </div>
        <div className="h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />
        <nav className="flex-1 overflow-y-auto py-2">
          {(() => {
            const renderItem = (n: NavItem) => {
              const count = n.badge ? badges[n.badge] : 0;
              return (
                <NavLink
                  key={n.to}
                  to={n.to}
                  end={n.end}
                  className={({ isActive }) =>
                    `flex items-center gap-3 pl-4 pr-4 py-2 text-sm border-l-2 transition ${
                      isActive
                        ? "bg-white/10 border-secondary font-semibold"
                        : "border-transparent hover:bg-white/5 hover:border-white/20"
                    }`
                  }
                >
                  <span className="w-5 h-5 flex items-center justify-center">
                    <LucideIcon name={n.icon} className="w-5 h-5" />
                  </span>
                  <span>{n.label}</span>
                  {count > 0 && <span className="ml-auto text-[10px] bg-red-500 text-white rounded-full px-1.5 py-0.5">{count}</span>}
                </NavLink>
              );
            };
            return (
              <>
                <div className="pb-1">{renderItem(TOP)}</div>
                {SECTIONS.map((s) => (
                  <div key={s.title}>
                    <div className="text-[10px] uppercase tracking-[0.14em] font-semibold text-white/50 px-4 pt-4 pb-1.5">
                      {s.title}
                    </div>
                    {s.items.filter((n) => !n.cap || puede(n.cap)).map(renderItem)}
                  </div>
                ))}
              </>
            );
          })()}
        </nav>
        <button onClick={logout} className="m-3 btn-ghost text-white hover:bg-white/20">
          Cerrar sesión
        </button>
      </aside>
      <main ref={mainRef} className="flex-1 overflow-y-auto">
        {/* `key` por ruta: fuerza el remount y con eso la animación de entrada. */}
        <div key={pathname} className="page-enter max-w-6xl mx-auto p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
