// /src/componentes/panel/HistorialVentas.jsx
"use client";

import React, { useMemo, useState, useContext } from "react";
import ContextGeneral from "@/servicios/contextGeneral";
import useDismissibleModal from "@/hooks/useDismissibleModal";
import { toast } from "sonner";
import {
  doc,
  updateDoc,
  serverTimestamp,
  deleteField,
} from "firebase/firestore";

/* =================== Listado =================== */
export default function HistorialVentas({ location = "pv1" }) {
  const ctx = useContext(ContextGeneral);

  // 🔒 Permisos: solo nivel 4 (Admin) puede anular/eliminar ventas
  const isAdmin4 = useMemo(() => {
    const p = Array.isArray(ctx?.permisos) ? ctx.permisos : [];
    return p.includes(4);
  }, [ctx?.permisos]);

  const ventas = Array.isArray(ctx?.ventas) ? ctx.ventas : [];
  const loading = ctx?.loader === true && ventas.length === 0;

  // Estados de filtros
  const [q, setQ] = useState("");
  const [dateRange, setDateRange] = useState({ start: "", end: "" });
  const [sel, setSel] = useState(null); // venta seleccionada (drawer)

  // ✅ Orden: default por fecha desc
  const [sort, setSort] = useState({ key: "fecha", dir: "desc" });

  const ventasDeSede = useMemo(
    () => ventas.filter((v) => v?.location === location),
    [ventas, location],
  );

  // ===== Resumen (solo activas computan en monto/tickets) =====
  const resumen = useMemo(() => {
    let monto = 0;
    let tickets = 0;
    let anuladas = 0;

    ventasDeSede.forEach((v) => {
      const total = Number(v?.totals?.total ?? v?.total ?? 0);
      if (isCanceled(v)) {
        anuladas += 1;
      } else if (!isSettledSale(v)) {
        return;
      } else {
        monto += total;
        tickets += 1;
      }
    });

    return { monto, tickets, anuladas };
  }, [ventasDeSede]);

  // ===== Helpers de sort y fechas =====
  function getCreatedMs(v) {
    return tsToMs(v?.createdAt) ?? idToMs(v?.id) ?? idToMs(v?._id) ?? 0;
  }

  function getSortValue(v, key) {
    const createdMs = getCreatedMs(v);
    const items = (v?.lines || []).reduce(
      (acc, l) => acc + (parseInt(l?.qty ?? 0, 10) || 0),
      0,
    );
    const subtotal = Number(v?.totals?.subtotal ?? 0);
    const surcharge = Number(
      v?.totals?.surchargeAmount ?? v?.payment?.surcharge?.amount ?? 0,
    );
    const total = Number(v?.totals?.total ?? v?.total ?? subtotal + surcharge);
    const method = String(v?.payment?.method || "").toLowerCase();
    const email = String(v?.createdByEmail || "").toLowerCase();
    const sede = String(v?.location || "").toLowerCase();

    switch (key) {
      case "fecha":
        return createdMs;
      case "sede":
        return sede;
      case "items":
        return items;
      case "subtotal":
        return subtotal;
      case "recargo":
        return surcharge;
      case "total":
        return total;
      case "pago":
        return method;
      case "creadaPor":
        return email;
      default:
        return createdMs;
    }
  }

  function compare(a, b) {
    const va = getSortValue(a, sort.key);
    const vb = getSortValue(b, sort.key);
    let c = 0;

    if (typeof va === "number" && typeof vb === "number") {
      c = va === vb ? 0 : va < vb ? -1 : 1;
    } else {
      const sa = String(va ?? "");
      const sb = String(vb ?? "");
      c = sa.localeCompare(sb, "es-AR", { sensitivity: "base" });
    }

    if (sort.dir === "desc") c = -c;
    if (c === 0) {
      const ta = getCreatedMs(a);
      const tb = getCreatedMs(b);
      c = tb - ta; // desc por defecto en empate
    }
    return c;
  }

  function toggleSort(key) {
    setSort((prev) => {
      if (prev.key === key) {
        return { key, dir: prev.dir === "asc" ? "desc" : "asc" };
      }
      return { key, dir: "desc" };
    });
  }

  // ===== FILTRADO PRINCIPAL =====
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();

    // Preparar fechas locales (Inicio del día start / Fin del día end)
    let startMs = null;
    let endMs = null;

    if (dateRange.start) {
      // Parsear "YYYY-MM-DD" a local time 00:00:00
      const [y, m, d] = dateRange.start.split("-").map(Number);
      const dateObj = new Date(y, m - 1, d, 0, 0, 0, 0);
      startMs = dateObj.getTime();
    }
    if (dateRange.end) {
      // Parsear "YYYY-MM-DD" a local time 23:59:59
      const [y, m, d] = dateRange.end.split("-").map(Number);
      const dateObj = new Date(y, m - 1, d, 23, 59, 59, 999);
      endMs = dateObj.getTime();
    }

    const base = ventasDeSede.filter((v) => {
      // 1. Filtro de Fechas
      const createdMs = getCreatedMs(v);
      if (startMs && createdMs < startMs) return false;
      if (endMs && createdMs > endMs) return false;

      // 2. Filtro de Texto (Buscador)
      if (!t) return true;
      const totalTxt = String(v?.totals?.total ?? v?.total ?? "");
      // Buscamos en v.id Y v._id para ser seguros
      const idTxt = String(v?.id || "").toLowerCase();
      const underscoreIdTxt = String(v?._id || "").toLowerCase();

      return (
        idTxt.includes(t) ||
        underscoreIdTxt.includes(t) ||
        v?.createdByEmail?.toLowerCase?.().includes(t) ||
        totalTxt.includes(t) ||
        (v?.lines || []).some(
          (l) =>
            l?.name?.toLowerCase?.().includes(t) ||
            l?.sku?.toLowerCase?.().includes(t) ||
            l?.category?.toLowerCase?.().includes(t),
        )
      );
    });

    const sorted = [...base].sort(compare);
    return sorted.slice(0, 200);
  }, [ventasDeSede, q, sort.key, sort.dir, dateRange]);

  return (
    <div className="min-w-0">
      {/* Filtros + acciones */}
      <div className="mb-4 flex flex-col gap-3">
        {/* Fila 1: Buscador y Botones */}
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar ID / producto / SKU / email..."
            className="flex-1 rounded-xl bg-[#0C212D] border border-white/10 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#EE7203]/70 placeholder:text-white/30"
          />
          <div className="flex gap-2 shrink-0">
            <button
              onClick={() => {
                setQ("");
                setDateRange({ start: "", end: "" });
              }}
              className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-sm transition-colors"
            >
              Limpiar
            </button>
            <button
              onClick={() => ctx?.fetchVentas?.()}
              className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-sm transition-colors"
            >
              Refrescar
            </button>
          </div>
        </div>

        {/* Fila 2: Fechas */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 bg-[#0C212D] border border-white/10 rounded-xl px-2 py-1">
            <span className="text-xs text-white/50 pl-1">Desde:</span>
            <input
              type="date"
              value={dateRange.start}
              onChange={(e) =>
                setDateRange((prev) => ({ ...prev, start: e.target.value }))
              }
              className="bg-transparent text-sm text-white/90 outline-none p-1 [&::-webkit-calendar-picker-indicator]:invert"
            />
          </div>
          <div className="flex items-center gap-2 bg-[#0C212D] border border-white/10 rounded-xl px-2 py-1">
            <span className="text-xs text-white/50 pl-1">Hasta:</span>
            <input
              type="date"
              value={dateRange.end}
              onChange={(e) =>
                setDateRange((prev) => ({ ...prev, end: e.target.value }))
              }
              className="bg-transparent text-sm text-white/90 outline-none p-1 [&::-webkit-calendar-picker-indicator]:invert"
            />
          </div>
        </div>
      </div>

      {/* Resumen */}
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs select-none">
        <span className="px-2 py-1 rounded-lg bg-white/5 border border-white/10">
          Total activas: <strong>{money(resumen.monto)}</strong>
        </span>
        <span className="px-2 py-1 rounded-lg bg-white/5 border border-white/10">
          Tickets: <strong>{resumen.tickets}</strong>
        </span>
        <span className="px-2 py-1 rounded-lg bg-[#FF3816]/10 border border-[#FF3816]/30 text-[#FFB0A1]">
          Anuladas: <strong>{resumen.anuladas}</strong>
        </span>

        {/* mini indicador orden actual */}
        <span className="ml-auto px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-white/70">
          Orden: <strong className="text-white">{sortLabel(sort.key)}</strong>{" "}
          <strong className="text-white">
            {sort.dir === "asc" ? "↑" : "↓"}
          </strong>
        </span>
      </div>

      {/* Tabla (solo md+) */}
      <div className="hidden md:block overflow-hidden rounded-2xl border border-slate-700 bg-[#0E2330]">
        <div className="max-h-[70vh] overflow-auto">
          <table className="w-full text-sm table-fixed">
            <colgroup>
              <col style={{ width: 160 }} />
              <col style={{ width: 80 }} />
              <col style={{ width: 80 }} />
              <col style={{ width: 120 }} />
              <col style={{ width: 120 }} />
              <col style={{ width: 130 }} />
              <col style={{ width: 150 }} />
              <col />
            </colgroup>

            <thead className="bg-[#0A1B25] text-white/70 sticky top-0 z-10">
              <tr>
                <SortableTh
                  label="Fecha"
                  active={sort.key === "fecha"}
                  dir={sort.dir}
                  onClick={() => toggleSort("fecha")}
                />
                <SortableTh
                  label="Sede"
                  active={sort.key === "sede"}
                  dir={sort.dir}
                  onClick={() => toggleSort("sede")}
                />
                <SortableTh
                  label="Ítems"
                  className="text-right"
                  active={sort.key === "items"}
                  dir={sort.dir}
                  onClick={() => toggleSort("items")}
                />
                <SortableTh
                  label="Subtotal"
                  className="text-right"
                  active={sort.key === "subtotal"}
                  dir={sort.dir}
                  onClick={() => toggleSort("subtotal")}
                />
                <SortableTh
                  label="Recargo"
                  className="text-right"
                  active={sort.key === "recargo"}
                  dir={sort.dir}
                  onClick={() => toggleSort("recargo")}
                />
                <SortableTh
                  label="Total"
                  className="text-right"
                  active={sort.key === "total"}
                  dir={sort.dir}
                  onClick={() => toggleSort("total")}
                />
                <SortableTh
                  label="Pago"
                  active={sort.key === "pago"}
                  dir={sort.dir}
                  onClick={() => toggleSort("pago")}
                />
                <SortableTh
                  label="Creada por"
                  active={sort.key === "creadaPor"}
                  dir={sort.dir}
                  onClick={() => toggleSort("creadaPor")}
                />
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="p-6 text-center text-white/60">
                    Cargando…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-6 text-center text-white/60">
                    Sin resultados
                  </td>
                </tr>
              ) : (
                filtered.map((v) => {
                  const items = (v?.lines || []).reduce(
                    (acc, l) => acc + (parseInt(l?.qty ?? 0, 10) || 0),
                    0,
                  );
                  const subtotal = Number(v?.totals?.subtotal ?? 0);
                  const surcharge = Number(
                    v?.totals?.surchargeAmount ??
                      v?.payment?.surcharge?.amount ??
                      0,
                  );
                  const total = Number(
                    v?.totals?.total ?? v?.total ?? subtotal + surcharge,
                  );
                  const method = getVentaPaymentSnapshot(v).method || v?.payment?.method || "—";
                  const createdMs = getCreatedMs(v);
                  const canceled = isCanceled(v);
                  const paymentMeta = getVentaPaymentMeta(v);
                  const idToShow = v.id || v._id || "—";

                  return (
                    <tr
                      key={`${v.chunkDoc || "x"}_${v.id || v._id}`}
                      className="border-t border-slate-800 hover:bg-[#132836] cursor-pointer transition-colors"
                      onClick={() => setSel(v)}
                      title={`ID: ${idToShow}`}
                    >
                      <Td className="whitespace-nowrap">
                        {fmtDate(createdMs)}
                      </Td>
                      <Td className="uppercase whitespace-nowrap">
                        {v.location}
                      </Td>
                      <Td className="text-right whitespace-nowrap">{items}</Td>
                      <Td className="text-right whitespace-nowrap">
                        {money(subtotal)}
                      </Td>
                      <Td className="text-right whitespace-nowrap">
                        {money(surcharge)}
                      </Td>
                      <Td className="text-right whitespace-nowrap">
                        <span
                          className={
                            canceled ? "line-through opacity-60" : "font-medium"
                          }
                        >
                          {money(total)}
                        </span>
                      </Td>
                      <Td className="whitespace-nowrap">
                        <Badge>{labelMethod(method)}</Badge>
                        {paymentMeta.showBadge && (
                          <span className={`ml-2 ${paymentMeta.badgeClass}`}>
                            {paymentMeta.badgeLabel}
                          </span>
                        )}
                        {canceled && (
                          <span className="ml-2 px-2 py-0.5 rounded bg-[#FF3816]/20 text-[#FF3816] text-[10px] uppercase font-bold tracking-wide">
                            ANULADA
                          </span>
                        )}
                      </Td>
                      <Td
                        className="truncate max-w-[180px]"
                        title={v.createdByEmail || "—"}
                      >
                        {v.createdByEmail || "—"}
                      </Td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Cards (mobile) */}
      <div className="md:hidden space-y-3">
        {loading ? (
          <div className="rounded-xl border border-white/10 p-4 text-white/60 text-center">
            Cargando…
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-xl border border-white/10 p-4 text-white/60 text-center">
            Sin resultados
          </div>
        ) : (
          filtered.map((v) => {
            const items = (v?.lines || []).reduce(
              (acc, l) => acc + (parseInt(l?.qty ?? 0, 10) || 0),
              0,
            );
            const subtotal = Number(v?.totals?.subtotal ?? 0);
            const surcharge = Number(
              v?.totals?.surchargeAmount ?? v?.payment?.surcharge?.amount ?? 0,
            );
            const total = Number(
              v?.totals?.total ?? v?.total ?? subtotal + surcharge,
            );
            const method = getVentaPaymentSnapshot(v).method || v?.payment?.method || "—";
            const createdMs = getCreatedMs(v);
            const canceled = isCanceled(v);
            const paymentMeta = getVentaPaymentMeta(v);

            return (
              <button
                key={`${v.chunkDoc || "x"}_${v.id || v._id}`}
                onClick={() => setSel(v)}
                className="w-full text-left rounded-2xl border border-slate-700 bg-[#132836] active:bg-[#193445] p-4 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold leading-tight">
                      <span
                        className={
                          canceled ? "line-through opacity-60" : "text-white"
                        }
                      >
                        {money(total)}
                      </span>{" "}
                      <span className="font-normal text-white/60">
                        • {items} ítems
                      </span>
                    </div>
                    <div className="text-xs text-white/60 mt-0.5">
                      {fmtDate(createdMs)} •{" "}
                      {v.location?.toUpperCase?.() || "—"}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Badge>{labelMethod(method)}</Badge>
                      {paymentMeta.showBadge && (
                        <span className={paymentMeta.badgeClass}>
                          {paymentMeta.badgeLabel}
                        </span>
                      )}
                      {typeof surcharge === "number" && surcharge > 0 && (
                        <Badge>Recargo {money(surcharge)}</Badge>
                      )}
                      {canceled && (
                        <span className="px-2 py-0.5 rounded bg-[#FF3816]/20 text-[#FF3816] text-[10px] uppercase font-bold">
                          ANULADA
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="shrink-0 text-xs text-white/60 max-w-[120px] truncate">
                    {v.createdByEmail || "—"}
                  </span>
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* Drawer Detalle */}
      {sel && (
        <VentaDrawer
          venta={sel}
          isAdmin4={isAdmin4}
          onClose={() => setSel(null)}
          onDeleted={() => {
            setSel(null);
            // ctx?.fetchVentas?.(); // Opcional, ya actualizamos localmente
          }}
        />
      )}
    </div>
  );
}

/* =================== Drawer Detalle =================== */
function VentaDrawer({ venta, onClose, onDeleted, isAdmin4 }) {
  const ctx = useContext(ContextGeneral);
  const firestore = ctx?.firestore;
  useDismissibleModal(!!venta, onClose);

  // Normalización de claves (importante por si cambia la estructura)
  const fieldKey = venta?.id || venta?._id;
  const chunkId = venta?.chunkDoc;

  const createdMs = tsToMs(venta?.createdAt) ?? idToMs(fieldKey) ?? 0;

  const subtotal = Number(venta?.totals?.subtotal ?? 0);
  const surcharge =
    Number(
      venta?.totals?.surchargeAmount ?? venta?.payment?.surcharge?.amount ?? 0,
    ) || 0;
  const total = Number(
    venta?.totals?.total ?? venta?.total ?? subtotal + surcharge,
  );

  const method = venta?.payment?.method || "—";
  const provider = venta?.payment?.provider || "manual";
  const s = venta?.payment?.surcharge || {};
  const hasSurcharge = !!s?.applied || surcharge > 0;
  const paymentSnapshot = getVentaPaymentSnapshot(venta);
  const paymentMeta = getVentaPaymentMeta(venta);
  const canceled = isCanceled(venta);
  const paymentUpdatedMs = tsToMs(paymentSnapshot.updatedAt);
  const displayMethod = paymentSnapshot.method || method || "—";
  const displayProvider = paymentSnapshot.provider || provider || "manual";

  // --- LOGICA DE ANULACIÓN (Soft Delete) ---
  async function handleDeleteVenta() {
    if (!isAdmin4) return;
    if (!firestore) return toast.error("Firestore no disponible");

    if (!chunkId || !fieldKey) {
      console.error("Faltan referencias:", { chunkId, fieldKey, venta });
      toast.error("Error: Faltan referencias del chunk o ID de venta.");
      return;
    }

    const ok = window.confirm(
      "¿Anular esta venta?\n\nSe marcará como 'voided' y no sumará en los reportes.",
    );
    if (!ok) return;

    try {
      const ref = doc(firestore, "ventas", chunkId);
      // Actualizamos solo el campo status dentro del objeto
      await updateDoc(ref, {
        [`${fieldKey}.status`]: "voided",
        [`${fieldKey}.deletedAt`]: serverTimestamp(),
        [`${fieldKey}.updatedAt`]: serverTimestamp(),
      });

      // Actualizar estado local INMEDIATAMENTE
      if (typeof ctx?.setVentas === "function") {
        ctx.setVentas((prev = []) =>
          prev.map((v) => {
            const currentId = v.id || v._id;
            return currentId === fieldKey && v.chunkDoc === chunkId
              ? { ...v, status: "voided" }
              : v;
          }),
        );
      }

      toast.success("Venta anulada correctamente.");
      onDeleted?.();
    } catch (e) {
      console.error(e);
      toast.error("Error al anular la venta.");
    }
  }

  // --- LOGICA DE ELIMINACIÓN DEFINITIVA (Hard Delete) ---
  async function handleHardDeleteVenta() {
    if (!isAdmin4) return;
    if (!firestore) return toast.error("Firestore no disponible");

    if (!chunkId || !fieldKey) {
      console.error("Faltan referencias:", { chunkId, fieldKey, venta });
      toast.error("Error: Faltan referencias del chunk o ID de venta.");
      return;
    }

    const confirm1 = window.confirm(
      "⚠️ PRECAUCIÓN: Eliminación Definitiva\n\nEsta acción borrará la venta de la base de datos para siempre.\n¿Desea continuar?",
    );
    if (!confirm1) return;

    const typed = window.prompt("Para confirmar, escribí la palabra: ELIMINAR");
    if ((typed || "").trim().toUpperCase() !== "ELIMINAR") return;

    try {
      const ref = doc(firestore, "ventas", chunkId);

      // Borramos el campo (key) entero del documento chunk
      await updateDoc(ref, { [fieldKey]: deleteField() });

      // Actualizar estado local eliminando el item del array
      if (typeof ctx?.setVentas === "function") {
        ctx.setVentas((prev = []) =>
          prev.filter((v) => {
            const currentId = v.id || v._id;
            return !(currentId === fieldKey && v.chunkDoc === chunkId);
          }),
        );
      }

      toast.success("Venta eliminada definitivamente.");
      onDeleted?.();
    } catch (e) {
      console.error(e);
      toast.error("No se pudo eliminar la venta.");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Overlay Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 transition-opacity"
        onClick={onClose}
      />

      {/* Panel Lateral */}
      <div className="relative w-full md:w-[800px] lg:w-[900px] h-full bg-[#0C212D] border-l border-white/10 shadow-2xl flex flex-col transform transition-transform">
        {/* Header Drawer */}
        <div className="px-4 md:px-6 py-4 border-b border-white/10 flex items-center justify-between bg-[#0C212D] z-10">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-[#EE7203] to-[#FF3816] shadow-lg shadow-[#EE7203]/20 ring-1 ring-white/10 flex items-center justify-center shrink-0">
              <ReceiptIcon className="h-6 w-6 text-white" />
            </div>
            <div className="min-w-0">
              <h3 className="text-lg md:text-xl font-bold leading-tight truncate text-white">
                Venta {fieldKey || ""}
              </h3>
              <p className="text-sm text-white/60 truncate mt-0.5">
                {fmtDate(createdMs)} •{" "}
                <span className="uppercase tracking-wider font-medium text-white/80">
                  {venta?.location}
                </span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-white/70 hover:text-white transition-all"
          >
            ✕
          </button>
        </div>

        {/* Body Scrollable */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
          {/* Status Bar */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10">
              <span className="text-xs text-white/50 uppercase tracking-wide">
                Método
              </span>
              <span className="text-sm font-medium">{labelMethod(displayMethod)}</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10">
              <span className="text-xs text-white/50 uppercase tracking-wide">
                Estado
              </span>
              <span className="text-sm font-medium capitalize">
                {venta?.status || "ok"}
              </span>
            </div>
            {paymentMeta.showBadge && (
              <div
                className={`px-3 py-1.5 rounded-lg border text-sm font-medium ${paymentMeta.pillClass}`}
              >
                {paymentMeta.badgeLabel}
              </div>
            )}
            {canceled && (
              <div className="px-3 py-1.5 rounded-lg bg-[#FF3816]/20 border border-[#FF3816]/30 text-[#FF3816] text-sm font-bold tracking-wide animate-pulse">
                ANULADA / VOIDED
              </div>
            )}
          </div>

          <div className="grid lg:grid-cols-3 gap-6">
            {/* Columna Izquierda: Items */}
            <div className="lg:col-span-2 space-y-4">
              <h4 className="text-sm font-medium text-white/70 uppercase tracking-wider">
                Detalle de Productos
              </h4>
              <div className="rounded-2xl border border-slate-700 overflow-hidden bg-[#0E2330]">
                <table className="w-full text-sm">
                  <thead className="bg-[#0A1B25] text-white/70">
                    <tr>
                      <Th>SKU</Th>
                      <Th>Producto</Th>
                      <Th className="text-right">Cant</Th>
                      <Th className="text-right">Total</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {(venta?.lines || []).map((l, i) => (
                      <tr key={i}>
                        <Td className="text-white/50 font-mono text-xs">
                          {l.sku || "-"}
                        </Td>
                        <Td>
                          <div className="font-medium text-white/90">
                            {l.name}
                          </div>
                          <div className="text-xs text-white/50">
                            {l.category}
                          </div>
                        </Td>
                        <Td className="text-right font-medium">{l.qty}</Td>
                        <Td className="text-right">
                          {money(l.subtotal || l.qty * l.unitPrice)}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Columna Derecha: Totales y Datos */}
            <div className="space-y-6">
              {/* Totales Card */}
              <div className="rounded-2xl bg-[#0E2330] border border-slate-700 p-5 space-y-3">
                <KV label="Subtotal" value={money(subtotal)} />
                {hasSurcharge && (
                  <div className="flex justify-between text-sm text-[#EE7203]">
                    <span>Recargo</span>
                    <span>{money(surcharge)}</span>
                  </div>
                )}
                <div className="border-t border-white/10 pt-3 flex justify-between items-end">
                  <span className="text-white/60">Total Final</span>
                  <span
                    className={`text-2xl font-bold ${canceled ? "line-through text-white/40" : "text-white"}`}
                  >
                    {money(total)}
                  </span>
                </div>
              </div>

              {/* Metadata Card */}
              <div className="rounded-2xl border border-white/10 p-5 space-y-3 text-sm">
                <h4 className="text-xs font-medium text-white/50 uppercase tracking-wider mb-2">
                  Información Técnica
                </h4>
                <div className="space-y-2">
                  <div className="flex flex-col">
                    <span className="text-xs text-white/40">Proveedor</span>
                    <span className="text-white/80 capitalize">
                      {displayProvider === "mercadopago" ? "Mercado Pago" : "Manual"}
                    </span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-xs text-white/40">Estado del cobro</span>
                    <span className="text-white/80">{paymentMeta.detailLabel}</span>
                  </div>
                  {displayProvider === "mercadopago" && (
                    <>
                      <div className="flex flex-col">
                        <span className="text-xs text-white/40">Order ID</span>
                        <span className="font-mono text-white/80 select-all break-all">
                          {paymentSnapshot.orderId || "—"}
                        </span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-xs text-white/40">Payment ID</span>
                        <span className="font-mono text-white/80 select-all break-all">
                          {paymentSnapshot.paymentId || "—"}
                        </span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-xs text-white/40">Último cambio MP</span>
                        <span className="text-white/80">
                          {paymentUpdatedMs ? fmtDate(paymentUpdatedMs) : "—"}
                        </span>
                      </div>
                    </>
                  )}
                  <div className="flex flex-col">
                    <span className="text-xs text-white/40">ID Venta</span>
                    <span className="font-mono text-white/80 select-all">
                      {fieldKey}
                    </span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-xs text-white/40">Chunk ID</span>
                    <span className="font-mono text-white/80 select-all truncate">
                      {chunkId || (
                        <span className="text-red-400 font-bold">
                          FALTA DATOS
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-xs text-white/40">Vendedor</span>
                    <span className="text-white/80">
                      {venta?.createdByEmail || "—"}
                    </span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-xs text-white/40">Fecha Exacta</span>
                    <span className="text-white/80">
                      {new Date(createdMs).toLocaleString()}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-white/10 bg-[#0C212D] flex flex-col sm:flex-row justify-between items-center gap-4">
          <div className="text-xs text-white/40 text-center sm:text-left">
            {isAdmin4
              ? "Acciones de Administrador"
              : "Acciones restringidas a Admin"}
          </div>
          <div className="flex gap-3 w-full sm:w-auto">
            <button
              onClick={onClose}
              className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-sm font-medium transition-colors"
            >
              Cerrar
            </button>
            {isAdmin4 && (
              <>
                {!canceled && (
                  <button
                    onClick={handleDeleteVenta}
                    className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-200 border border-red-500/20 text-sm font-medium transition-colors"
                  >
                    Anular (Soft)
                  </button>
                )}
                <button
                  onClick={handleHardDeleteVenta}
                  className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white shadow-lg shadow-red-600/20 text-sm font-medium transition-colors"
                >
                  Eliminar Definitivo
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* =================== UI Helpers =================== */
function Badge({ children }) {
  return (
    <span className="px-2 py-0.5 rounded-md text-xs bg-white/10 border border-white/5 text-white/80">
      {children}
    </span>
  );
}
function KV({ label, value }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-white/60">{label}</span>
      <span className="text-sm font-medium text-white/90">{String(value)}</span>
    </div>
  );
}

function Th({ children, className = "" }) {
  return (
    <th
      className={`px-4 py-3 text-left font-medium text-xs uppercase tracking-wider ${className}`}
    >
      {children}
    </th>
  );
}
function Td({ children, className = "" }) {
  return <td className={`px-4 py-3 ${className}`}>{children}</td>;
}

function SortableTh({ label, onClick, active, dir, className = "" }) {
  return (
    <th
      onClick={onClick}
      className={`px-4 py-3 text-left font-medium text-xs uppercase tracking-wider select-none cursor-pointer hover:bg-white/5 hover:text-white transition-colors ${className}`}
      title="Ordenar"
    >
      <div className="inline-flex items-center gap-1.5">
        <span className={active ? "text-white" : ""}>{label}</span>
        {active && (
          <span className="text-white/80 text-[10px]">
            {dir === "asc" ? "▲" : "▼"}
          </span>
        )}
      </div>
    </th>
  );
}

function ReceiptIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none">
      <path
        d="M6 3h12v18l-3-2-3 2-3-2-3 2V3z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9 7h6M9 11h6M9 15h4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* =================== Data Helpers =================== */
function tsToMs(ts) {
  if (!ts) return null;
  if (typeof ts?.toDate === "function") return ts.toDate().getTime();
  if (ts instanceof Date) return ts.getTime();
  if (typeof ts?.seconds === "number") return ts.seconds * 1000;
  return null;
}
function idToMs(id) {
  if (!id || typeof id !== "string") return null;
  const n = Number(id.replace(/^v_/, ""));
  return Number.isFinite(n) ? n : null;
}
function money(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return "-";
  return num.toLocaleString("es-AR", { style: "currency", currency: "ARS" });
}
function fmtDate(ms) {
  if (!ms) return "—";
  const d = new Date(ms);
  return d.toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });
}
function labelMethod(m) {
  if (m === "efectivo") return "Efectivo";
  if (m === "transferencia") return "Transf / QR";
  if (m === "mercadago" || m === "mercadopago") return "MercadoPago";
  return m || "—";
}
function isCanceled(v) {
  const s = String(v?.status || v?.estado || "").toLowerCase();
  return (
    s.includes("anul") ||
    s.includes("void") ||
    v?.canceled === true ||
    v?.anulada === true ||
    v?.void === true
  );
}
function getLatestPaymentEntry(v) {
  const payments = Array.isArray(v?.payments) ? v.payments : [];
  return payments.length > 0 ? payments[payments.length - 1] : null;
}
function getVentaPaymentSnapshot(v) {
  const latest = getLatestPaymentEntry(v);
  return {
    provider: String(
      latest?.provider || v?.payment?.provider || "manual",
    ).toLowerCase(),
    method: latest?.method || v?.payment?.method || "",
    status: String(latest?.status || v?.payment?.status || "").toLowerCase(),
    orderId: latest?.orderId || v?.payment?.orderId || "",
    paymentId: latest?.paymentId || v?.payment?.paymentId || "",
    updatedAt:
      latest?.updatedAt || v?.payment?.updatedAt || v?.updatedAt || null,
  };
}
function getVentaPaymentMeta(v) {
  const snapshot = getVentaPaymentSnapshot(v);
  const saleStatus = String(v?.status || v?.estado || "").toLowerCase();

  if (isCanceled(v)) {
    return {
      showBadge: false,
      badgeLabel: "Anulada",
      detailLabel: "Venta anulada manualmente",
      badgeClass:
        "px-2 py-0.5 rounded bg-[#FF3816]/20 text-[#FFB0A1] text-[10px] uppercase font-bold tracking-wide",
      pillClass: "border-[#FF3816]/30 bg-[#FF3816]/10 text-[#FFB0A1]",
    };
  }
  if (snapshot.provider !== "mercadopago") {
    return {
      showBadge: false,
      badgeLabel: "",
      detailLabel: "Cobro manual registrado",
      badgeClass: "",
      pillClass: "",
    };
  }
  if (snapshot.status === "approved" || saleStatus === "paid") {
    return {
      showBadge: true,
      badgeLabel: "Aprobado",
      detailLabel: "Cobro aprobado por Mercado Pago",
      badgeClass:
        "px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-100 text-[10px] uppercase font-bold tracking-wide",
      pillClass: "border-emerald-400/30 bg-emerald-500/15 text-emerald-100",
    };
  }
  if (snapshot.status === "pending" || saleStatus === "payment_pending") {
    return {
      showBadge: true,
      badgeLabel: "Pendiente",
      detailLabel: "Esperando confirmación de Mercado Pago",
      badgeClass:
        "px-2 py-0.5 rounded bg-sky-500/15 text-sky-100 text-[10px] uppercase font-bold tracking-wide",
      pillClass: "border-sky-400/30 bg-sky-500/15 text-sky-100",
    };
  }
  if (snapshot.status === "preparing" || saleStatus === "payment_preparing") {
    return {
      showBadge: true,
      badgeLabel: "Preparando",
      detailLabel: "Cobro creado, pendiente de vincular con el QR",
      badgeClass:
        "px-2 py-0.5 rounded bg-indigo-500/15 text-indigo-100 text-[10px] uppercase font-bold tracking-wide",
      pillClass: "border-indigo-400/30 bg-indigo-500/15 text-indigo-100",
    };
  }
  if (snapshot.status === "canceled" || saleStatus === "payment_canceled") {
    return {
      showBadge: true,
      badgeLabel: "Cancelado",
      detailLabel: "Cobro cancelado en Mercado Pago",
      badgeClass:
        "px-2 py-0.5 rounded bg-orange-500/15 text-orange-100 text-[10px] uppercase font-bold tracking-wide",
      pillClass: "border-orange-400/30 bg-orange-500/15 text-orange-100",
    };
  }
  if (snapshot.status === "expired" || saleStatus === "payment_expired") {
    return {
      showBadge: true,
      badgeLabel: "Vencido",
      detailLabel: "La orden venció sin pago",
      badgeClass:
        "px-2 py-0.5 rounded bg-amber-500/15 text-amber-100 text-[10px] uppercase font-bold tracking-wide",
      pillClass: "border-amber-400/30 bg-amber-500/15 text-amber-100",
    };
  }
  if (snapshot.status === "rejected" || saleStatus === "payment_rejected") {
    return {
      showBadge: true,
      badgeLabel: "Rechazado",
      detailLabel: "Mercado Pago rechazó el cobro",
      badgeClass:
        "px-2 py-0.5 rounded bg-rose-500/15 text-rose-100 text-[10px] uppercase font-bold tracking-wide",
      pillClass: "border-rose-400/30 bg-rose-500/15 text-rose-100",
    };
  }
  if (snapshot.status === "error" || saleStatus === "payment_error") {
    return {
      showBadge: true,
      badgeLabel: "Error",
      detailLabel: "La orden no terminó de cargarse correctamente",
      badgeClass:
        "px-2 py-0.5 rounded bg-red-500/15 text-red-100 text-[10px] uppercase font-bold tracking-wide",
      pillClass: "border-red-400/30 bg-red-500/15 text-red-100",
    };
  }
  return {
    showBadge: true,
    badgeLabel: "Sin estado",
    detailLabel: "Venta sin confirmación final de cobro",
    badgeClass:
      "px-2 py-0.5 rounded bg-white/10 text-white/70 text-[10px] uppercase font-bold tracking-wide",
    pillClass: "border-white/15 bg-white/5 text-white/80",
  };
}
function isSettledSale(v) {
  if (isCanceled(v)) return false;

  const snapshot = getVentaPaymentSnapshot(v);
  const provider = snapshot.provider;
  if (provider !== "mercadopago") return true;

  const paymentStatus = snapshot.status;
  const saleStatus = String(v?.status || "").toLowerCase();
  return paymentStatus === "approved" || saleStatus === "paid";
}
function sortLabel(key) {
  if (key === "fecha") return "Fecha";
  if (key === "sede") return "Sede";
  if (key === "items") return "Ítems";
  if (key === "subtotal") return "Subtotal";
  if (key === "recargo") return "Recargo";
  if (key === "total") return "Total";
  if (key === "pago") return "Pago";
  if (key === "creadaPor") return "Creador";
  return "Fecha";
}
