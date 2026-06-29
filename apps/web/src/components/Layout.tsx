import { ReactNode, useEffect, useState } from "react";
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

function NavItem({ item, level = 0, onNavigate }: { item: MenuItem; level?: number; onNavigate?: () => void }) {
  const [open, setOpen] = useState(false);
  const hasChildren = !!item.children?.length;
  const isTopLevel = level === 0;

  if (!hasChildren) {
    if (isTopLevel) {
      return (
        <NavLink
          to={item.href}
          end
          onClick={onNavigate}
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
        onClick={onNavigate}
        className="block px-4 py-2 text-sm hover:bg-gray-50 hover:text-primary"
      >
        {item.label}
      </Link>
    );
  }

  return (
    <div
      className={isTopLevel ? "relative" : "relative w-full"}
      onMouseEnter={() => isTopLevel && setOpen(true)}
      onMouseLeave={() => isTopLevel && setOpen(false)}
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
                <NavItem item={c} level={level + 1} onNavigate={onNavigate} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function MobileNav({ items, onNavigate }: { items: MenuItem[]; onNavigate?: () => void }) {
  return (
    <ul className="divide-y divide-gray-100">
      {items.map((it, i) => (
        <li key={(it.href ?? "") + it.label + i}>
          <NavItem item={it} onNavigate={onNavigate} />
        </li>
      ))}
    </ul>
  );
}

function SocialIcon({ kind }: { kind: "facebook" | "instagram" | "youtube" | "linkedin" }) {
  const common = "w-4 h-4";
  switch (kind) {
    case "facebook":
      return (
        <svg viewBox="0 0 24 24" className={common} fill="currentColor" aria-hidden="true">
          <path d="M22 12.06C22 6.5 17.52 2 12 2S2 6.5 2 12.06c0 5 3.66 9.14 8.44 9.94v-7.03H7.9v-2.91h2.54V9.85c0-2.51 1.49-3.89 3.77-3.89 1.09 0 2.24.2 2.24.2v2.47h-1.26c-1.24 0-1.63.77-1.63 1.56v1.87h2.78l-.44 2.91h-2.34V22c4.78-.8 8.44-4.94 8.44-9.94z" />
        </svg>
      );
    case "instagram":
      return (
        <svg viewBox="0 0 24 24" className={common} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="5" />
          <circle cx="12" cy="12" r="4" />
          <circle cx="17.5" cy="6.5" r="1" fill="currentColor" />
        </svg>
      );
    case "youtube":
      return (
        <svg viewBox="0 0 24 24" className={common} fill="currentColor" aria-hidden="true">
          <path d="M23.5 6.2a3 3 0 00-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 00.5 6.2C0 8.1 0 12 0 12s0 3.9.5 5.8a3 3 0 002.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 002.1-2.1c.5-1.9.5-5.8.5-5.8s0-3.9-.5-5.8zM9.6 15.6V8.4l6.3 3.6-6.3 3.6z" />
        </svg>
      );
    case "linkedin":
      return (
        <svg viewBox="0 0 24 24" className={common} fill="currentColor" aria-hidden="true">
          <path d="M20.45 20.45h-3.55v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.36V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 11.01-4.12 2.06 2.06 0 010 4.12zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.72V1.72C24 .77 23.2 0 22.22 0z" />
        </svg>
      );
  }
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

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    if (!drawerOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [drawerOpen]);

  useEffect(() => {
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        setIsScrolled(window.scrollY > 8);
        ticking = false;
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-0 focus:left-0 focus:z-50 focus:bg-primary focus:text-white focus:px-4 focus:py-2">
        Saltar al contenido
      </a>
      <header
        className={`sticky top-0 z-40 transition-shadow duration-300 ${
          isScrolled ? "bg-white/80 backdrop-blur-md shadow-md" : "bg-white shadow-sm"
        }`}
      >
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
            <Link to="/turnos" className="btn-primary btn-sm">Turnos</Link>
          </nav>
          <button
            type="button"
            className="lg:hidden inline-flex items-center justify-center w-10 h-10 rounded text-primary hover:bg-gray-100"
            aria-label="Abrir menú"
            aria-expanded={drawerOpen}
            aria-controls="mobile-drawer"
            onClick={() => setDrawerOpen(true)}
          >
            <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
        </div>
      </header>

      <main id="main-content" className="flex-1">{children}</main>

      <footer className="bg-primary text-white mt-10">
        <div className="container-x py-12 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-10">
          <div>
            {brand?.logoUrl ? (
              <img src={brand.logoUrl} alt="" className="h-12 w-auto bg-white p-1 rounded mb-3" />
            ) : (
              <div className="text-lg font-bold mb-2">{brand?.name}</div>
            )}
            {brand?.tagline && (
              <p className="text-sm opacity-90 leading-relaxed">{brand.tagline}</p>
            )}
          </div>
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider opacity-80 mb-3">Contacto</h4>
            <ul className="space-y-1.5 text-sm">
              {contact?.address && <li className="opacity-90">{contact.address}</li>}
              {contact?.phones?.map((p: string) => (
                <li key={p}>
                  <a href={`tel:${p.replace(/[^0-9+]/g, "")}`} className="hover:underline opacity-90">{p}</a>
                </li>
              ))}
              {contact?.email && (
                <li>
                  <a href={`mailto:${contact.email}`} className="hover:underline opacity-90">{contact.email}</a>
                </li>
              )}
            </ul>
          </div>
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider opacity-80 mb-3">Enlaces</h4>
            <ul className="space-y-1.5">
              {footer.map((it) => (
                <li key={it.href}><Link to={it.href} className="text-sm hover:underline opacity-90">{it.label}</Link></li>
              ))}
            </ul>
          </div>
          <div>
            {contact?.hours && (
              <>
                <h4 className="text-xs font-semibold uppercase tracking-wider opacity-80 mb-3">Horarios</h4>
                <p className="text-sm opacity-90 whitespace-pre-line mb-6">{contact.hours}</p>
              </>
            )}
            <h4 className="text-xs font-semibold uppercase tracking-wider opacity-80 mb-3">Seguinos</h4>
            <div className="flex flex-wrap gap-3">
              {social.facebook && (
                <a href={social.facebook} target="_blank" rel="noreferrer" aria-label="Facebook" className="w-9 h-9 inline-flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 transition">
                  <SocialIcon kind="facebook" />
                </a>
              )}
              {social.instagram && (
                <a href={social.instagram} target="_blank" rel="noreferrer" aria-label="Instagram" className="w-9 h-9 inline-flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 transition">
                  <SocialIcon kind="instagram" />
                </a>
              )}
              {social.youtube && (
                <a href={social.youtube} target="_blank" rel="noreferrer" aria-label="YouTube" className="w-9 h-9 inline-flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 transition">
                  <SocialIcon kind="youtube" />
                </a>
              )}
              {social.linkedin && (
                <a href={social.linkedin} target="_blank" rel="noreferrer" aria-label="LinkedIn" className="w-9 h-9 inline-flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 transition">
                  <SocialIcon kind="linkedin" />
                </a>
              )}
            </div>
          </div>
        </div>
        <div className="border-t border-white/10 py-4 text-center text-xs opacity-70">
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

      <div
        className={`lg:hidden fixed inset-0 z-[60] ${drawerOpen ? "" : "pointer-events-none"}`}
        aria-hidden={!drawerOpen}
      >
        <div
          className={`absolute inset-0 bg-black/50 transition-opacity duration-200 ${drawerOpen ? "opacity-100" : "opacity-0"}`}
          onClick={() => setDrawerOpen(false)}
        />
        <div
          id="mobile-drawer"
          role="dialog"
          aria-modal="true"
          aria-label="Menú principal"
          className={`absolute top-0 right-0 h-full w-72 max-w-[85vw] bg-white shadow-xl flex flex-col transform transition-transform duration-200 ${drawerOpen ? "translate-x-0" : "translate-x-full"}`}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <span className="font-semibold text-primary">Menú</span>
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              aria-label="Cerrar menú"
              className="w-9 h-9 inline-flex items-center justify-center rounded text-gray-600 hover:bg-gray-100"
            >
              <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <nav className="flex-1 overflow-y-auto py-2" aria-label="Navegación móvil">
            <MobileNav items={header} onNavigate={() => setDrawerOpen(false)} />
          </nav>
          <div className="p-4 border-t">
            <Link
              to="/turnos"
              onClick={() => setDrawerOpen(false)}
              className="btn-primary btn-sm w-full text-center block"
            >
              Turnos
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
