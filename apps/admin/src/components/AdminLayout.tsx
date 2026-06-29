import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";

type NavItem = { to: string; label: string; icon: string; end?: boolean; badge?: "msg" };

const TOP: NavItem = { to: "/", label: "Inicio", icon: "🏠", end: true };

const SECTIONS: { title: string; items: NavItem[] }[] = [
  {
    title: "Contenido",
    items: [
      { to: "/pages", label: "Páginas", icon: "📄" },
      { to: "/menus", label: "Menús", icon: "🧭" },
      { to: "/doctors", label: "Médicos", icon: "👨‍⚕️" },
      { to: "/specialties", label: "Especialidades", icon: "🩺" },
      { to: "/services", label: "Servicios", icon: "🏥" },
      { to: "/studies", label: "Estudios", icon: "🔬" },
      { to: "/media", label: "Multimedia", icon: "🖼️" },
    ],
  },
  {
    title: "Operación",
    items: [
      { to: "/messages", label: "Mensajes", icon: "✉️", badge: "msg" },
    ],
  },
  {
    title: "Sistema",
    items: [
      { to: "/settings", label: "Branding y settings", icon: "🎨" },
      { to: "/users", label: "Usuarios", icon: "👥" },
    ],
  },
];

export default function AdminLayout() {
  const nav = useNavigate();

  const msgs = useQuery({ queryKey: ["adm-msg"], queryFn: async () => (await api.get("/admin/contact-messages")).data });

  const msgCount = ((msgs.data ?? []) as any[]).filter((m) => m.status === "nuevo").length;
  const badges: Record<string, number> = { msg: msgCount };

  function logout() {
    localStorage.removeItem("token");
    nav("/login");
  }
  return (
    <div className="flex h-screen">
      <aside className="w-60 bg-brand text-white flex flex-col">
        <div className="px-4 py-4 border-b border-white/20">
          <div className="font-bold">Sanatorio Adventista</div>
          <div className="text-xs opacity-75">Panel de administración</div>
        </div>
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
                    `flex items-center gap-3 px-4 py-2 text-sm ${isActive ? "bg-white/15 font-semibold" : "hover:bg-white/10"}`
                  }
                >
                  <span>{n.icon}</span>
                  <span>{n.label}</span>
                  {count > 0 && <span className="ml-auto text-[10px] bg-red-500 text-white rounded-full px-1.5 py-0.5">{count}</span>}
                </NavLink>
              );
            };
            return (
              <>
                {renderItem(TOP)}
                {SECTIONS.map((s) => (
                  <div key={s.title}>
                    <div className="text-[10px] uppercase tracking-wide opacity-50 px-4 pt-3 pb-1">{s.title}</div>
                    {s.items.map(renderItem)}
                  </div>
                ))}
              </>
            );
          })()}
        </nav>
        <button onClick={logout} className="m-3 text-sm bg-white/10 hover:bg-white/20 rounded py-2">
          Cerrar sesión
        </button>
      </aside>
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
