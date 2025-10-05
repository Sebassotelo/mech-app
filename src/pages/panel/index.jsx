// /pages/dashboard/index.js
import Inventario from "@/componentes/panel/Inventario";
import Ventas from "@/componentes/panel/Ventas";
import HistorialVentas from "@/componentes/panel/HistorialVentas";
import React, { useEffect, useMemo, useRef, useState, useContext } from "react";
import ContextGeneral from "@/servicios/contextGeneral";
import { toast } from "sonner";
import HomeOverview from "@/componentes/panel/HomeOverview";
import Stock from "@/componentes/panel/Stock";

export default function Dashboard() {
  const ctx = useContext(ContextGeneral);
  const didFetch = useRef(false);

  const [location, setLocation] = useState("pv1"); // pv1 | pv2 | taller
  const [active, setActive] = useState("home"); // home | ventas | inventario | stock | historial | reportes
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // ───────────────── Fetch inicial
  useEffect(() => {
    if (!ctx || didFetch.current) return;
    didFetch.current = true;

    const needCats =
      !Array.isArray(ctx.categorias) || ctx.categorias.length === 0;
    const needProds =
      !Array.isArray(ctx.productos) || ctx.productos.length === 0;
    const needVentas = !Array.isArray(ctx.ventas) || ctx.ventas.length === 0;

    if (!needCats && !needProds && !needVentas) return;

    try {
      ctx.setLoader?.(true);
      const tasks = [];
      if (needCats && typeof ctx.fetchCategorias === "function") {
        tasks.push(ctx.fetchCategorias());
      }
      if (needProds && typeof ctx.fetchProductos === "function") {
        tasks.push(ctx.fetchProductos());
      }
      if (needVentas && typeof ctx.fetchVentas === "function") {
        tasks.push(ctx.fetchVentas());
      }
      Promise.all(tasks)
        .catch((e) => {
          console.error(e);
          toast.error("No se pudieron cargar datos iniciales");
        })
        .finally(() => ctx.setLoader?.(false));
    } catch (e) {
      console.error(e);
      ctx.setLoader?.(false);
    }
  }, [ctx]);

  // ───────────────── Persistencia
  useEffect(() => {
    try {
      const a = localStorage.getItem("mx.active");
      const l = localStorage.getItem("mx.location");
      if (a) setActive(a);
      if (l) setLocation(l);
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("mx.active", active);
    } catch {}
  }, [active]);
  useEffect(() => {
    try {
      localStorage.setItem("mx.location", location);
    } catch {}
  }, [location]);

  // ───────────────── Nav dinámico
  const navItems = useMemo(() => {
    if (location === "taller") {
      return [{ id: "home", label: "Inicio", icon: HomeIcon }];
    }
    return [
      { id: "home", label: "Inicio", icon: HomeIcon },
      { id: "ventas", label: "Ventas", icon: CartIcon },
      { id: "inventario", label: "Inventario", icon: BoxIcon },
      { id: "stock", label: "Stock", icon: StockIcon },
      { id: "historial", label: "Historial de ventas", icon: HistoryIcon },
    ];
  }, [location]);

  useEffect(() => {
    const validIds = new Set(navItems.map((n) => n.id));
    if (!validIds.has(active)) setActive(defaultActiveFor(location));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location, navItems]);

  const CurrentView = useMemo(() => {
    if (active === "ventas") return <VentasView location={location} />;
    if (active === "inventario") return <InventarioView location={location} />;
    if (active === "stock") return <StockView location={location} />;
    if (active === "historial") return <HistorialView location={location} />;
    if (active === "reportes") return <ReportesView location={location} />;
    return <HomeView location={location} />;
  }, [active, location]);

  // ───────────────── Mobile: bloquear scroll + cerrar con ESC y click fuera
  const drawerRef = useRef(null);
  useEffect(() => {
    if (mobileNavOpen) {
      document.body.classList.add("overflow-hidden");
    } else {
      document.body.classList.remove("overflow-hidden");
    }
    const onKey = (e) => {
      if (e.key === "Escape") setMobileNavOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.classList.remove("overflow-hidden");
      document.removeEventListener("keydown", onKey);
    };
  }, [mobileNavOpen]);

  const handleLocationChange = (loc) => {
    if (loc === "taller") {
      toast.info("Módulo Taller: próximamente");
      setLocation("taller");
      setActive("home");
    } else {
      setLocation(loc);
      if (active === "home" || location === "taller") {
        setActive(defaultActiveFor(loc));
      }
    }
  };

  const handleNavClick = (id) => {
    setActive(id);
    setMobileNavOpen(false); // cerrar el drawer al navegar
  };

  return (
    <div className="min-h-screen flex bg-[#0C212D] text-white overflow-x-hidden">
      {/* ───────── Sidebar desktop ───────── */}
      <aside className="hidden md:flex w-72 xl:w-80 bg-[#112C3E]/90 backdrop-blur-md border-r border-white/10 flex-col">
        <SidebarHeader
          location={location}
          onChangeLocation={handleLocationChange}
        />
        <NavList navItems={navItems} active={active} onClickItem={setActive} />
        <div className="p-4 border-t border-white/10 text-xs text-white/50">
          © {new Date().getFullYear()} Mecánico App
        </div>
      </aside>

      {/* ───────── Drawer mobile ───────── */}
      {/* Overlay */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onMouseDown={() => setMobileNavOpen(false)}
          aria-hidden="true"
        />
      )}
      {/* Panel */}
      <div
        ref={drawerRef}
        className={`fixed z-50 inset-y-0 left-0 w-72 bg-[#112C3E] border-r border-white/10 md:hidden transition-transform duration-200 ${
          mobileNavOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Menú de navegación"
      >
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <div>
            <p className="text-xs text-white/60 leading-none">Mecánico App</p>
            <h1 className="text-base font-semibold">Panel</h1>
          </div>
          <button
            onClick={() => setMobileNavOpen(false)}
            className="p-2 rounded-lg hover:bg-white/10"
            aria-label="Cerrar menú"
          >
            <XIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="p-4 border-b border-white/10">
          <p className="text-[11px] uppercase tracking-widest text-white/50 mb-2">
            Seleccioná la sede
          </p>
          <LocationDropdown value={location} onChange={handleLocationChange} />
        </div>

        <nav className="flex-1 p-3 overflow-y-auto">
          <NavList
            navItems={navItems}
            active={active}
            onClickItem={handleNavClick}
          />
        </nav>

        <div className="p-4 border-t border-white/10 text-xs text-white/50">
          © {new Date().getFullYear()} Mecánico App
        </div>
      </div>

      {/* ───────── Contenido ───────── */}
      <main className="flex-1 min-w-0 overflow-x-hidden">
        {/* Topbar mobile */}
        <div className="md:hidden sticky top-0 z-30 bg-[#0C212D]/95 backdrop-blur border-b border-white/10">
          <div className="mx-auto w-full max-w-screen-xl px-4 py-3 flex items-center justify-between">
            <button
              onClick={() => setMobileNavOpen(true)}
              className="p-2 rounded-lg hover:bg-white/10"
              aria-label="Abrir menú"
            >
              <MenuIcon className="h-5 w-5" />
            </button>
            <div className="min-w-0 text-center">
              <h2 className="text-base font-semibold tracking-tight truncate">
                {titleFor(active, location)}
              </h2>
              <p className="text-xs text-white/60 truncate">
                {subtitleFor(active, location)}
              </p>
            </div>
            {/* Badge sede compacto */}
            <span
              className={`inline-flex items-center gap-2 text-xs px-2.5 py-1 rounded-xl bg-white/5 ring-1 ring-white/10`}
            >
              <Dot className={dotColor(location)} />
              {location === "pv1"
                ? "PV1"
                : location === "pv2"
                ? "PV2"
                : "Taller"}
            </span>
          </div>
        </div>

        {/* Contenedor limitado y centrado */}
        <div className="mx-auto w-full max-w-screen-xl px-4 sm:px-6 py-6">
          {/* Encabezado desktop */}
          <div className="hidden md:flex items-start sm:items-center justify-between mb-6 gap-3">
            <div className="min-w-0">
              <h2 className="text-2xl font-semibold tracking-tight truncate">
                {titleFor(active, location)}
              </h2>
              <p className="text-white/60 text-sm">
                {subtitleFor(active, location)}
              </p>
            </div>

            <span
              className={`hidden sm:inline-flex items-center gap-3 text-sm px-4 py-2 rounded-2xl bg-white/5 ring-1 ring-white/10
              ${location === "taller" ? "opacity-80" : ""}`}
            >
              <Dot className={dotColor(location)} />
              <strong className="font-semibold">
                {location === "pv1"
                  ? "Punto de Venta 1"
                  : location === "pv2"
                  ? "Punto de Venta 2"
                  : "Taller"}
              </strong>
              {location === "taller" && (
                <span className="ml-1 text-[11px] px-2 py-0.5 rounded-lg bg-white/5 ring-1 ring-white/10">
                  Próximamente
                </span>
              )}
            </span>
          </div>

          {/* (mobile) Sin tabs ni selector redundante: todo via menú hamburguesa */}

          {/* Visualizador limitado + overflow local (X) */}
          <div className="rounded-2xl bg-[#112C3E]/80 border border-white/10 shadow-xl min-w-0">
            <div className="min-w-0 w-full overflow-x-auto overscroll-x-contain">
              <div className="p-4 sm:p-6 min-w-0">
                {location === "taller" ? <TallerPlaceholder /> : CurrentView}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

/* ───────── Sidebar Header reutilizable ───────── */
function SidebarHeader({ location, onChangeLocation }) {
  return (
    <div className="p-5 border-b border-white/10">
      <div className="mb-4">
        <p className="text-xs text-white/60 leading-none">Mecánico App</p>
        <h1 className="text-base font-semibold">Panel</h1>
      </div>
      <p className="text-[11px] uppercase tracking-widest text-white/50 mb-2">
        Seleccioná la sede
      </p>
      <LocationDropdown value={location} onChange={onChangeLocation} />
    </div>
  );
}

/* ───────── Listado de navegación (desktop + mobile) ───────── */
function NavList({ navItems, active, onClickItem }) {
  return (
    <ul className="space-y-2">
      {navItems.map(({ id, label, icon: Icon }) => {
        const isActive = active === id;
        return (
          <li key={id}>
            <button
              onClick={() => onClickItem(id)}
              className={`group w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition relative
              ${
                isActive
                  ? "bg-white/10 ring-1 ring-white/10"
                  : "hover:bg-white/5"
              }`}
            >
              <span
                className={`absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 rounded-r
                ${
                  isActive
                    ? "bg-gradient-to-b from-[#EE7203] to-[#FF3816]"
                    : "bg-transparent"
                }`}
              />
              <Icon
                className={`h-5 w-5 ${
                  isActive ? "" : "opacity-80 group-hover:opacity-100"
                }`}
              />
              <span className="text-sm">{label}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/* ───────── Dropdown de sede con click-outside ───────── */
function LocationDropdown({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function onDocMouseDown(e) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, []);

  const label =
    value === "pv1"
      ? "Punto de Venta 1"
      : value === "pv2"
      ? "Punto de Venta 2"
      : "Taller";
  const ring =
    value === "pv1"
      ? "ring-[#EE7203]/60"
      : value === "pv2"
      ? "ring-[#FF3816]/60"
      : "ring-emerald-400/60";

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-[#0C212D] border border-white/10
          text-sm outline-none focus:ring-2 ${ring} transition`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          <Dot className={dotColor(value)} />
          <span className="font-medium">{label}</span>
          {value === "taller" && (
            <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-white/5 ring-1 ring-white/10">
              Próximamente
            </span>
          )}
        </span>
        <ChevronDown
          className={`h-4 w-4 ${open ? "rotate-180" : ""} transition`}
        />
      </button>

      {open && (
        <ul
          role="listbox"
          className="absolute z-20 mt-2 w-full rounded-xl overflow-hidden border border-white/10 bg-[#0E2330] shadow-2xl"
        >
          <LocationOption
            id="pv1"
            active={value === "pv1"}
            label="Punto de Venta 1"
            desc="Ventas, inventario y stock."
            onSelect={() => {
              onChange("pv1");
              setOpen(false);
            }}
            grad="from-[#EE7203]/80 to-[#FF3816]/80"
          />
          <LocationOption
            id="pv2"
            active={value === "pv2"}
            label="Punto de Venta 2"
            desc="Ventas, inventario y stock."
            onSelect={() => {
              onChange("pv2");
              setOpen(false);
            }}
            grad="from-[#FF3816]/80 to-[#EE7203]/80"
          />
          <LocationOption
            id="taller"
            active={value === "taller"}
            label="Taller"
            desc="Gestión de OT. (no funcional)"
            disabled
            onSelect={() => {
              onChange("taller");
              setOpen(false);
            }}
            grad="from-emerald-500/70 to-teal-500/70"
          />
        </ul>
      )}
    </div>
  );
}

