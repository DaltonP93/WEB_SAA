import { ReactNode, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, NavLink } from "react-router-dom";
import { api } from "../api";
import type { SiteSettings } from "@sa/shared";
import SocialIcon, { type SocialKind } from "./SocialIcon";
import { CHANNEL_KEYS, channelHref, useContactChannels, socialChannels, useSchedules } from "../lib/contact-channels";
import { isSafeExternalHref, safeInternalHref } from "../lib/url";

interface Props {
  children: ReactNode;
  settings: SiteSettings;
}

interface MenuItem {
  label: string;
  href: string;
  children?: MenuItem[];
}

const MAPS_URL_FALLBACK =
  "https://www.google.com/maps/search/?api=1&query=Sanatorio+Adventista+Asunci%C3%B3n+Paraguay";

function Chevron({ down }: { down: boolean }) {
  return down ? (
    <svg viewBox="0 0 20 20" className="w-3 h-3 fill-current" aria-hidden="true">
      <path d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z" />
    </svg>
  ) : (
    <svg viewBox="0 0 20 20" className="w-3 h-3 fill-current ml-2" aria-hidden="true">
      <path d="M7.21 14.77a.75.75 0 01.02-1.06L11.06 10 7.23 6.29a.75.75 0 011.04-1.08l4.39 4.25a.75.75 0 010 1.08l-4.39 4.25a.75.75 0 01-1.06-.02z" />
    </svg>
  );
}

