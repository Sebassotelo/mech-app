"use client";

import React, { useContext, useMemo, useState } from "react";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { toast } from "sonner";
import ContextGeneral from "@/servicios/contextGeneral";

/**
 * Caja
 * - Muestra:
 *   1) Saldo esperado de caja HOY por sede (PV1 / PV2 / Taller).
 *   2) Resumen filtrado (rango, sede, usuario) + tabla de movimientos.
 *   3) Permite registrar EGRESOS (gastos de caja) en la colección "caja".
 *
 * - Usa:
 *   - ctx.ventas  → ingresos (ventas).
 *   - ctx.egresos → egresos desde colección "caja".
 *
 * Reglas de visibilidad:
 * - Admin (permiso 4): ve saldos de PV1 y PV2 al mismo tiempo,
 *   puede filtrar por sede y usuario.
 * - No admin: ve solo su sede actual y sus propios movimientos.
 */

export default function Caja({ location }) {
  const ctx = useContext(ContextGeneral);

  const permisos = Array.isArray(ctx?.permisos) ? ctx.permisos : [];
  const isAdmin4 = permisos.includes(4);

  const currentUser =
    ctx?.auth?.currentUser || ctx?.user || ctx?.profile || null;
  const currentEmail = (currentUser?.email || "").toLowerCase();

  const ventasCtx = Array.isArray(ctx?.ventas) ? ctx.ventas : [];
  const egresosCtx = Array.isArray(ctx?.egresos) ? ctx.egresos : []; // viene de colección "caja"

  const firestore = ctx?.firestore;

  // ====== Filtros UI ======
  const [range, setRange] = useState("today"); // today | 7d | all
  const [sedeFilter, setSedeFilter] = useState("actual"); // actual | pv1 | pv2 | all
  const [userFilter, setUserFilter] = useState("all"); // all | email

  // ====== Formulario de EGRESO ======
  const [egresoMonto, setEgresoMonto] = useState("");
  const [egresoDesc, setEgresoDesc] = useState("");
  const [savingEgreso, setSavingEgreso] = useState(false);

  // Lista de usuarios (para admin) basada en ventas + egresos
  const userOptions = useMemo(() => {
    const set = new Set();
    ventasCtx.forEach((v) => {
      const email = (v.createdByEmail || "").toLowerCase();
      if (email) set.add(email);
    });
    egresosCtx.forEach((e) => {
      const email = (e.createdByEmail || "").toLowerCase();
      if (email) set.add(email);
    });
    return Array.from(set).sort();
  }, [ventasCtx, egresosCtx]);

  // Helpers de fecha
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  function tsToDate(ts) {
    if (!ts) return null;
    if (typeof ts.toDate === "function") return ts.toDate();
    return new Date(ts);
  }

  function isToday(date) {
    if (!date) return false;
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d.getTime() === today.getTime();
  }

  function inRange(date) {
    if (!date) return false;
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    if (range === "today") {
      return d.getTime() === today.getTime();
    }
    if (range === "7d") {
      const diff = today.getTime() - d.getTime();
      return diff >= 0 && diff <= 7 * 24 * 60 * 60 * 1000;
    }
    return true; // all
  }

  function sedeMatches(loc) {
    if (!loc) return false;
    if (!isAdmin4) {
      // no admin: solo la sede actual
      return loc === location;
    }
    if (sedeFilter === "actual") return loc === location;
    if (sedeFilter === "all") return true;
    return loc === sedeFilter;
  }

  function userMatches(email) {
    const em = (email || "").toLowerCase();
    if (isAdmin4) {
      if (userFilter === "all") return true;
      return em === userFilter;
    }
    // no admin: solo sus propios movimientos
    return em === currentEmail;
  }

  // ====== Normalizar movimientos: Ventas ======
  const ventasMovs = useMemo(() => {
    return ventasCtx
      .map((v) => {
        const date = tsToDate(v.createdAt);
        return {
          id: v.id || `venta_${v.chunkDoc || ""}_${v.key || ""}`,
          tipo: "venta",
          raw: v,
          date,
          location: v.location || "pv1",
          userEmail: (v.createdByEmail || "").toLowerCase(),
          userLabel: v.createdByEmail || "—",
          monto: Number(v?.totals?.total || 0),
          desc: `Venta (${(v?.lines || []).length || 0} ítems)`,
        };
      })
      .filter((m) => m.monto > 0); // ignorar ventas sin monto
  }, [ventasCtx]);

  // ====== Normalizar movimientos: Egresos desde colección "caja" ======
  const egresosMovs = useMemo(() => {
    if (!egresosCtx.length) return [];
    return egresosCtx.map((e) => {
      const date = tsToDate(e.createdAt);
      return {
        id: e.id || `egreso_${e.id}`,
        tipo: e.type === "ingreso" ? "venta" : "egreso", // por si más adelante metés ingresos en caja
        raw: e,
        date,
        location: e.location || "pv1",
        userEmail: (e.createdByEmail || "").toLowerCase(),
        userLabel: e.createdByEmail || "—",
        monto:
          e.type === "ingreso"
            ? Math.abs(Number(e.amount || 0))
            : -Math.abs(Number(e.amount || 0)), // egreso siempre negativo
        desc: e.concepto || e.descripcion || "Egreso",
      };
    });
  }, [egresosCtx]);

  // ====== SALDO ESPERADO DE CAJA HOY POR SEDE ======
  const saldosHoy = useMemo(() => {
    const base = {
      pv1: 0,
      pv2: 0,
      taller: 0,
    };

    const all = [...ventasMovs, ...egresosMovs];
    all.forEach((m) => {
      if (!isToday(m.date)) return;
      const loc = (m.location || "pv1").toLowerCase();
      if (loc !== "pv1" && loc !== "pv2" && loc !== "taller") return;
      base[loc] += m.monto;
    });

    return base;
  }, [ventasMovs, egresosMovs]);

  const saldoHoyTotal = saldosHoy.pv1 + saldosHoy.pv2 + saldosHoy.taller;

  // ====== Aplicar filtros y fusionar movimientos (RESUMEN FILTRADO) ======
  const movimientosFiltrados = useMemo(() => {
    const all = [...ventasMovs, ...egresosMovs];

    return all
      .filter((m) => inRange(m.date))
      .filter((m) => sedeMatches(m.location))
      .filter((m) => userMatches(m.userEmail))
      .sort((a, b) => {
        const da = a.date ? a.date.getTime() : 0;
        const db = b.date ? b.date.getTime() : 0;
        return db - da; // más nuevos arriba
      });
  }, [
    ventasMovs,
    egresosMovs,
    range,
    sedeFilter,
    userFilter,
    location,
    isAdmin4,
  ]);

  const ingresosTotal = useMemo(
    () =>
      movimientosFiltrados
        .filter((m) => m.monto > 0)
        .reduce((acc, m) => acc + m.monto, 0),
    [movimientosFiltrados]
  );

  const egresosTotal = useMemo(
    () =>
      movimientosFiltrados
        .filter((m) => m.monto < 0)
        .reduce((acc, m) => acc + Math.abs(m.monto), 0),
    [movimientosFiltrados]
  );

  const saldo = ingresosTotal - egresosTotal;

  const resumenLabelSede =
    !isAdmin4 || sedeFilter === "actual"
      ? location === "pv1"
        ? "PV1"
        : location === "pv2"
        ? "PV2"
        : "Taller"
      : sedeFilter === "all"
      ? "Todas las sedes"
      : sedeFilter.toUpperCase();

  // ====== Handler: crear EGRESO en colección "caja" ======
  async function handleCreateEgreso() {
    if (!firestore) {
      toast.error("Firestore no disponible");
      return;
    }
    if (!currentUser) {
      toast.error("No hay usuario autenticado");
      return;
    }

    const montoNum = Number(egresoMonto);
    const desc = egresoDesc.trim();

    if (!montoNum || montoNum <= 0) {
      toast.error("Ingresá un monto mayor a 0");
      return;
    }
    if (!desc) {
      toast.error("Ingresá un concepto para el egreso");
      return;
    }

    const payload = {
      type: "egreso",
      amount: montoNum,
      concepto: desc,
      location: location || "pv1",
      createdAt: serverTimestamp(),
      createdBy: currentUser.uid || null,
      createdByEmail: currentEmail || null,
    };

    try {
      setSavingEgreso(true);
      await addDoc(collection(firestore, "caja"), payload);
      toast.success("Egreso registrado en caja");
      setEgresoMonto("");
      setEgresoDesc("");
    } catch (e) {
      console.error(e);
      toast.error("No se pudo registrar el egreso");
    } finally {
      setSavingEgreso(false);
    }
  }

  return (
    <div className="space-y-5 min-w-0">
      {/* SALDO ESPERADO DE CAJA HOY */}
      <div className="rounded-2xl border border-white/10 bg-[#0C212D] p-4">
        <div className="flex flex-col sm:flex-row sm:items-end gap-3 justify-between mb-3">
          <div>
            <p className="text-xs text-white/60">Caja del día (HOY)</p>
            <h3 className="text-lg font-semibold text-white">
              Saldo que debería haber en caja
            </h3>
            <p className="text-[11px] text-white/50 mt-1">
              Calculado con todas las ventas y egresos de hoy por punto de
              venta.
            </p>
          </div>
          {isAdmin4 && (
            <div className="text-right">
              <p className="text-[11px] text-white/60">Total hoy (PV1 + PV2)</p>
              <p className="text-xl font-semibold text-emerald-300">
                {money(saldoHoyTotal)}
              </p>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* PV1 */}
          {(isAdmin4 || location === "pv1") && (
            <SummaryCard
              label="Saldo HOY — PV1"
              value={money(saldosHoy.pv1)}
              highlight
              subtitle="Lo que debería haber en caja del Punto de Venta 1."
            />
          )}

          {/* PV2 */}
          {(isAdmin4 || location === "pv2") && (
            <SummaryCard
              label="Saldo HOY — PV2"
              value={money(saldosHoy.pv2)}
              highlight
              subtitle="Lo que debería haber en caja del Punto de Venta 2."
            />
          )}

          {/* Taller (por si después lo usás) */}
          {(isAdmin4 || location === "taller") && (
            <SummaryCard
              label="Saldo HOY — Taller"
              value={money(saldosHoy.taller)}
              highlight
              subtitle="Saldo del módulo de Taller (si registra movimientos)."
            />
          )}
        </div>
      </div>

      {/* Formulario de EGRESO */}
      <div className="rounded-2xl border border-white/10 bg-[#0C212D] p-4">
        <div className="flex items-center justify-between mb-3 gap-2">
          <div>
            <h3 className="text-sm font-semibold text-white">
              Registrar egreso de caja
            </h3>
            <p className="text-[11px] text-white/50">
              Carga gastos pagados desde la caja de{" "}
              {location === "pv1"
                ? "PV1"
                : location === "pv2"
                ? "PV2"
                : "Taller"}
              . Queda asociado al usuario actual.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-[120px,1fr,auto] gap-3 items-end">
          <div>
            <p className="text-xs text-white/60 mb-1">Monto</p>
            <input
              type="number"
              min="0"
              step="0.01"
              value={egresoMonto}
              onChange={(e) => setEgresoMonto(e.target.value)}
              placeholder="0.00"
              className="w-full rounded-xl bg-[#0C212D] border border-white/10 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#EE7203]/70"
            />
          </div>
          <div>
            <p className="text-xs text-white/60 mb-1">Concepto</p>
            <input
              type="text"
              value={egresoDesc}
              onChange={(e) => setEgresoDesc(e.target.value)}
              placeholder="Ej: Compra de insumos, viáticos, etc."
              className="w-full rounded-xl bg-[#0C212D] border border-white/10 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#EE7203]/70"
            />
          </div>
          <button
            type="button"
            onClick={handleCreateEgreso}
            disabled={savingEgreso}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-[#EE7203] to-[#FF3816] text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {savingEgreso ? "Guardando…" : "Registrar egreso"}
          </button>
        </div>
      </div>

      {/* Filtros principales para el RESUMEN FILTRADO */}
      <div className="flex flex-col md:flex-row md:items-end gap-3">
        <div className="flex-1">
          <p className="text-xs text-white/60 mb-1">Rango de fechas</p>
          <div className="inline-flex rounded-xl bg-[#0C212D] border border-white/10 p-1 text-xs">
            <ToggleButton
              active={range === "today"}
              onClick={() => setRange("today")}
            >
              Hoy
            </ToggleButton>
            <ToggleButton
              active={range === "7d"}
              onClick={() => setRange("7d")}
            >
              Últimos 7 días
            </ToggleButton>
            <ToggleButton
              active={range === "all"}
              onClick={() => setRange("all")}
            >
              Todo
            </ToggleButton>
          </div>
        </div>

        <div className="flex-1">
          <p className="text-xs text-white/60 mb-1">Sede (filtros)</p>
          <select
            value={isAdmin4 ? sedeFilter : "actual"}
            onChange={(e) => setSedeFilter(e.target.value)}
            disabled={!isAdmin4}
            className="w-full rounded-xl bg-[#0C212D] border border-white/10 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#EE7203]/70 disabled:opacity-60"
          >
            <option value="actual">
              Sede actual (
              {location === "pv1"
                ? "PV1"
                : location === "pv2"
                ? "PV2"
                : "Taller"}
              )
            </option>
            {isAdmin4 && (
              <>
                <option value="pv1">PV1</option>
                <option value="pv2">PV2</option>
                <option value="all">Todas las sedes</option>
              </>
            )}
          </select>
        </div>

        <div className="flex-1">
          <p className="text-xs text-white/60 mb-1">Usuario (filtros)</p>
          <select
            value={isAdmin4 ? userFilter : "all"}
            onChange={(e) => setUserFilter(e.target.value)}
            disabled={!isAdmin4}
            className="w-full rounded-xl bg-[#0C212D] border border-white/10 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#EE7203]/70 disabled:opacity-60"
          >
            <option value="all">
              {isAdmin4 ? "Todos los usuarios" : "Solo mis movimientos"}
            </option>
            {isAdmin4 &&
              userOptions.map((email) => (
                <option key={email} value={email}>
                  {email}
                </option>
              ))}
          </select>
        </div>
      </div>

      {/* Resumen filtrado */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <SummaryCard
          label={`Ingresos (filtro — ${resumenLabelSede})`}
          value={money(ingresosTotal)}
          subtitle="Ventas cobradas en el rango y filtros seleccionados."
        />
        <SummaryCard
          label="Egresos (filtro)"
          value={money(egresosTotal)}
          negative={egresosTotal > 0}
          subtitle="Salidas de caja según los filtros."
        />
        <SummaryCard
          label="Saldo filtrado"
          value={money(saldo)}
          highlight
          subtitle="Ingresos - egresos solo del período filtrado."
        />
      </div>

      {/* Tabla de movimientos */}
      <div className="mt-2 rounded-xl border border-white/10 bg-[#0C212D] overflow-hidden">
        <div className="border-b border-white/10 px-4 py-2 flex items-center justify-between">
          <p className="text-sm text-white/80 font-medium">
            Movimientos de caja (según filtros)
          </p>
          <p className="text-xs text-white/50">
            {movimientosFiltrados.length} movimiento
            {movimientosFiltrados.length === 1 ? "" : "s"}
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-white/5 text-xs text-white/60">
              <tr>
                <Th className="w-36">Fecha / Hora</Th>
                <Th className="w-24">Tipo</Th>
                <Th className="w-24">Sede</Th>
                <Th className="w-40">Usuario</Th>
                <Th>Detalle</Th>
                <Th className="w-32 text-right">Monto</Th>
              </tr>
            </thead>
            <tbody>
              {movimientosFiltrados.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-6 text-center text-white/60 text-sm"
                  >
                    No hay movimientos para los filtros seleccionados.
                  </td>
                </tr>
              ) : (
                movimientosFiltrados.map((m) => (
                  <tr
                    key={m.id}
                    className="border-t border-white/5 hover:bg-white/5/40"
                  >
                    <Td className="whitespace-nowrap text-xs">
                      {m.date
                        ? m.date.toLocaleString("es-AR", {
                            day: "2-digit",
                            month: "2-digit",
                            year: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "—"}
                    </Td>
                    <Td>
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-full text-[11px] ${
                          m.tipo === "venta"
                            ? "bg-emerald-500/10 text-emerald-300"
                            : "bg-red-500/10 text-red-300"
                        }`}
                      >
                        {m.tipo === "venta" ? "Venta" : "Egreso"}
                      </span>
                    </Td>
                    <Td className="whitespace-nowrap text-xs text-white/70">
                      {m.location ? m.location.toUpperCase() : "PV1"}
                    </Td>
                    <Td className="whitespace-nowrap text-xs text-white/80">
                      {m.userLabel || "—"}
                    </Td>
                    <Td className="text-xs text-white/80">{m.desc || "—"}</Td>
                    <Td className="text-right whitespace-nowrap font-medium">
                      <span
                        className={
                          m.monto >= 0 ? "text-emerald-300" : "text-red-300"
                        }
                      >
                        {m.monto >= 0 ? "+" : "-"}
                        {money(Math.abs(m.monto))}
                      </span>
                    </Td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <p className="px-4 py-2 text-[11px] text-white/50 border-t border-white/10">
          * Los saldos de HOY muestran lo que debería haber en caja por punto de
          venta. El resumen filtrado de arriba usa solo el rango y filtros
          seleccionados.
        </p>
      </div>
    </div>
  );
}

/* ====== Subcomponentes UI ====== */

function ToggleButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1 rounded-lg transition ${
        active
          ? "bg-gradient-to-r from-[#EE7203] to-[#FF3816] text-white shadow-sm"
          : "text-white/70 hover:bg-white/5"
      }`}
    >
      {children}
    </button>
  );
}

function SummaryCard({ label, value, subtitle, negative, highlight }) {
  return (
    <div className="rounded-xl border border-white/10 bg-[#0C212D] p-3 flex flex-col gap-1">
      <p className="text-xs text-white/60">{label}</p>
      <p
        className={`text-lg font-semibold ${
          highlight
            ? value && value !== money(0)
              ? "text-emerald-300"
              : "text-white"
            : negative
            ? "text-red-300"
            : "text-white"
        }`}
      >
        {value}
      </p>
      {subtitle && (
        <p className="text-[11px] text-white/50 leading-snug">{subtitle}</p>
      )}
    </div>
  );
}

function Th({ children, className = "" }) {
  return (
    <th
      className={`px-3 py-2 text-left ${className}`}
      style={{
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      {children}
    </th>
  );
}

function Td({ children, className = "" }) {
  return (
    <td
      className={`px-3 py-2 ${className}`}
      style={{ overflow: "hidden", textOverflow: "ellipsis" }}
    >
      {children}
    </td>
  );
}

/* ====== Helpers ====== */

function money(n) {
  const num = Number(n);
  if (!isFinite(num)) return "-";
  return num.toLocaleString("es-AR", { style: "currency", currency: "ARS" });
}
