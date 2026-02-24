"use client";
import Inventario from "@/componentes/panel/Inventario";
import Ventas from "@/componentes/panel/Ventas";
import HistorialVentas from "@/componentes/panel/HistorialVentas";
import React, { useEffect, useMemo, useRef, useState, useContext } from "react";
import ContextGeneral from "@/servicios/contextGeneral";
import { toast } from "sonner";
import HomeOverview from "@/componentes/panel/HomeOverview";
import Stock from "@/componentes/panel/Stock";
import Cuentas from "@/componentes/panel/Cuentas"; // ✅ solo admin(4)
import Caja from "@/componentes/panel/Caja"; // ✅ NUEVO
import { onAuthStateChanged } from "firebase/auth";
import { useRouter } from "next/router";
// Asumo que importaste tu componente Loader, ajústalo según tu ruta:
import Loader from "@/componentes/Loader";

// ✅ NUEVO: Importes de Taller (Asegurate de tener estos archivos en @/componentes/taller)
import HomeTaller from "@/componentes/taller/HomeTaller";
import ClientesTaller from "@/componentes/taller/ClientesTaller";
import TrabajosTaller from "@/componentes/taller/TrabajosTaller";
import PresupuestosTaller from "@/componentes/taller/PresupuestosTaller";
import MecanicosTaller from "@/componentes/taller/MecanicosTaller";