function LocationOption({ id, active, label, desc, onSelect, disabled, grad }) {
  return (
    <li>
      <button
        role="option"
        aria-selected={active}
        disabled={disabled}
        onMouseDown={(e) => {
          e.preventDefault();
          if (!disabled) onSelect();
        }}
        className={`w-full flex items-center gap-3 px-3.5 py-2.5 text-left
          ${disabled ? "opacity-70 cursor-not-allowed" : "hover:bg-white/5"}
          ${active ? "bg-white/5" : ""}`}
      >
        <span
          className={`h-8 w-8 rounded-lg ring-1 ring-white/10 bg-gradient-to-br ${grad} flex items-center justify-center`}
        >
          {id === "taller" ? (
            <WrenchIcon className="h-4 w-4" />
          ) : (
            <CartIcon className="h-4 w-4" />
          )}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold truncate">{label}</span>
            {id === "taller" && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 ring-1 ring-white/10">
                Próximamente
              </span>
            )}
          </div>
          <p className="text-xs text-white/60">{desc}</p>
        </div>
        {active ? <CheckIcon className="h-4 w-4 text-white/80" /> : null}
      </button>
    </li>
  );
}

/* ───────── Views ───────── */
function HomeView({ location }) {
  return (
    <div className="space-y-4 min-w-0">
      <HomeOverview location={location} />
    </div>
  );
}
function VentasView({ location }) {
  return (
    <div className="space-y-4 min-w-0">
      <Ventas location={location} />
    </div>
  );
}
function InventarioView() {
  return (
    <div className="space-y-4 min-w-0">
      <Inventario />
    </div>
  );
}
function StockView({ location }) {
  return (
    <div className="space-y-4 min-w-0">
      <Stock location={location} />
    </div>
  );
}
function HistorialView({ location }) {
  return (
    <div className="space-y-4 min-w-0">
      <HistorialVentas location={location} />
    </div>
  );
}
function ReportesView() {
  return <div className="space-y-4 min-w-0" />;
}

