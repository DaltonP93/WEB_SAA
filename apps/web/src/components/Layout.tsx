import { ReactNode, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, NavLink } from "react-router-dom";
import { api } from "../api";
import type { SiteSettings } from "@sa/shared";

interface Props {
  children: ReactNode;
  settings: SiteSettings;
}

interface MenuItem {
  label: string;
  href: string;
  children?: MenuItem[];
}

function NavItem({ item, level = 0 }: { item: MenuItem; level?: number }) {
  const [open, setOpen] = useState(false);
  const hasChildren = !!item.children?.length;
  const isTopLevel = level === 0;

  // Hoja (sin hijos): link clickeable
  if (!hasChildren) {
    if (isTopLevel) {
      return (
        <NavLink
          to={item.href}
          end
          className={({ isActive }) =>
            `text-sm hover:text-primary px-1 py-2 ${isActive ? "text-primary font-medium" : ""}`
          }
        >
          {item.label}
        </NavLink>
      );
    }
    return (
      <Link
        to={item.href}
        className="block px-4 py-2 text-sm hover:bg-gray-50 hover:text-primary"
      >
        {item.label}
      </Link>
    );
  }

  // Tiene hijos: botón con submenu
  return (
    <div
      className={isTopLevel ? "relative" : "relative w-full"}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className={
          isTopLevel
            ? "text-sm hover:text-primary px-1 py-2 inline-flex items-center gap-1"
            : "w-full flex items-center justify-between px-4 py-2 text-sm hover:bg-gray-50 hover:text-primary"
        }
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span>{item.label}</span>
        {isTopLevel ? (
          <svg viewBox="0 0 20 20" className="w-3 h-3 fill-current" aria-hidden="true">
            <path d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z" />
          </svg>
        ) : (
          <svg viewBox="0 0 20 20" className="w-3 h-3 fill-current ml-2" aria-hidden="true">
            <path d="M7.21 14.77a.75.75 0 01.02-1.06L11.06 10 7.23 6.29a.75.75 0 011.04-1.08l4.39 4.25a.75.75 0 010 1.08l-4.39 4.25a.75.75 0 01-1.06-.02z" />
          </svg>
        )}
      </button>
      {open && (
        <div
          className={
            isTopLevel
              ? "absolute left-0 top-full pt-1 min-w-[240px] z-50"
              : "absolute left-full top-0 pl-1 min-w-[240px] z-50"
          }
        >
          <ul className="bg-white border rounded shadow-lg py-1">
            {item.children!.map((c, i) => (
              <li key={(c.href ?? "") + c.label + i}>
                <NavItem item={c} level={level + 1} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function Layout({ children, settings }: Props) {
  const menusQ = useQuery({
    queryKey: ["menus"],
    queryFn: async () => (await api.get("/public/menus")).data as { header?: MenuItem[]; footer?: MenuItem[] },
  });
  const header = menusQ.data?.header ?? [];
  const footer = menusQ.data?.footer ?? [];
  const brand = settings?.brand;
  const contact = settings?.contact;
  const social = settings?.social ?? {};
  const wa = contact?.whatsapp?.replace(/[^0-9]/g, "");

  return (
    <div className="min-h-screen flex flex-col">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-0 focus:left-0 focus:z-50 focus:bg-primary focus:text-white focus:px-4 focus:py-2">
        Saltar al contenido
      </a>
      <header className="bg-white shadow-sm sticky top-0 z-40">
        <div className="container-x flex items-center justify-between py-3">
          <Link to="/" className="flex items-center gap-3" aria-label={brand?.name ?? "Inicio"}>
            {brand?.logoUrl ? (
              <img src={brand.logoUrl} alt={brand?.name ?? ""} className="h-10 w-auto" />
            ) : (
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded bg-primary text-white flex items-center justify-center font-bold">SA</div>
                <span className="font-heading text-primary font-bold text-lg leading-tight">
                  {brand?.name ?? "Sanatorio Adventista"}
                </span>
              </div>
            )}
          </Link>
          <nav className="hidden lg:flex items-center gap-4" aria-label="Navegación principal">
            {header.map((it) => (
              <NavItem key={it.href + it.label} item={it} />
            ))}
            <Link to="/turnos" className="btn-primary text-sm">Turnos</Link>
          </nav>
        </div>
      </header>

      <main id="main-content" className="flex-1">{children}</main>

      <footer className="bg-primary text-white mt-10">
        <div className="container-x py-10 grid md:grid-cols-3 gap-8">
          <div>
            {brand?.logoUrl ? (
              <img src={brand.logoUrl} alt="" className="h-12 w-auto bg-white p-1 rounded mb-3" />
            ) : (
              <div className="text-lg font-bold mb-2">{brand?.name}</div>
            )}
            <p className="text-sm opacity-90">{brand?.tagline}</p>
          </div>
          <div>
            <h4 className="font-semibold mb-2">Contacto</h4>
            <p className="text-sm">{contact?.address}</p>
            {contact?.phones?.map((p: string) => <p key={p} className="text-sm">{p}</p>)}
            <p className="text-sm">{contact?.email}</p>
            <p className="text-sm mt-2 opacity-80">{contact?.hours}</p>
          </div>
          <div>
            <h4 className="font-semibold mb-2">Enlaces</h4>
            <ul className="space-y-1">
              {footer.map((it) => (
                <li key={it.href}><Link to={it.href} className="text-sm hover:underline">{it.label}</Link></li>
              ))}
            </ul>
            <div className="mt-3 flex gap-3 text-sm">
              {social.facebook && <a href={social.facebook} className="hover:underline">Facebook</a>}
              {social.instagram && <a href={social.instagram} className="hover:underline">Instagram</a>}
              {social.youtube && <a href={social.youtube} className="hover:underline">YouTube</a>}
            </div>
          </div>
        </div>
        <div className="border-t border-white/20 py-3 text-center text-xs opacity-75">
          © {new Date().getFullYear()} {brand?.name}
        </div>
      </footer>

      {wa && (
        <a
          href={`https://wa.me/${wa}`}
          target="_blank"
          rel="noreferrer"
          className="fixed bottom-5 right-5 z-50 bg-green-500 text-white rounded-full w-14 h-14 flex items-center justify-center shadow-lg hover:scale-105 transition"
          aria-label="WhatsApp"
        >
          <svg viewBox="0 0 24 24" className="w-7 h-7" fill="currentColor"><path d="M20.52 3.48A11.84 11.84 0 0 0 12.05 0C5.5 0 .17 5.32.17 11.86c0 2.09.55 4.13 1.6 5.93L0 24l6.36-1.66a11.86 11.86 0 0 0 5.69 1.45h.01c6.55 0 11.88-5.32 11.88-11.86 0-3.17-1.24-6.15-3.41-8.45zM12.06 21.4h-.01a9.65 9.65 0 0 1-4.92-1.35l-.35-.21-3.78.99 1.01-3.68-.23-.38a9.61 9.61 0 0 1-1.48-5.11c0-5.31 4.34-9.63 9.67-9.63 2.58 0 5.01 1 6.84 2.83a9.55 9.55 0 0 1 2.83 6.82c0 5.32-4.33 9.72-9.58 9.72zm5.53-7.27c-.3-.15-1.79-.88-2.07-.98-.28-.1-.48-.15-.69.15s-.79.98-.97 1.18c-.18.2-.36.22-.66.07-.3-.15-1.27-.47-2.42-1.5-.89-.79-1.49-1.77-1.67-2.07-.18-.3-.02-.46.13-.61.13-.13.3-.36.45-.54.15-.18.2-.3.3-.5.1-.2.05-.38-.02-.53-.07-.15-.66-1.6-.91-2.19-.24-.58-.49-.5-.67-.5l-.57-.01c-.2 0-.53.07-.81.38-.28.3-1.06 1.03-1.06 2.52 0 1.48 1.09 2.92 1.24 3.12.15.2 2.14 3.27 5.19 4.58.73.31 1.29.5 1.73.64.73.23 1.39.2 1.91.12.58-.09 1.79-.73 2.04-1.43.25-.7.25-1.31.18-1.43-.08-.13-.28-.2-.58-.35z"/></svg>
        </a>
      )}
    </div>
  );
}