function NavItem({ item, level = 0, onNavigate }: { item: MenuItem; level?: number; onNavigate?: () => void }) {
  const [open, setOpen] = useState(false);
  const hasChildren = !!item.children?.length;
  const isTopLevel = level === 0;
  // Un item con href propio siempre navega; el desplegable se abre aparte.
  const hasOwnPage = !!item.href && item.href !== "#";
  const href = safeInternalHref(item.href);

  if (!hasChildren) {
    if (isTopLevel) {
      return (
        <NavLink
          to={href}
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
        to={href}
        onClick={onNavigate}
        className="block px-4 py-2 text-sm hover:bg-gray-50 hover:text-primary"
      >
        {item.label}
      </Link>
    );
  }

  const triggerClass = isTopLevel
    ? "text-sm hover:text-primary px-1 py-2 inline-flex items-center gap-1"
    : "w-full flex items-center justify-between px-4 py-2 text-sm hover:bg-gray-50 hover:text-primary";

  return (
    <div
      className={isTopLevel ? "relative" : "relative w-full"}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      {hasOwnPage ? (
        <div className={isTopLevel ? "inline-flex items-center" : "flex items-center justify-between w-full"}>
          <NavLink
            to={href}
            onClick={onNavigate}
            className={({ isActive }) =>
              isTopLevel
                ? `text-sm hover:text-primary px-1 py-2 ${isActive ? "text-primary font-medium" : ""}`
                : `block px-4 py-2 text-sm hover:bg-gray-50 hover:text-primary ${isActive ? "text-primary font-medium" : ""}`
            }
          >
            {item.label}
          </NavLink>
          <button
            type="button"
            className={isTopLevel ? "px-1 py-2 text-current hover:text-primary" : "px-3 py-2 hover:text-primary"}
            aria-haspopup="true"
            aria-expanded={open}
            aria-label={`Ver secciones de ${item.label}`}
            onClick={() => setOpen((o) => !o)}
          >
            <Chevron down={isTopLevel} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          className={triggerClass}
          aria-haspopup="true"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <span>{item.label}</span>
          <Chevron down={isTopLevel} />
        </button>
      )}
      {open && (
        <div
          className={
            isTopLevel
              ? "absolute left-0 top-full pt-1 min-w-[260px] z-50"
              : "absolute left-full top-0 pl-1 min-w-[260px] z-50"
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

/**
 * En el drawer mobile los submenús se despliegan en línea (acordeón): un panel
 * flotante como el del desktop no entra en 288px de ancho.
 */
function MobileNavItem({ item, level = 0, onNavigate }: { item: MenuItem; level?: number; onNavigate?: () => void }) {
  const [open, setOpen] = useState(false);
  const hasChildren = !!item.children?.length;
  const href = safeInternalHref(item.href);
  const indent = { paddingLeft: `${1 + level}rem` };
  const linkClass = "block flex-1 py-3 text-sm hover:text-primary";

  if (!hasChildren) {
    return (
      <Link to={href} onClick={onNavigate} className={linkClass} style={indent}>
        {item.label}
      </Link>
    );
  }

  return (
    <div>
      <div className="flex items-center">
        <Link to={href} onClick={onNavigate} className={linkClass} style={indent}>
          {item.label}
        </Link>
        <button
          type="button"
          className="px-4 py-3 text-gray-500 hover:text-primary"
          aria-expanded={open}
          aria-label={`Ver secciones de ${item.label}`}
          onClick={() => setOpen((o) => !o)}
        >
          <svg viewBox="0 0 20 20" className={`w-4 h-4 fill-current transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true">
            <path d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z" />
          </svg>
        </button>
      </div>
      {open && (
        <ul className="bg-gray-50 border-t border-gray-100 divide-y divide-gray-100">
          {item.children!.map((c, i) => (
            <li key={(c.href ?? "") + c.label + i}>
              <MobileNavItem item={c} level={level + 1} onNavigate={onNavigate} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MobileNav({ items, onNavigate }: { items: MenuItem[]; onNavigate?: () => void }) {
  return (
    <ul className="divide-y divide-gray-100">
      {items.map((it, i) => (
        <li key={(it.href ?? "") + it.label + i}>
          <MobileNavItem item={it} onNavigate={onNavigate} />
        </li>
      ))}
    </ul>
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
  // Un enlace mal cargado en el panel no puede convertirse en javascript:
  const mapsUrl = isSafeExternalHref(contact?.mapsUrl) ? contact!.mapsUrl!.trim() : MAPS_URL_FALLBACK;

  // Header y footer leen de la misma tabla que los bloques de contacto.
  const { channels, get, firstWithValue } = useContactChannels();
  // Los horarios del pie salen de la tabla `schedules`, igual que la página
  // de Horarios: no hay una copia suelta en settings.
  const { schedules } = useSchedules();
  const emergency = get(CHANNEL_KEYS.emergencias);
  const emergencyHref = emergency ? channelHref(emergency) : undefined;
  const emergencyPhone = emergency?.value ?? null;
  const whatsapp = firstWithValue(CHANNEL_KEYS.turnos, CHANNEL_KEYS.general);
  const whatsappHref = whatsapp ? channelHref(whatsapp) : undefined;
  const gth = get(CHANNEL_KEYS.gth);
  const gthHref = gth ? channelHref(gth) : undefined;
  // Teléfonos y correos del pie: también salen de Canales de contacto.
  const footerChannels = channels.filter(
    (c) => c.value && c.key !== CHANNEL_KEYS.emergencias && c.key !== CHANNEL_KEYS.gth,
  );

  // Las redes también salen de Canales de contacto: antes vivían aparte en
  // settings.social y se podían editar por duplicado.
  const socialLinks = socialChannels(channels)
    .map((s) => ({ kind: s.key as SocialKind, href: s.href }))
    .filter((s) => isSafeExternalHref(s.href));

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
            <a
              href={emergencyHref ?? "/emergencias"}
              className="btn-emergency btn-sm gap-1.5 whitespace-nowrap"
              aria-label={emergencyPhone ? `Emergencias 24hs: ${emergencyPhone}` : "Emergencias 24hs"}
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
              </svg>
              <span>Emergencias</span>
              {emergencyPhone && <span className="hidden xl:inline">{emergencyPhone}</span>}
            </a>
            <Link to="/turnos" className="btn-turno btn-sm whitespace-nowrap">Reservar turno</Link>
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
            {emergency && (
              emergencyHref ? (
                <a
                  href={emergencyHref}
                  className="mt-4 inline-flex items-center gap-2 rounded bg-accent px-3 py-2 text-sm font-semibold hover:bg-accent-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white transition"
                >
                  Emergencias 24hs · {emergencyPhone}
                </a>
              ) : (
                <span className="mt-4 inline-flex items-center gap-2 rounded bg-white/10 px-3 py-2 text-sm">
                  Emergencias 24hs · número a confirmar
                </span>
              )
            )}
          </div>
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider opacity-80 mb-3">Contacto</h4>
            <ul className="space-y-1.5 text-sm">
              {contact?.address && <li className="opacity-90">{contact.address}</li>}
              {footerChannels.map((c) => {
                const href = channelHref(c);
                if (!href) return null;
                const external = href.startsWith("http");
                return (
                  <li key={c.key}>
                    <a
                      href={href}
                      className="hover:underline opacity-90"
                      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
                    >
                      {c.label}: {c.value}
                    </a>
                  </li>
                );
              })}
              {gthHref && (
                <li>
                  <a href={gthHref} className="hover:underline opacity-90">
                    Trabajá con nosotros: {gth?.value}
                  </a>
                </li>
              )}
              <li>
                <a href={mapsUrl} target="_blank" rel="noreferrer" className="hover:underline opacity-90">
                  Cómo llegar
                </a>
              </li>
            </ul>
          </div>
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider opacity-80 mb-3">Enlaces</h4>
            <ul className="space-y-1.5">
              {footer.map((it) => (
                <li key={it.href}>
                  <Link to={safeInternalHref(it.href)} className="text-sm hover:underline opacity-90">
                    {it.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider opacity-80 mb-3">Horarios</h4>
            {schedules.length > 0 ? (
              <ul className="text-sm opacity-90 mb-6 space-y-1">
                {schedules.slice(0, 4).map((s) => (
                  <li key={s.id}>
                    <span className="font-medium">{s.area}:</span> {s.hours}
                  </li>
                ))}
              </ul>
            ) : (
              /* Sin horarios confirmados no publicamos ninguno: enlazamos a la
                 página donde se cargan a medida que el sanatorio los define. */
              <p className="text-sm opacity-90 mb-6">
                <Link to="/horarios" className="underline hover:no-underline">
                  Ver horarios de atención
                </Link>
              </p>
            )}
            <h4 className="text-xs font-semibold uppercase tracking-wider opacity-80 mb-3">Conócenos en nuestras redes</h4>
            <div className="flex flex-wrap gap-3">
              {socialLinks.map((s) => (
                <a
                  key={s.kind}
                  href={s.href}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={s.kind}
                  className="w-9 h-9 inline-flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 transition"
                >
                  <SocialIcon kind={s.kind} />
                </a>
              ))}
              {whatsappHref && (
                <a
                  href={whatsappHref}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="WhatsApp"
                  className="w-9 h-9 inline-flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 transition"
                >
                  <SocialIcon kind="whatsapp" />
                </a>
              )}
            </div>
          </div>
        </div>
        <div className="border-t border-white/10 py-4 text-center text-xs opacity-70">
          © {new Date().getFullYear()} {brand?.name}
        </div>
      </footer>

      {whatsappHref && (
        <a
          href={whatsappHref}
          target="_blank"
          rel="noreferrer"
          className="fixed bottom-5 right-5 z-50 bg-green-600 text-white rounded-full w-14 h-14 flex items-center justify-center shadow-lg hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-700 focus-visible:ring-offset-2 transition"
          aria-label={whatsapp?.label ?? "WhatsApp"}
        >
          <SocialIcon kind="whatsapp" className="w-7 h-7" />
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
          <div className="p-4 border-t space-y-2">
            <Link
              to="/turnos"
              onClick={() => setDrawerOpen(false)}
              className="btn-turno btn-sm w-full text-center block"
            >
              Reservar turno
            </Link>
            <a
              href={emergencyHref ?? "/emergencias"}
              onClick={() => setDrawerOpen(false)}
              className="btn-emergency btn-sm w-full text-center block"
            >
              {emergencyPhone ? `Emergencias ${emergencyPhone}` : "Emergencias 24hs"}
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
