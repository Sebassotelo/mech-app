"use client";
import Inventario from "@/componentes/panel/Inventario";
import Ventas from "@/componentes/panel/Ventas";
import HistorialVentas from "@/componentes/panel/HistorialVentas";
import React, { useEffect, useMemo, useRef, useState, useContext } from "react";
import ContextGeneral from "@/servicios/contextGeneral";
import { toast } from "sonner";
import HomeOverview from "@/componentes/panel/HomeOverview";
import Stock from "@/componentes/panel/Stock";
import Cuentas from "@/componentes/panel/Cuentas"; // solo admin(4)
import Caja from "@/componentes/panel/Caja"; // caja
import { onAuthStateChanged } from "firebase/auth";
import { useRouter } from "next/router";
// Loader del proyecto
import Loader from "@/componentes/Loader";

// Importes de Taller
import HomeTaller from "@/componentes/taller/HomeTaller";
import ClientesTaller from "@/componentes/taller/ClientesTaller";
import TrabajosTaller from "@/componentes/taller/TrabajosTaller";
import PresupuestosTaller from "@/componentes/taller/PresupuestosTaller";
import MecanicosTaller from "@/componentes/taller/MecanicosTaller";
import HelpHint from "@/componentes/HelpHint";

export default function Dashboard() {
  const ctx = useContext(ContextGeneral);
  const router = useRouter();

  // Auth guard
  const [authReady, setAuthReady] = useState(false);

  // Estado UI
  const [location, setLocation] = useState("pv1"); // pv1 | pv2 | taller
  const [active, setActive] = useState("home"); // home | ventas | presupuestosTallerPv | inventario | stock | historial | cuentas | reportes | caja | clientes | trabajos | presupuestos | mecanicos
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Permisos
  const permisos = Array.isArray(ctx?.permisos) ? ctx.permisos : [];
  const hasPV1 = permisos.includes(1);
  const hasPV2 = permisos.includes(2);
  const hasTaller = permisos.includes(3);
  const isAdmin4 = permisos.includes(4);

  // El admin tiene acceso a todas las sedes
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

  // Auth effect
  useEffect(() => {
    if (!ctx?.auth) return;
    const unsub = onAuthStateChanged(ctx.auth, (u) => {
      setAuthReady(true);
      if (!u) router.replace("/");
    });
    return () => unsub();
  }, [ctx?.auth, router]);

  // Persistencia UI (respetando permisos)
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

  // Nav dinamico
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
      // Si es Admin (4), ve todo el Taller (pero no Cuentas)
      if (isAdmin4) {
        base.push(
          { id: "home", label: "Resumen", icon: HomeIcon },
          { id: "clientes", label: "Clientes", icon: UsersIcon },
          { id: "trabajos", label: "Trabajos", icon: WrenchIcon },
          { id: "presupuestos", label: "Presupuestos", icon: FileTextIcon },
          { id: "mecanicos", label: "Mecánicos", icon: ToolIcon },
        );
      } else {
        // Si es Mecanico (3) y no Admin, ve solo su panel
        base.push({ id: "mecanicos", label: "Mis Trabajos", icon: ToolIcon });
      }
    } else {
      // Vistas PV1 y PV2
      base.push(
        { id: "home", label: "Inicio", icon: HomeIcon },
        { id: "ventas", label: "Ventas", icon: CartIcon },
        ...(canTaller
          ? [
              {
                id: "presupuestosTallerPv",
                label: "Presup. Taller",
                icon: FileTextIcon,
              },
            ]
          : []),
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

  // Si cambia permisos o sede y la vista actual ya no es valida, reacomodo
  useEffect(() => {
    const validIds = new Set(navItems.map((n) => n.id));
    if (!validIds.has(active)) setActive(defaultActiveFor(location, isAdmin4));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location, navItems]);

  // Gate de vistas: si no hay permiso para la sede (salvo admin), muestro AccessDenied
  const blockedByPerm = !allowedFor(location);
  const CurrentView = useMemo(() => {
    if (blockedByPerm && !isAdmin4) return <AccessDenied location={location} />;

    // Taller
    if (location === "taller") {
      if (active === "clientes" && isAdmin4) return <ClientesTaller />;
      if (active === "trabajos" && isAdmin4) return <TrabajosTaller />;
      if (active === "presupuestos" && isAdmin4) return <PresupuestosTaller />;
      if (active === "mecanicos") return <MecanicosTaller />;
      if (active === "home" && isAdmin4) return <HomeTaller />;

      // Fallback por seguridad
      return <MecanicosTaller />;
    }

    // PV1 / PV2
    if (active === "ventas") return <VentasView location={location} />;
    if (active === "presupuestosTallerPv")
      return (
        <PresupuestosTallerView location={location} embeddedFrom="pv" />
      );
    if (active === "caja") return <CajaView location={location} />;
    if (active === "inventario") return <InventarioView location={location} />;
    if (active === "stock") return <StockView location={location} />;
    if (active === "historial") return <HistorialView location={location} />;
    if (active === "reportes") return <ReportesView location={location} />;
    if (active === "cuentas" && isAdmin4) return <CuentasView />;
    return <HomeView location={location} />;
  }, [active, location, blockedByPerm, isAdmin4]);

  // Mobile: bloquear scroll y cerrar con ESC
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
    // Admin puede cambiar a cualquier sede
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

  // Gates visuales

  // 1. Esperamos a que Firebase Auth responda
  if (!authReady) {
    return (
      <div className="relative min-h-screen overflow-hidden bg-[#081821] text-white">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(0,166,80,0.18),_transparent_30%),radial-gradient(circle_at_top_right,_rgba(238,114,3,0.22),_transparent_34%),radial-gradient(circle_at_bottom,_rgba(0,158,227,0.16),_transparent_38%)]" />
        <div className="absolute inset-0 opacity-[0.06] [background-image:linear-gradient(rgba(255,255,255,0.85)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.85)_1px,transparent_1px)] [background-size:36px_36px]" />
        <Loader fullScreen={true} text="Verificando sesión..." />
      </div>
    );
  }

  // 2. Si no hay usuario, retornamos null (el useEffect superior redirige a "/")
  if (!ctx?.user) return null;

  // 3. Usuario desactivado desde la app
  if (ctx?.userActivo === false) {
    return <AccountInactive />;
  }

  // 4. Esperamos a que el Context descargue todas las colecciones iniciales
  if (ctx?.loader) {
    return (
      <div className="relative min-h-screen overflow-hidden bg-[#081821] text-white">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(0,166,80,0.18),_transparent_30%),radial-gradient(circle_at_top_right,_rgba(238,114,3,0.22),_transparent_34%),radial-gradient(circle_at_bottom,_rgba(0,158,227,0.16),_transparent_38%)]" />
        <div className="absolute inset-0 opacity-[0.06] [background-image:linear-gradient(rgba(255,255,255,0.85)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.85)_1px,transparent_1px)] [background-size:36px_36px]" />
        <Loader fullScreen={true} text="Cargando sistema..." />
      </div>
    );
  }

  // UI principal
  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[#081821] text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(0,166,80,0.16),_transparent_28%),radial-gradient(circle_at_top_right,_rgba(238,114,3,0.2),_transparent_34%),radial-gradient(circle_at_bottom,_rgba(0,158,227,0.14),_transparent_38%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.06] [background-image:linear-gradient(rgba(255,255,255,0.85)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.85)_1px,transparent_1px)] [background-size:36px_36px]" />
      <div className="relative z-10 min-h-screen flex overflow-x-hidden">
      {/* Sidebar desktop */}
      <aside className="hidden md:flex w-72 xl:w-80 border-r border-white/10 bg-[#0E2330] shadow-[0_18px_50px_rgba(0,0,0,0.28)] flex-col">
        <SidebarHeader
          location={location}
          onChangeLocation={handleLocationChange}
          canPV1={canPV1}
          canPV2={canPV2}
          canTaller={canTaller}
          isAdmin4={isAdmin4}
        />
        <NavList
          navItems={navItems}
          active={active}
          onClickItem={setActive}
          location={location}
          isAdmin4={isAdmin4}
        />
        <div className="p-4 border-t border-white/10 text-xs text-white/50 mt-auto">
          © {new Date().getFullYear()} Mecánico App
        </div>
      </aside>

      {/* Drawer mobile */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/70 md:hidden"
          onMouseDown={() => setMobileNavOpen(false)}
          aria-hidden="true"
        />
      )}
      <div
        ref={drawerRef}
          className={`fixed z-50 inset-y-0 left-0 w-72 border-r border-white/10 bg-[#0E2330] shadow-[0_18px_60px_rgba(0,0,0,0.45)] md:hidden transition-transform duration-200 flex flex-col ${
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
          <div className="mb-2 flex items-center gap-2">
            <p className="text-[11px] uppercase tracking-widest text-white/50">
              Seleccioná la sede
            </p>
            <HelpHint {...locationHelpContent(isAdmin4)} />
          </div>
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
            location={location}
            isAdmin4={isAdmin4}
          />
        </nav>

        <div className="p-4 border-t border-white/10 text-xs text-white/50 shrink-0">
          © {new Date().getFullYear()} Mecánico App
        </div>
      </div>

      {/* Contenido */}
      <main className="flex-1 min-w-0 overflow-x-hidden flex flex-col">
        {/* Topbar mobile */}
        <div className="md:hidden sticky top-0 z-30 border-b border-white/10 bg-[#0E2330] shrink-0">
          <div className="mx-auto w-full max-w-screen-xl px-4 py-3 flex items-center justify-between">
            <button
              onClick={() => setMobileNavOpen(true)}
              className="rounded-xl border border-white/10 bg-[#0C212D] p-2.5 transition hover:bg-[#112C3E]"
              aria-label="Abrir menú"
            >
              <MenuIcon className="h-5 w-5" />
            </button>
            <div className="min-w-0 text-center">
              <div className="flex items-center justify-center gap-2">
                <h2 className="text-base font-semibold tracking-tight truncate">
                  {titleFor(active, location)}
                </h2>
                <HelpHint
                  {...sectionHelpContent(active, location, isAdmin4)}
                  align="center"
                />
              </div>
              <p className="text-xs text-white/60 truncate">
                {subtitleFor(active, location)}
              </p>
            </div>
            <span className="inline-flex items-center gap-2 text-xs px-2.5 py-1 rounded-xl border border-white/10 bg-[#0C212D]">
              <Dot className={dotColor(location)} />
              {location === "pv1"
                ? "PV1"
                : location === "pv2"
                  ? "PV2"
                  : "Taller"}
            </span>
          </div>
        </div>

        {/* Contenedor principal */}
        <div className="flex-1 mx-auto w-full max-w-screen-xl px-4 sm:px-6 py-6 flex flex-col">
          {/* Encabezado desktop */}
          <div className="hidden md:flex items-start sm:items-center justify-between mb-6 gap-3 shrink-0">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-2xl font-semibold tracking-tight truncate">
                  {titleFor(active, location)}
                </h2>
                <HelpHint {...sectionHelpContent(active, location, isAdmin4)} />
              </div>
              <p className="text-slate-300 text-sm">
                {subtitleFor(active, location)}
              </p>
            </div>

              <span className="hidden sm:inline-flex items-center gap-3 rounded-2xl border border-white/10 bg-[#0C212D] px-4 py-2 text-sm shadow-[0_10px_24px_rgba(0,0,0,0.16)]">
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

          {/* Vista activa */}
          <div className="flex-1 min-w-0">
            <div className="min-w-0 p-0 sm:p-0">
              {CurrentView}
            </div>
          </div>
        </div>
      </main>
      </div>
    </div>
  );
}

/* Sidebar Header */
function SidebarHeader({
  location,
  onChangeLocation,
  canPV1,
  canPV2,
  canTaller,
  isAdmin4,
}) {
  return (
    <div className="p-5 border-b border-white/10 shrink-0">
      <div className="mb-4">
        <p className="text-xs text-white/60 leading-none">Mecánico App</p>
        <h1 className="text-base font-semibold">Panel</h1>
      </div>
      <div className="mb-2 flex items-center gap-2">
        <p className="text-[11px] uppercase tracking-widest text-white/50">
          Seleccioná la sede
        </p>
        <HelpHint {...locationHelpContent(isAdmin4)} />
      </div>
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

/* AccessDenied */
function AccessDenied({ location }) {
  const label =
    location === "pv1"
      ? "Punto de Venta 1"
      : location === "pv2"
        ? "Punto de Venta 2"
        : "Taller";
  return (
    <div className="rounded-[24px] border border-slate-700 bg-[#0E2330] p-6 shadow-[0_18px_40px_rgba(0,0,0,0.18)]">
      <h3 className="text-lg font-semibold">Acceso restringido</h3>
      <p className="text-sm text-white/70 mt-1">
        No tenés permisos para operar en <b>{label}</b>. Cambiá de sede o pedí
        acceso al admin.
      </p>
    </div>
  );
}

function AccountInactive() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#081821] text-white flex items-center justify-center p-6">
      <div className="relative z-10 max-w-md rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(17,44,62,0.94),rgba(8,24,33,0.98))] p-6 text-center shadow-[0_24px_70px_rgba(0,0,0,0.42)]">
        <h2 className="text-xl font-semibold">Cuenta inactiva</h2>
        <p className="mt-2 text-sm text-white/70">
          Tu usuario fue desactivado desde la aplicación. Pedile a un admin general
          que vuelva a habilitarlo para recuperar el acceso.
        </p>
      </div>
    </div>
  );
}

/* Listado de navegacion */
function NavList({ navItems, active, onClickItem, location, isAdmin4 }) {
  return (
    <ul className="space-y-2">
      {navItems.map(({ id, label, icon: Icon }) => {
        const isActive = active === id;
        const helpProps = navHelpContent(id, location, isAdmin4);
        return (
          <li key={id}>
            <div className="flex items-center gap-2">
              <button
                onClick={() => onClickItem(id)}
                className={`group w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition relative ${
                  isActive
                    ? "bg-[#112C3E] ring-1 ring-white/10"
                    : "hover:bg-[#112C3E]/70"
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
              <HelpHint
                {...helpProps}
                buttonClassName="h-8 w-8 rounded-xl bg-[#0C212D] text-white/60"
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* Dropdown de sede */
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
          !allowed ? "opacity-50 cursor-not-allowed" : "hover:bg-[#112C3E]/70"
        } ${value === id ? "bg-[#112C3E]" : ""}`}
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
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#0C212D] ring-1 ring-white/10">
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

/* Views */
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
function PresupuestosTallerView({ location, embeddedFrom }) {
  return (
    <div className="space-y-4 min-w-0">
      <PresupuestosTaller location={location} embeddedFrom={embeddedFrom} />
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

/* Iconos y utils */
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

/* Utils */
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
    case "presupuestosTallerPv":
      return "Presupuestos de Taller";
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
    case "presupuestosTallerPv":
      return "Cotizá trabajos de taller desde la sede actual sin mover stock.";
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

function locationHelpContent(isAdmin4 = false) {
  return {
    title: "Selector de sede",
    description:
      "Cada sede separa la operación diaria para que trabajes sobre el lugar correcto.",
    sections: [
      {
        label: "Qué es",
        value:
          "Es el selector que cambia entre Punto de Venta 1, Punto de Venta 2 y Taller.",
      },
      {
        label: "Qué hace",
        value:
          "Filtra las vistas, ventas, caja y herramientas según la sede elegida.",
      },
      {
        label: "Quién lo ve",
        value: isAdmin4
          ? "El admin general puede cambiar entre todas las sedes habilitadas."
          : "Cada usuario ve solo las sedes para las que tiene permiso.",
      },
      {
        label: "Uso interno",
        value:
          "Sí. Sirve para operar el negocio por sector o sucursal, no para clientes finales.",
      },
    ],
  };
}

function sectionHelpContent(active, loc, isAdmin4) {
  if (loc === "taller") {
    switch (active) {
      case "clientes":
        return {
          title: "Clientes del taller",
          description:
            "Acá se administra la base de clientes y vehículos del taller.",
          sections: [
            { label: "Qué es", value: "Es el directorio interno de clientes del taller." },
            { label: "Qué hace", value: "Permite registrar teléfonos, vehículos y consultar el historial básico de cada cliente." },
            { label: "Quién lo ve", value: "Lo ven usuarios con acceso al taller y el admin general." },
            { label: "Uso interno", value: "Sí. Estos datos los usa el equipo para presupuestos, trabajos y contacto." },
          ],
        };
      case "trabajos":
        return {
          title: "Trabajos del taller",
          description:
            "Esta vista organiza las órdenes según su estado para seguir el avance del taller.",
          sections: [
            { label: "Qué es", value: "Es el tablero interno de órdenes de trabajo." },
            { label: "Qué hace", value: "Permite crear, editar, asignar mecánicos, mover estados y dejar comentarios del trabajo." },
            { label: "Quién lo ve", value: "Lo ven usuarios autorizados del taller y el admin general." },
            { label: "Uso interno", value: "Sí. El cliente no ve esta vista; se usa para coordinar tareas y seguimiento." },
          ],
        };
      case "presupuestos":
        return {
          title: "Presupuestos del taller",
          description:
            "Desde acá se arman cotizaciones para trabajos y se pueden compartir por WhatsApp.",
          sections: [
            { label: "Qué es", value: "Es la sección interna para preparar presupuestos del taller." },
            { label: "Qué hace", value: "Permite cargar ítems, total estimado, notas y enviar el detalle al cliente." },
            { label: "Quién lo ve", value: "Lo ve el personal del taller con permiso y el admin general." },
            { label: "Uso interno", value: "Sí. El cliente solo recibe el mensaje o el importe compartido." },
          ],
        };
      case "mecanicos":
        return {
          title: "Panel de mecánico",
          description:
            "Es la vista operativa para que cada mecánico siga sus órdenes asignadas.",
          sections: [
            { label: "Qué es", value: "Es la pantalla de trabajo diario del mecánico." },
            { label: "Qué hace", value: "Muestra trabajos asignados, estado, checklist y comentarios vinculados." },
            { label: "Quién lo ve", value: isAdmin4 ? "La puede ver el admin general y también los mecánicos con permiso 3." : "La ven los mecánicos con acceso al taller." },
            { label: "Uso interno", value: "Sí. Está pensada para coordinación interna del equipo." },
          ],
        };
      default:
        return {
          title: "Resumen del taller",
          description:
            "Es una vista general con indicadores rápidos del sector taller.",
          sections: [
            { label: "Qué es", value: "Es el panel de resumen interno del taller." },
            { label: "Qué hace", value: "Muestra métricas, estados y actividad reciente para tener contexto rápido." },
            { label: "Quién lo ve", value: "Lo ve el admin general cuando entra a la sede Taller." },
            { label: "Uso interno", value: "Sí. Solo sirve para gestión operativa." },
          ],
        };
    }
  }

  switch (active) {
    case "presupuestosTallerPv":
      return {
        title: "Presupuestos de taller",
        description:
          "Esta vista permite preparar presupuestos de taller completos desde el punto de venta actual.",
        sections: [
          {
            label: "Qué es",
            value:
              "Es una entrada operativa para cotizar trabajos del taller sin salir de la sede actual.",
          },
          {
            label: "Qué hace",
            value:
              "Permite cargar cliente, vehículo, servicios, productos y dejar armado el desglose a órdenes de trabajo.",
          },
          {
            label: "Quién lo ve",
            value:
              "La ven usuarios que tienen acceso al taller además de la sede actual, y el admin general.",
          },
          {
            label: "Uso interno",
            value:
              "Sí. El presupuesto no descuenta stock; solo ordena la cotización y el trabajo futuro.",
          },
        ],
      };
    case "ventas":
      return {
        title: "Ventas",
        description: "Esta pantalla se usa para cobrar y registrar ventas de la sede actual.",
        sections: [
          { label: "Qué es", value: "Es el punto de venta interno del negocio." },
          { label: "Qué hace", value: "Permite buscar productos, armar un carrito, cobrar y guardar la venta." },
          { label: "Quién lo ve", value: "Lo ven usuarios con permiso para la sede actual y el admin general." },
          { label: "Uso interno", value: "Sí. El cliente solo participa en el momento del cobro." },
        ],
      };
    case "caja":
      return {
        title: "Caja",
        description: "Acá se controla la plata que debería haber en la caja y los movimientos del turno.",
        sections: [
          { label: "Qué es", value: "Es el control interno de ingresos y egresos por sede." },
          { label: "Qué hace", value: "Muestra saldos, movimientos y permite registrar gastos pagados desde caja." },
          { label: "Quién lo ve", value: "Lo ven usuarios de la sede actual y el admin general." },
          { label: "Uso interno", value: "Sí. No está pensado para mostrarlo a clientes." },
        ],
      };
    case "inventario":
      return {
        title: "Inventario",
        description: "Se usa para mantener ordenados los productos y su información base.",
        sections: [
          { label: "Qué es", value: "Es la sección interna de administración de productos." },
          { label: "Qué hace", value: "Permite revisar datos, precios, categorías y referencias del inventario." },
          { label: "Quién lo ve", value: "Lo ven usuarios habilitados de la sede y el admin general." },
          { label: "Uso interno", value: "Sí. Sirve para gestión operativa del negocio." },
        ],
      };
    case "stock":
      return {
        title: "Stock",
        description: "Desde acá se controla la existencia real de productos en la sede.",
        sections: [
          { label: "Qué es", value: "Es la vista de control de stock por sede." },
          { label: "Qué hace", value: "Permite detectar faltantes, revisar cantidades y hacer seguimiento operativo." },
          { label: "Quién lo ve", value: "Lo ven usuarios con permiso en la sede y el admin general." },
          { label: "Uso interno", value: "Sí. Se usa para ordenar reposición y control interno." },
        ],
      };
    case "historial":
      return {
        title: "Historial de ventas",
        description: "Esta sección sirve para consultar ventas ya realizadas.",
        sections: [
          { label: "Qué es", value: "Es el historial interno de operaciones de venta." },
          { label: "Qué hace", value: "Permite revisar ventas registradas, sus datos y estados relacionados." },
          { label: "Quién lo ve", value: "Lo ven usuarios con permiso en la sede y el admin general." },
          { label: "Uso interno", value: "Sí. Es una herramienta administrativa y de seguimiento." },
        ],
      };
    case "cuentas":
      return {
        title: "Cuentas",
        description: "Esta sección centraliza usuarios, permisos y configuraciones sensibles de operación.",
        sections: [
          { label: "Qué es", value: "Es el módulo interno de administración de cuentas." },
          { label: "Qué hace", value: "Permite crear usuarios, asignar permisos y configurar cobros integrados." },
          { label: "Quién lo ve", value: "Solo lo ve el admin general con permiso 4." },
          { label: "Uso interno", value: "Sí. No está pensado para uso de clientes finales." },
        ],
      };
    default:
      return {
        title: "Inicio",
        description: "Es el resumen principal de la sede actual.",
        sections: [
          { label: "Qué es", value: "Es la portada interna del panel." },
          { label: "Qué hace", value: "Muestra accesos rápidos e información general para empezar a trabajar." },
          { label: "Quién lo ve", value: "Lo ven usuarios con acceso a la sede actual y el admin general." },
          { label: "Uso interno", value: "Sí. Está pensada para operación diaria del negocio." },
        ],
      };
  }
}

function navHelpContent(id, location, isAdmin4) {
  return sectionHelpContent(id, location, isAdmin4);
}