/* ───────── Placeholder Taller ───────── */
function TallerPlaceholder() {
  return (
    <div className="rounded-xl border border-white/10 p-6 bg-white/5">
      <div className="flex items-start gap-4">
        <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-emerald-500/70 to-teal-500/70 flex items-center justify-center ring-1 ring-white/10">
          <WrenchIcon className="h-6 w-6" />
        </div>
        <div className="min-w-0">
          <h3 className="text-lg font-semibold">Módulo de Taller</h3>
          <p className="text-sm text-white/70 mt-1">
            Estamos preparando la gestión de órdenes de trabajo, repuestos, mano
            de obra, estados y pagos. Mientras tanto, podés operar en PV1 y PV2.
          </p>
          <ul className="mt-3 text-sm text-white/70 list-disc ml-5 space-y-1">
            <li>Multi-sede y multi-org (orgId, locationId).</li>
            <li>Órdenes, repuestos, mano de obra y estados.</li>
            <li>Pagos, adjuntos y notificaciones al cliente.</li>
          </ul>
          <div className="mt-4 inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg bg-white/5 ring-1 ring-white/10">
            <Dot className="bg-emerald-400" />
            Próximamente
          </div>
        </div>
      </div>
    </div>
  );
}

/* ───────── Iconos ───────── */
function HomeIcon({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none">
      <path
        d="M3 10.5 12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-10.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}
function CartIcon({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none">
      <path d="M3 4h2l2 12h10l2-8H7" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="9" cy="20" r="1" fill="currentColor" />
      <circle cx="17" cy="20" r="1" fill="currentColor" />
    </svg>
  );
}
function BoxIcon({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none">
      <path d="M3 7l9-4 9 4-9 4-9-4Z" stroke="currentColor" strokeWidth="1.5" />
      <path d="M21 7v10l-9 4-9-4V7" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
function StockIcon({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none">
      <rect
        x="3"
        y="4"
        width="6"
        height="16"
        rx="1.2"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <rect
        x="10"
        y="8"
        width="6"
        height="12"
        rx="1.2"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <rect
        x="17"
        y="12"
        width="4"
        height="8"
        rx="1.2"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}
function WrenchIcon({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none">
      <path
        d="M14 6a4 4 0 1 0-4 4 3.8 3.8 0 0 0 1-.13l6.3 6.3a1.5 1.5 0 0 0 2.12-2.12L13.1 7.75A3.8 3.8 0 0 0 14 6Z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <circle cx="6" cy="18" r="2" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
function HistoryIcon({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none">
      <path
        d="M4 13a8 8 0 1 0 2.3-5.7"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path d="M4 4v5h5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 8v5l3 2" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
function CheckIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none">
      <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}
function ChevronDown({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none">
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}
function MenuIcon({ className = "" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M4 6h16M4 12h16M4 18h16"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
function XIcon({ className = "" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M6 6l12 12M18 6l-12 12"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
function Dot({ className = "" }) {
  return (
    <span className={`inline-block h-2.5 w-2.5 rounded-full ${className}`} />
  );
}

/* ───────── Utils ───────── */
function titleFor(active, loc) {
  if (loc === "taller") return "Taller";
  switch (active) {
    case "ventas":
      return "Ventas";
    case "inventario":
      return "Inventario";
    case "stock":
      return "Stock";
    case "historial":
      return "Historial de Ventas";
    case "reportes":
      return "Reportes";
    default:
      return "Inicio";
  }
}
function subtitleFor(active, loc) {
  if (loc === "taller")
    return "Módulo en preparación — pronto vas a poder gestionar órdenes, repuestos y mano de obra.";
  switch (active) {
    case "ventas":
      return "Registrá ventas y cobros por sede.";
    case "inventario":
      return "Gestioná productos, precios y stock.";
    case "stock":
      return "Ajustes rápidos, alertas y control de stock por sede.";
    case "historial":
      return "Listado de ventas realizadas, por sede.";
    case "reportes":
      return "Indicadores y tableros operativos.";
    default:
      return "Resumen y accesos rápidos.";
  }
}
function dotColor(loc) {
  if (loc === "pv1") return "bg-[#EE7203]";
  if (loc === "pv2") return "bg-[#FF3816]";
  return "bg-emerald-400";
}
function defaultActiveFor(loc) {
  return loc === "taller" ? "home" : "ventas";
}