export default function Dashboard() {
  const ctx = useContext(ContextGeneral);
  const router = useRouter();

  // ───────── Auth Guard
  const [authReady, setAuthReady] = useState(false);

  // Estado UI
  const [location, setLocation] = useState("pv1"); // pv1 | pv2 | taller
  const [active, setActive] = useState("home"); // home | ventas | inventario | stock | historial | cuentas | reportes | caja | clientes | trabajos | presupuestos | mecanicos
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // ───────── Permisos
  const permisos = Array.isArray(ctx?.permisos) ? ctx.permisos : [];
  const hasPV1 = permisos.includes(1);
  const hasPV2 = permisos.includes(2);
  const hasTaller = permisos.includes(3);
  const isAdmin4 = permisos.includes(4);

  // 👉 Para el admin, consideramos que tiene acceso a todas las sedes
  const canPV1 = hasPV1 || isAdmin4;
  const canPV2 = hasPV2 || isAdmin4;
  const canTaller = hasTaller || isAdmin4;

  const allowedFor = (loc) =>
    isAdmin4 || // override total
    (loc === "pv1" && canPV1) ||
    (loc === "pv2" && canPV2) ||
    (loc === "taller" && canTaller);

  const firstAllowedLocation = useMemo(() => {
    if (canPV1) return "pv1";
    if (canPV2) return "pv2";
    if (canTaller) return "taller";
    return null;
  }, [canPV1, canPV2, canTaller]);

  // ───────── Auth effect
  useEffect(() => {
    if (!ctx?.auth) return;
    const unsub = onAuthStateChanged(ctx.auth, (u) => {
      setAuthReady(true);
      if (!u) router.replace("/");
    });
    return () => unsub();
  }, [ctx?.auth, router]);

  // ───────── Persistencia UI (respetando permisos)
  useEffect(() => {
    try {
      const a = localStorage.getItem("mx.active");
      const l = localStorage.getItem("mx.location");
      if (a) setActive(a);
      if (l) setLocation(l);
    } catch {}
  }, []);

  // Si la sede persistida no está permitida, forzar a la primera permitida
  useEffect(() => {
    if (!firstAllowedLocation) return;
    if (!allowedFor(location)) {
      setLocation(firstAllowedLocation);
      setActive(defaultActiveFor(firstAllowedLocation, isAdmin4));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstAllowedLocation, permisos]);

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

  // ───────── Nav dinámico
  const navItems = useMemo(() => {
    const base = [];

    // Si NO hay permiso para la sede actual (salvo admin), solo muestro "Inicio"
    if (!allowedFor(location)) {
      base.push({ id: "home", label: "Inicio", icon: HomeIcon });
      if (isAdmin4 && location !== "taller") {
        base.push({ id: "cuentas", label: "Cuentas", icon: BankIcon });
      }
      return base;
    }

    if (location === "taller") {
      // ✅ Si es Admin (4), ve todo el Taller (Pero no 'Cuentas')
      if (isAdmin4) {
        base.push(
          { id: "home", label: "Resumen", icon: HomeIcon },
          { id: "clientes", label: "Clientes", icon: UsersIcon },
          { id: "trabajos", label: "Trabajos", icon: WrenchIcon },
          { id: "presupuestos", label: "Presupuestos", icon: FileTextIcon },
          { id: "mecanicos", label: "Mecánicos", icon: ToolIcon },
        );
      } else {
        // ✅ Si es Mecánico (3) y no Admin, ve SOLO su panel
        base.push({ id: "mecanicos", label: "Mis Trabajos", icon: ToolIcon });
      }
    } else {
      // ✅ Vistas PV1 y PV2
      base.push(
        { id: "home", label: "Inicio", icon: HomeIcon },
        { id: "ventas", label: "Ventas", icon: CartIcon },
        { id: "caja", label: "Caja", icon: CashIcon },
        { id: "inventario", label: "Inventario", icon: BoxIcon },
        { id: "stock", label: "Stock", icon: StockIcon },
        { id: "historial", label: "Historial de ventas", icon: HistoryIcon },
      );
      // Solo en PV1 o PV2 agregamos Cuentas si es admin 4
      if (isAdmin4) {
        base.push({ id: "cuentas", label: "Cuentas", icon: BankIcon });
      }
    }
    return base;
  }, [location, isAdmin4, permisos]);

  // Si cambia permisos o sede y la vista actual ya no es válida, reacomodo
  useEffect(() => {
    const validIds = new Set(navItems.map((n) => n.id));
    if (!validIds.has(active)) setActive(defaultActiveFor(location, isAdmin4));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location, navItems]);

  // Gate de vistas: si no hay permiso para la sede (salvo admin), muestro AccessDenied
  const blockedByPerm = !allowedFor(location);
  const CurrentView = useMemo(() => {
    if (blockedByPerm && !isAdmin4) return <AccessDenied location={location} />;

    // ✅ TALLER
    if (location === "taller") {
      if (active === "clientes" && isAdmin4) return <ClientesTaller />;
      if (active === "trabajos" && isAdmin4) return <TrabajosTaller />;
      if (active === "presupuestos" && isAdmin4) return <PresupuestosTaller />;
      if (active === "mecanicos") return <MecanicosTaller />;
      if (active === "home" && isAdmin4) return <HomeTaller />;

      // Fallback por seguridad
      return <MecanicosTaller />;
    }

    // ✅ PV1 / PV2
    if (active === "ventas") return <VentasView location={location} />;
    if (active === "caja") return <CajaView location={location} />;
    if (active === "inventario") return <InventarioView location={location} />;
    if (active === "stock") return <StockView location={location} />;
    if (active === "historial") return <HistorialView location={location} />;
    if (active === "reportes") return <ReportesView location={location} />;
    if (active === "cuentas" && isAdmin4) return <CuentasView />;
    return <HomeView location={location} />;
  }, [active, location, blockedByPerm, isAdmin4]);

  // ───────── Mobile: bloquear scroll + cerrar con ESC
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
    // 👉 Admin puede cambiar a cualquier sede
    if (!isAdmin4) {
      if (
        !(
          (loc === "pv1" && canPV1) ||
          (loc === "pv2" && canPV2) ||
          (loc === "taller" && canTaller)
        )
      ) {
        toast.error("No tenés permiso para esa sede");
        return;
      }
    }

    setLocation(loc);
    if (active === "home" || location === "taller" || loc === "taller") {
      setActive(defaultActiveFor(loc, isAdmin4));
    }
  };

  const handleNavClick = (id) => {
    setActive(id);
    setMobileNavOpen(false);
  };

  // ───────── Gates visuales ─────────

  // 1. Esperamos a que Firebase Auth responda
  if (!authReady) {
    return (
      <div className="min-h-screen bg-[#0C212D] text-white">
        <Loader fullScreen={true} text="Verificando sesión..." />
      </div>
    );
  }

  // 2. Si no hay usuario, retornamos null (el useEffect superior redirige a "/")
  if (!ctx?.user) return null;

  // 3. Esperamos a que el Context descargue todas las colecciones iniciales
  if (ctx?.loader) {
    return (
      <div className="min-h-screen bg-[#0C212D] text-white">
        <Loader fullScreen={true} text="Cargando sistema..." />
      </div>
    );
  }

  // ───────── UI principal
  return (
    <div className="min-h-screen flex bg-[#0C212D] text-white overflow-x-hidden">
      {/* Sidebar desktop */}
      <aside className="hidden md:flex w-72 xl:w-80 bg-[#112C3E]/90 backdrop-blur-md border-r border-white/10 flex-col">
        <SidebarHeader
          location={location}
          onChangeLocation={handleLocationChange}
          canPV1={canPV1}
          canPV2={canPV2}
          canTaller={canTaller}
        />
        <NavList navItems={navItems} active={active} onClickItem={setActive} />
        <div className="p-4 border-t border-white/10 text-xs text-white/50 mt-auto">
          © {new Date().getFullYear()} Mecánico App
        </div>
      </aside>

      {/* Drawer mobile */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onMouseDown={() => setMobileNavOpen(false)}
          aria-hidden="true"
        />
      )}
      <div
        ref={drawerRef}
        className={`fixed z-50 inset-y-0 left-0 w-72 bg-[#112C3E] border-r border-white/10 md:hidden transition-transform duration-200 flex flex-col ${
          mobileNavOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Menú de navegación"
      >
        <div className="flex items-center justify-between p-4 border-b border-white/10 shrink-0">
          <div>
            <p className="text-xs text-white/60 leading-none">Mecánico App</p>
            <h1 className="text-base font-semibold">Panel</h1>
          </div>
        </div>

        <div className="p-4 border-b border-white/10 shrink-0">
          <p className="text-[11px] uppercase tracking-widest text-white/50 mb-2">
            Seleccioná la sede
          </p>
          <LocationDropdown
            value={location}
            onChange={handleLocationChange}
            hasPV1={canPV1}
            hasPV2={canPV2}
            hasTaller={canTaller}
          />
        </div>

        <nav className="flex-1 p-3 overflow-y-auto">
          <NavList
            navItems={navItems}
            active={active}
            onClickItem={handleNavClick}
          />
        </nav>

        <div className="p-4 border-t border-white/10 text-xs text-white/50 shrink-0">
          © {new Date().getFullYear()} Mecánico App
        </div>
      </div>

      {/* Contenido */}
      <main className="flex-1 min-w-0 overflow-x-hidden flex flex-col">
        {/* Topbar mobile */}
        <div className="md:hidden sticky top-0 z-30 bg-[#0C212D]/95 backdrop-blur border-b border-white/10 shrink-0">
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
            <span className="inline-flex items-center gap-2 text-xs px-2.5 py-1 rounded-xl bg-white/5 ring-1 ring-white/10">
              <Dot className={dotColor(location)} />
              {location === "pv1"
                ? "PV1"
                : location === "pv2"
                  ? "PV2"
                  : "Taller"}
            </span>
          </div>
        </div>

        {/* Contenedor limitado */}
        <div className="flex-1 mx-auto w-full max-w-screen-xl px-4 sm:px-6 py-6 flex flex-col min-h-0">
          {/* Encabezado desktop */}
          <div className="hidden md:flex items-start sm:items-center justify-between mb-6 gap-3 shrink-0">
            <div className="min-w-0">
              <h2 className="text-2xl font-semibold tracking-tight truncate">
                {titleFor(active, location)}
              </h2>
              <p className="text-white/60 text-sm">
                {subtitleFor(active, location)}
              </p>
            </div>

            <span
              className={`hidden sm:inline-flex items-center gap-3 text-sm px-4 py-2 rounded-2xl bg:white/5 ring-1 ring-white/10`}
            >
              <Dot className={dotColor(location)} />
              <strong className="font-semibold">
                {location === "pv1"
                  ? "Punto de Venta 1"
                  : location === "pv2"
                    ? "Punto de Venta 2"
                    : "Taller Mecánico"}
              </strong>
            </span>
          </div>

          {/* Visualizador */}
          <div className="flex-1 rounded-2xl bg-[#112C3E]/80 border border-white/10 shadow-xl min-w-0 flex flex-col">
            <div className="flex-1 min-w-0 w-full overflow-x-auto overscroll-x-contain p-4 sm:p-6">
              {CurrentView}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

/* ───────── Sidebar Header ───────── */
function SidebarHeader({
  location,
  onChangeLocation,
  canPV1,
  canPV2,
  canTaller,
}) {
  return (
    <div className="p-5 border-b border-white/10 shrink-0">
      <div className="mb-4">
        <p className="text-xs text-white/60 leading-none">Mecánico App</p>
        <h1 className="text-base font-semibold">Panel</h1>
      </div>
      <p className="text-[11px] uppercase tracking-widest text-white/50 mb-2">
        Seleccioná la sede
      </p>
      <LocationDropdown
        value={location}
        onChange={onChangeLocation}
        hasPV1={canPV1}
        hasPV2={canPV2}
        hasTaller={canTaller}
      />
    </div>
  );
}

/* ───────── AccessDenied ───────── */
function AccessDenied({ location }) {
  const label =
    location === "pv1"
      ? "Punto de Venta 1"
      : location === "pv2"
        ? "Punto de Venta 2"
        : "Taller";
  return (
    <div className="rounded-xl border border-white/10 p-6 bg-white/5">
      <h3 className="text-lg font-semibold">Acceso restringido</h3>
      <p className="text-sm text-white/70 mt-1">
        No tenés permisos para operar en <b>{label}</b>. Cambiá de sede o pedí
        acceso al admin.
      </p>
    </div>
  );
}

/* ───────── Listado de navegación ───────── */
function NavList({ navItems, active, onClickItem }) {
  return (
    <ul className="space-y-2">
      {navItems.map(({ id, label, icon: Icon }) => {
        const isActive = active === id;
        return (
          <li key={id}>
            <button
              onClick={() => onClickItem(id)}
              className={`group w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition relative ${
                isActive
                  ? "bg-white/10 ring-1 ring-white/10"
                  : "hover:bg-white/5"
              }`}
            >
              <span
                className={`absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 rounded-r ${
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

/* ───────── Dropdown de sede ───────── */
function LocationDropdown({ value, onChange, hasPV1, hasPV2, hasTaller }) {
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

  const Option = ({ id, allowed, label, desc, grad, icon: IconEl }) => (
    <li>
      <button
        role="option"
        aria-selected={value === id}
        disabled={!allowed}
        onMouseDown={(e) => {
          e.preventDefault();
          if (allowed) {
            onChange(id);
            setOpen(false);
          }
        }}
        className={`w-full flex items-center gap-3 px-3.5 py-2.5 text-left ${
          !allowed ? "opacity-50 cursor-not-allowed" : "hover:bg-white/5"
        } ${value === id ? "bg-white/5" : ""}`}
      >
        <span
          className={`h-8 w-8 rounded-lg ring-1 ring-white/10 bg-gradient-to-br ${grad} flex items-center justify-center shrink-0`}
        >
          <IconEl className="h-4 w-4" />
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items:center gap-2">
            <span className="text-sm font-semibold truncate">{label}</span>
            {!allowed && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 ring-1 ring-white/10">
                Sin permiso
              </span>
            )}
          </div>
          <p className="text-xs text-white/60 truncate">{desc}</p>
        </div>
        {value === id ? (
          <CheckIcon className="h-4 w-4 text-white/80 shrink-0" />
        ) : null}
      </button>
    </li>
  );

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-[#0C212D] border border-white/10 text-sm outline-none focus:ring-2 ${ring} transition`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          <Dot className={dotColor(value)} />
          <span className="font-medium">{label}</span>
        </span>
        <ChevronDown
          className={`h-4 w-4 ${open ? "rotate-180" : ""} transition shrink-0`}
        />
      </button>

      {open && (
        <ul
          role="listbox"
          className="absolute z-20 mt-2 w-full rounded-xl overflow-hidden border border-white/10 bg-[#0E2330] shadow-2xl"
        >
          <Option
            id="pv1"
            allowed={!!hasPV1}
            label="Punto de Venta 1"
            desc="Ventas, inventario, stock y caja."
            grad="from-[#EE7203]/80 to-[#FF3816]/80"
            icon={CartIcon}
          />
          <Option
            id="pv2"
            allowed={!!hasPV2}
            label="Punto de Venta 2"
            desc="Ventas, inventario, stock y caja."
            grad="from-[#FF3816]/80 to-[#EE7203]/80"
            icon={CartIcon}
          />
          <Option
            id="taller"
            allowed={!!hasTaller}
            label="Taller Mecánico"
            desc="Gestión de clientes y órdenes."
            grad="from-emerald-500/70 to-teal-500/70"
            icon={WrenchIcon}
          />
        </ul>
      )}
    </div>
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
function CajaView({ location }) {
  return (
    <div className="space-y-4 min-w-0">
      <Caja location={location} />
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
function CuentasView() {
  return (
    <div className="space-y-4 min-w-0">
      <Cuentas />
    </div>
  );
}
function ReportesView() {
  return <div className="space-y-4 min-w-0" />;
}

/* ───────── Iconos & utils ───────── */
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
function CashIcon({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none">
      <rect
        x="3"
        y="6"
        width="18"
        height="12"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <circle cx="12" cy="12" r="2.5" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M6 9.5c1 0 1.5-.5 2-1.5M18 14.5c-1 0-1.5.5-2 1.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
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
function BankIcon({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none">
      <path
        d="M3 10l9-6 9 6v1H3v-1Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M5 11v7M9 11v7M15 11v7M19 11v7"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path d="M3 19h18" stroke="currentColor" strokeWidth="1.5" />
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
function Dot({ className = "" }) {
  return (
    <span className={`inline-block h-2.5 w-2.5 rounded-full ${className}`} />
  );
}

function UsersIcon({ className = "" }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 00-3-3.87" />
      <path d="M16 3.13a4 4 0 010 7.75" />
    </svg>
  );
}
function FileTextIcon({ className = "" }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
      <path d="M10 9H8" />
    </svg>
  );
}
function ToolIcon({ className = "" }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path d="M10 2v7.31" />
      <path d="M14 9.3V1.99" />
      <path d="M8.5 2h7" />
      <path d="M14 9.3a6.5 6.5 0 11-4 0" />
      <path d="M5.52 16h12.96" />
    </svg>
  );
}

/* ───────── Utils ───────── */
function titleFor(active, loc) {
  if (loc === "taller") {
    switch (active) {
      case "clientes":
        return "Gestión de Clientes";
      case "trabajos":
        return "Órdenes de Trabajo";
      case "presupuestos":
        return "Presupuestos";
      case "mecanicos":
        return "Panel de Mecánico";
      default:
        return "Resumen del Taller";
    }
  }

  switch (active) {
    case "ventas":
      return "Ventas";
    case "caja":
      return "Caja";
    case "inventario":
      return "Inventario";
    case "stock":
      return "Stock";
    case "historial":
      return "Historial de Ventas";
    case "cuentas":
      return "Cuentas";
    case "reportes":
      return "Reportes";
    default:
      return "Inicio";
  }
}

function subtitleFor(active, loc) {
  if (loc === "taller") {
    switch (active) {
      case "clientes":
        return "Directorio de clientes, vehículos asociados y su historial.";
      case "trabajos":
        return "Asignación de tareas y control de estados de trabajos.";
      case "presupuestos":
        return "Armado de cotizaciones y envío directo por WhatsApp.";
      case "mecanicos":
        return "Vista exclusiva de trabajos asignados por mecánico.";
      default:
        return "Indicadores generales del taller.";
    }
  }

  switch (active) {
    case "ventas":
      return "Registrá ventas y cobros por sede.";
    case "caja":
      return "Controlá ingresos, egresos y el estado de caja del turno.";
    case "inventario":
      return "Gestioná productos, precios y stock.";
    case "stock":
      return "Ajustes rápidos, alertas y control de stock por sede.";
    case "historial":
      return "Listado de ventas realizadas, por sede.";
    case "cuentas":
      return "Gestión centralizada de cuentas (solo Admin General).";
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

function defaultActiveFor(loc, isAdmin) {
  if (loc === "taller" && !isAdmin) return "mecanicos";
  return "home";
}
