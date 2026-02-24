// src/componentes/taller/HomeTaller.jsx
"use client";

import React, { useContext, useMemo } from "react";
import ContextGeneral from "@/servicios/contextGeneral";
import {
  FiTool,
  FiClock,
  FiCheckCircle,
  FiUsers,
  FiFileText,
} from "react-icons/fi";

function safeDate(v) {
  if (!v) return null;
  if (typeof v?.toDate === "function") return v.toDate();
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function isSameDay(a, b) {
  if (!a || !b) return false;
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function money(n) {
  const val = Number(n || 0);
  return val.toLocaleString("es-AR");
}

export default function HomeTaller() {
  const ctx = useContext(ContextGeneral);

  const trabajos = Array.isArray(ctx?.trabajosTaller) ? ctx.trabajosTaller : [];
  const clientes = Array.isArray(ctx?.clientesTaller) ? ctx.clientesTaller : [];
  const presupuestos = Array.isArray(ctx?.presupuestosTaller)
    ? ctx.presupuestosTaller
    : [];

  const presupuestosLoading = ctx?.presupuestosTallerLoading === true;
  const loader = ctx?.loader === true;

  const now = useMemo(() => new Date(), []);
  const startOfToday = useMemo(
    () => new Date(now.getFullYear(), now.getMonth(), now.getDate()),
    [now],
  );
  const startOf7 = useMemo(
    () => new Date(startOfToday.getTime() - 6 * 24 * 60 * 60 * 1000),
    [startOfToday],
  );

  const metrics = useMemo(() => {
    // ============ TRABAJOS ============
    const totalTrabajos = trabajos.length;

    const trabajosConEstado = trabajos.map((t) => {
      const estado = String(t?.estado || t?.status || "").toLowerCase();
      return { ...t, __estado: estado };
    });

    const enProceso = trabajosConEstado.filter((t) => {
      const e = t.__estado;
      // Heurística: si no está "finalizado/listo/entregado/cerrado" se considera en proceso
      if (!e) return true;
      if (
        e.includes("final") ||
        e.includes("list") ||
        e.includes("entreg") ||
        e.includes("cerr")
      )
        return false;
      return true;
    });

    const finalizados = trabajosConEstado.filter((t) => {
      const e = t.__estado;
      if (!e) return false;
      return (
        e.includes("final") ||
        e.includes("list") ||
        e.includes("entreg") ||
        e.includes("cerr")
      );
    });

    const listosHoy = trabajosConEstado.filter((t) => {
      const e = t.__estado;
      if (!(e.includes("list") || e.includes("final") || e.includes("entreg")))
        return false;
      const dt =
        safeDate(t?.updatedAt) ||
        safeDate(t?.finishedAt) ||
        safeDate(t?.closedAt) ||
        safeDate(t?.createdAt);
      return dt ? isSameDay(dt, startOfToday) : false;
    });

    const creadosHoy = trabajosConEstado.filter((t) => {
      const dt = safeDate(t?.createdAt);
      return dt ? isSameDay(dt, startOfToday) : false;
    });

    const semanaTrabajosCreados = trabajosConEstado.filter((t) => {
      const dt = safeDate(t?.createdAt);
      return dt
        ? dt >= startOf7 &&
            dt <= new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000 - 1)
        : false;
    });

    // ============ PRESUPUESTOS ============
    const totalPresupuestos = presupuestos.length;

    // Pendientes: heurística -> si no tiene vinculación a trabajo o no está marcado como "aprobado"
    const pendientes = presupuestos.filter((p) => {
      const estado = String(p?.estado || "").toLowerCase();
      if (
        estado.includes("aprob") ||
        estado.includes("acept") ||
        estado.includes("ok")
      )
        return false;
      if (p?.workOrderId || p?.trabajoId) return false;
      return true;
    });

    const creadosHoyPresu = presupuestos.filter((p) => {
      const dt = safeDate(p?.createdAt);
      return dt ? isSameDay(dt, startOfToday) : false;
    });

    const semanaPresupuestos = presupuestos.filter((p) => {
      const dt = safeDate(p?.createdAt);
      return dt
        ? dt >= startOf7 &&
            dt <= new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000 - 1)
        : false;
    });

    const totalPresuSemana = semanaPresupuestos.reduce(
      (acc, p) => acc + Number(p?.total || 0),
      0,
    );

    // ============ CLIENTES / VEHÍCULOS ============
    const totalClientes = clientes.length;

    const totalVehiculos = clientes.reduce((acc, c) => {
      const vehs = Array.isArray(c?.vehiculos) ? c.vehiculos.length : 0;
      const single = c?.patente ? 1 : 0;
      return acc + (vehs || single);
    }, 0);

    // ============ LISTAS (recent) ============
    const recientesTrabajos = [...trabajosConEstado]
      .sort((a, b) => {
        const da = safeDate(a?.createdAt)?.getTime() || 0;
        const db = safeDate(b?.createdAt)?.getTime() || 0;
        return db - da;
      })
      .slice(0, 6);

    const recientesPresu = [...presupuestos]
      .sort((a, b) => {
        const da = safeDate(a?.createdAt)?.getTime() || 0;
        const db = safeDate(b?.createdAt)?.getTime() || 0;
        return db - da;
      })
      .slice(0, 6);

    return {
      totalTrabajos,
      enProceso: enProceso.length,
      finalizados: finalizados.length,
      listosHoy: listosHoy.length,
      creadosHoy: creadosHoy.length,
      semanaTrabajos: semanaTrabajosCreados.length,

      totalPresupuestos,
      pendientes: pendientes.length,
      creadosHoyPresu: creadosHoyPresu.length,
      semanaPresu: semanaPresupuestos.length,
      totalPresuSemana,

      totalClientes,
      totalVehiculos,

      recientesTrabajos,
      recientesPresu,
    };
  }, [trabajos, clientes, presupuestos, startOfToday, startOf7]);

  const loading = loader || presupuestosLoading;

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between border-b border-white/10 pb-4 gap-4">
        <div>
          <h3 className="text-xl font-semibold text-white tracking-tight">
            Home Taller
          </h3>
          <p className="text-sm text-white/50 mt-1">
            Resumen rápido del taller (clientes, trabajos y presupuestos)
          </p>
        </div>

        <div className="flex items-center gap-2">
          {loading ? (
            <span className="text-xs text-white/50 bg-white/5 border border-white/10 px-3 py-1.5 rounded-xl">
              Cargando datos...
            </span>
          ) : (
            <span className="text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 rounded-xl">
              Datos al día
            </span>
          )}
        </div>
      </div>

      {/* Cards métricas */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <MetricCard
          icon={<FiTool />}
          label="Trabajos en proceso"
          value={metrics.enProceso}
          sub={`Hoy: +${metrics.creadosHoy} | Semana: ${metrics.semanaTrabajos}`}
          accent="emerald"
        />
        <MetricCard
          icon={<FiFileText />}
          label="Presupuestos"
          value={metrics.pendientes}
          sub={`Hoy: +${metrics.creadosHoyPresu} | Semana: ${metrics.semanaPresu}`}
          accent="amber"
        />
        <MetricCard
          icon={<FiCheckCircle />}
          label="Vehículos listos hoy"
          value={metrics.listosHoy}
          sub={`Finalizados: ${metrics.finalizados}`}
          accent="sky"
        />
        <MetricCard
          icon={<FiUsers />}
          label="Clientes / Vehículos"
          value={`${metrics.totalClientes}`}
          sub={`Vehículos: ${metrics.totalVehiculos}`}
          accent="violet"
        />
      </div>

      {/* Paneles */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Trabajos recientes */}
        <div className="bg-[#112C3E] border border-white/10 rounded-2xl shadow-xl overflow-hidden">
          <div className="p-4 border-b border-white/10 bg-white/5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-white/70">
                <FiClock />
              </span>
              <h4 className="text-sm font-semibold text-white">
                Últimos trabajos
              </h4>
            </div>
            <span className="text-[11px] text-white/40">
              Total: {metrics.totalTrabajos}
            </span>
          </div>

          <div className="p-4">
            {metrics.recientesTrabajos.length === 0 ? (
              <EmptyState
                title="No hay trabajos todavía"
                desc="Cuando cargues trabajos del taller, van a aparecer acá."
              />
            ) : (
              <div className="space-y-2">
                {metrics.recientesTrabajos.map((t) => {
                  const dt = safeDate(t?.createdAt);
                  const fecha = dt ? dt.toLocaleDateString("es-AR") : "-";
                  const cliente =
                    t?.clienteNombre || t?.cliente || "(sin cliente)";
                  const vehiculo = t?.vehiculo || t?.vehiculoRef || "";
                  const estadoRaw = String(
                    t?.estado || t?.status || "en proceso",
                  );
                  return (
                    <div
                      key={`${t?.chunkDoc || ""}_${t?.id || ""}`}
                      className="bg-[#0C212D] border border-white/5 rounded-xl p-3 hover:bg-white/5 transition"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-white font-semibold truncate">
                            {cliente}
                          </p>
                          <p className="text-xs text-white/50 truncate mt-0.5">
                            {vehiculo}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-xs text-white/40">{fecha}</p>
                          <span className="inline-flex mt-1 text-[10px] px-2 py-1 rounded-lg border border-white/10 bg-white/5 text-white/70">
                            {estadoRaw}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Presupuestos recientes */}
        <div className="bg-[#112C3E] border border-white/10 rounded-2xl shadow-xl overflow-hidden">
          <div className="p-4 border-b border-white/10 bg-white/5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-white/70">
                <FiFileText />
              </span>
              <h4 className="text-sm font-semibold text-white">
                Últimos presupuestos (taller)
              </h4>
            </div>
            <span className="text-[11px] text-white/40">
              Semana: ${money(metrics.totalPresuSemana)}
            </span>
          </div>

          <div className="p-4">
            {metrics.recientesPresu.length === 0 ? (
              <EmptyState
                title="No hay presupuestos de taller"
                desc="Creá un presupuesto y lo vas a ver listado acá."
              />
            ) : (
              <div className="space-y-2">
                {metrics.recientesPresu.map((p) => {
                  const dt = safeDate(p?.createdAt);
                  const fecha = dt ? dt.toLocaleDateString("es-AR") : "-";
                  const cliente = p?.clienteNombre || "(sin cliente)";
                  const vehiculo = p?.vehiculo || "";
                  const total = Number(p?.total || 0);
                  const estado = String(
                    p?.estado ||
                      (p?.workOrderId || p?.trabajoId
                        ? "asignado"
                        : "pendiente"),
                  );
                  return (
                    <div
                      key={`${p?.chunkDoc || ""}_${p?.id || ""}`}
                      className="bg-[#0C212D] border border-white/5 rounded-xl p-3 hover:bg-white/5 transition"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-white font-semibold truncate">
                            {cliente}
                          </p>
                          <p className="text-xs text-white/50 truncate mt-0.5">
                            {vehiculo}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-xs text-white/40">{fecha}</p>
                          <p className="text-sm font-bold text-emerald-400 mt-1">
                            $ {money(total)}
                          </p>
                          <span className="inline-flex mt-1 text-[10px] px-2 py-1 rounded-lg border border-white/10 bg-white/5 text-white/70">
                            {estado}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ icon, label, value, sub, accent = "emerald" }) {
  const accents = {
    emerald: "text-emerald-400",
    amber: "text-amber-300",
    sky: "text-sky-300",
    violet: "text-violet-300",
  };

  return (
    <div className="p-4 bg-white/5 border border-white/10 rounded-2xl shadow-lg">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-white/60 text-sm">{label}</p>
          <p
            className={`text-3xl font-bold mt-2 ${accents[accent] || "text-emerald-400"}`}
          >
            {value}
          </p>
          {sub ? <p className="text-[11px] text-white/40 mt-2">{sub}</p> : null}
        </div>
        <div className="p-2 rounded-xl bg-white/5 border border-white/10 text-white/70">
          {icon}
        </div>
      </div>
    </div>
  );
}

function EmptyState({ title, desc }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 opacity-60">
      <span className="text-3xl mb-2">🛠️</span>
      <p className="text-sm italic text-white/70">{title}</p>
      <p className="text-xs text-white/50 mt-1 text-center max-w-sm">{desc}</p>
    </div>
  );
}
