// /pages/dashboard/index.js
import React, { useEffect, useMemo, useState } from "react";

export default function Dashboard() {
  const [location, setLocation] = useState("pv1"); // pv1 | pv2 | taller
  const [active, setActive] = useState("home"); // home | ventas | inventario | ordenes | reportes

  // Persistimos selección simple en localStorage
  useEffect(() => {
    const a = localStorage.getItem("mx.active");
    const l = localStorage.getItem("mx.location");
    if (a) setActive(a);
    if (l) setLocation(l);
  }, []);
  useEffect(() => localStorage.setItem("mx.active", active), [active]);
  useEffect(() => localStorage.setItem("mx.location", location), [location]);

  const navItems = useMemo(
    () => [
      { id: "home", label: "Inicio", icon: HomeIcon },
      { id: "ventas", label: "Ventas", icon: CartIcon },
      { id: "inventario", label: "Inventario", icon: BoxIcon },
      { id: "ordenes", label: "Órdenes Taller", icon: WrenchIcon },
      { id: "reportes", label: "Reportes", icon: ChartIcon },
    ],
    []
  );

  const CurrentView = useMemo(() => {
    if (active === "ventas") return <VentasView location={location} />;
    if (active === "inventario") return <InventarioView location={location} />;
    if (active === "ordenes") return <OrdenesView location={location} />;
    if (active === "reportes") return <ReportesView location={location} />;
    return <HomeView location={location} />;
  }, [active, location]);

  return (
    <div className="min-h-screen flex bg-[#0C212D] text-white">
      {/* ───────── Sidebar ───────── */}
      <aside className="w-72 bg-[#112C3E]/90 backdrop-blur-md border-r border-white/10 flex flex-col">
        {/* Brand + selector de sede */}
        <div className="p-4 border-b border-white/10">
          <div className="flex items-center gap-3 mb-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-r from-[#EE7203] to-[#FF3816] shadow" />
            <div>
              <p className="text-sm text-white/60 leading-none">Mecánico App</p>
              <h1 className="text-base font-semibold">Panel</h1>
            </div>
          </div>

          <label className="block text-xs text-white/60 mb-1">
            Seleccionar sede
          </label>
          <div className="relative">
            <select
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="w-full rounded-xl bg-[#0C212D] border border-white/10 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#EE7203]/70 pr-8"
            >
              <option value="pv1">Punto de Venta 1</option>
              <option value="pv2">Punto de Venta 2</option>
              <option value="taller">Taller</option>
            </select>
          </div>
        </div>

        {/* Navegación */}
        <nav className="flex-1 p-3">
          <ul className="space-y-2">
            {navItems.map(({ id, label, icon: Icon }) => {
              const isActive = active === id;
              return (
                <li key={id}>
                  <button
                    onClick={() => setActive(id)}
                    className={`group w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition relative
                    ${
                      isActive
                        ? "bg-white/10 ring-1 ring-white/10"
                        : "hover:bg-white/5"
                    }`}
                  >
                    {/* Indicador lateral */}
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
        </nav>

        {/* Footer */}
        <div className="p-4 border-t border-white/10 text-xs text-white/50">
          © {new Date().getFullYear()} Mecánico App
        </div>
      </aside>

      {/* ───────── Contenido ───────── */}
      <main className="flex-1 p-6">
        {/* Header de contenido */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">
              {titleFor(active)}
            </h2>
            <p className="text-white/60 text-sm">{subtitleFor(active)}</p>
          </div>
          <span className="inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded-xl bg-white/5 ring-1 ring-white/10">
            <Dot className={dotColor(location)} />
            {location === "pv1"
              ? "Punto de Venta 1"
              : location === "pv2"
              ? "Punto de Venta 2"
              : "Taller"}
          </span>
        </div>

        {/* Panel principal */}
        <div className="rounded-2xl bg-[#112C3E]/80 p-6 border border-white/10 shadow-xl">
          {CurrentView}
        </div>
      </main>
    </div>
  );
}

/* ───────── Views (placeholders listos para reemplazar por tus componentes reales) ───────── */
function HomeView({ location }) {
  return (
    <div className="space-y-4">
      <KpiGrid />
      <div className="grid md:grid-cols-2 gap-4">
        <Card title="Actividad reciente">
          <EmptyState text="Sin actividad por ahora." />
        </Card>
        <Card title="Alertas">
          <EmptyState text="Todo en orden." />
        </Card>
      </div>
    </div>
  );
}

function VentasView({ location }) {
  return (
    <div className="space-y-4">
      <Card title="Nueva venta">
        <EmptyState text={`Comenzá una venta en ${labelFor(location)}.`} />
      </Card>
      <Card title="Últimas ventas">
        <EmptyState text="Aún no hay ventas registradas." />
      </Card>
    </div>
  );
}

function InventarioView({ location }) {
  return (
    <div className="space-y-4">
      <Card title="Stock">
        <EmptyState text="Cargá tus productos para ver el stock." />
      </Card>
      <Card title="Reposición sugerida">
        <EmptyState text="Sin sugerencias por ahora." />
      </Card>
    </div>
  );
}

function OrdenesView({ location }) {
  return (
    <div className="space-y-4">
      <Card title="Órdenes de trabajo">
        <EmptyState text="Creá tu primera OT del taller." />
      </Card>
      <Card title="Turnos de hoy">
        <EmptyState text="No hay turnos programados." />
      </Card>
    </div>
  );
}

function ReportesView({ location }) {
  return (
    <div className="space-y-4">
      <Card title="Ventas por sede">
        <EmptyState text="Mostrá gráficos y tablas acá." />
      </Card>
      <Card title="Indicadores clave">
        <EmptyState text="KPIs de operación y taller." />
      </Card>
    </div>
  );
}

/* ───────── UI helpers ───────── */
function Card({ title, children, right }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#0C212D]/40 p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-medium">{title}</h3>
        {right}
      </div>
      <div>{children}</div>
    </div>
  );
}

function EmptyState({ text }) {
  return (
    <div className="grid place-items-center py-12 text-center">
      <div className="h-12 w-12 rounded-2xl bg-white/5 ring-1 ring-white/10 grid place-items-center mb-3">
        <Spark />
      </div>
      <p className="text-white/70 text-sm">{text}</p>
    </div>
  );
}

function KpiGrid() {
  const items = [
    { label: "Ventas hoy", value: "$ 0" },
    { label: "Tickets", value: "0" },
    { label: "Órdenes abiertas", value: "0" },
    { label: "Stock bajo", value: "0" },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {items.map((k) => (
        <div
          key={k.label}
          className="rounded-2xl p-4 bg-white/5 ring-1 ring-white/10 hover:bg-white/10 transition"
        >
          <p className="text-xs text-white/60">{k.label}</p>
          <p className="text-xl font-semibold mt-1">{k.value}</p>
        </div>
      ))}
    </div>
  );
}

/* ───────── Iconos livianos (sin dependencias) ───────── */
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
function ChartIcon({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none">
      <path d="M4 20V4" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M8 20v-7M12 20V8M16 20v-4M20 20v-10"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}
function Spark() {
  return (
    <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 2v4M12 18v4M4.2 4.2l2.8 2.8M17 17l2.8 2.8M2 12h4M18 12h4M4.2 19.8 7 17M17 7l2.8-2.8"
        stroke="currentColor"
        strokeWidth="1.4"
      />
    </svg>
  );
}
function Dot({ className = "" }) {
  return (
    <span className={`inline-block h-2.5 w-2.5 rounded-full ${className}`} />
  );
}

/* ───────── Utils de UI ───────── */
function labelFor(loc) {
  if (loc === "pv1") return "Punto de Venta 1";
  if (loc === "pv2") return "Punto de Venta 2";
  return "Taller";
}
function titleFor(active) {
  switch (active) {
    case "ventas":
      return "Ventas";
    case "inventario":
      return "Inventario";
    case "ordenes":
      return "Órdenes de Taller";
    case "reportes":
      return "Reportes";
    default:
      return "Inicio";
  }
}
function subtitleFor(active) {
  switch (active) {
    case "ventas":
      return "Registrá ventas y cobros por sede.";
    case "inventario":
      return "Gestioná productos, precios y stock.";
    case "ordenes":
      return "Seguimiento de órdenes, mano de obra y repuestos.";
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
