// /src/componentes/panel/HistorialVentas.jsx
"use client";

import React, { useMemo, useState, useContext } from "react";
import ContextGeneral from "@/servicios/contextGeneral";
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

  const ventas = Array.isArray(ctx?.ventas) ? ctx.ventas : [];
  const loading = ctx?.loader === true && ventas.length === 0;
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(null); // venta seleccionada (drawer)

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return ventas
      .filter((v) => v?.location === location)
      .filter((v) => {
        if (!t) return true;
        const totalTxt = String(v?.totals?.total ?? v?.total ?? "");
        return (
          v?.createdByEmail?.toLowerCase?.().includes(t) ||
          totalTxt.includes(t) ||
          (v?.lines || []).some(
            (l) =>
              l?.name?.toLowerCase?.().includes(t) ||
              l?.sku?.toLowerCase?.().includes(t) ||
              l?.category?.toLowerCase?.().includes(t)
          )
        );
      })
      .slice(0, 200);
  }, [ventas, location, q]);

  return (
    <div className="min-w-0">
      {/* Filtro + acciones (stack en mobile) */}
      <div className="mb-4 flex flex-col sm:flex-row gap-2 sm:items-center">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por producto / SKU / categoría / email…"
          className="w-full rounded-xl bg-[#0C212D] border border-white/10 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#EE7203]/70"
        />
        <div className="flex gap-2">
          <button
            onClick={() => setQ("")}
            className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-sm"
          >
            Limpiar
          </button>
          <button
            onClick={() => ctx?.fetchVentas?.()}
            className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-sm"
          >
            Refrescar
          </button>
        </div>
      </div>

      {/* Tabla (solo md+) */}
      <div className="hidden md:block overflow-hidden rounded-2xl border border-white/10">
        <div className="max-h-[70vh] overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-white/5 text-white/70 sticky top-0 z-10">
              <tr>
                <Th>Fecha</Th>
                <Th>Sede</Th>
                <Th className="text-right">Ítems</Th>
                <Th className="text-right">Subtotal</Th>
                <Th className="text-right">Recargo</Th>
                <Th className="text-right">Total</Th>
                <Th>Pago</Th>
                <Th>Creada por</Th>
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
                    0
                  );
                  const subtotal = Number(v?.totals?.subtotal ?? 0);
                  const surcharge = Number(
                    v?.totals?.surchargeAmount ??
                      v?.payment?.surcharge?.amount ??
                      0
                  );
                  const total = Number(
                    v?.totals?.total ?? v?.total ?? subtotal + surcharge
                  );
                  const method = v?.payment?.method || "—";
                  const createdMs =
                    tsToMs(v.createdAt) ?? idToMs(v._id) ?? idToMs(v.id) ?? 0;

                  return (
                    <tr
                      key={`${v.chunkDoc || "x"}_${v._id || v.id}`}
                      className="border-t border-white/5 hover:bg-white/5 cursor-pointer"
                      onClick={() => setSel(v)}
                      title="Ver detalle"
                    >
                      <Td>{fmtDate(createdMs)}</Td>
                      <Td className="uppercase">{v.location}</Td>
                      <Td className="text-right">{items}</Td>
                      <Td className="text-right">{money(subtotal)}</Td>
                      <Td className="text-right">{money(surcharge)}</Td>
                      <Td className="text-right">{money(total)}</Td>
                      <Td>
                        <Badge>{labelMethod(method)}</Badge>
                      </Td>
                      <Td className="truncate max-w-[220px]">
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
          <div className="rounded-xl border border-white/10 p-4 text-white/60">
            Cargando…
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-xl border border-white/10 p-4 text-white/60">
            Sin resultados
          </div>
        ) : (
          filtered.map((v) => {
            const items = (v?.lines || []).reduce(
              (acc, l) => acc + (parseInt(l?.qty ?? 0, 10) || 0),
              0
            );
            const subtotal = Number(v?.totals?.subtotal ?? 0);
            const surcharge = Number(
              v?.totals?.surchargeAmount ?? v?.payment?.surcharge?.amount ?? 0
            );
            const total = Number(
              v?.totals?.total ?? v?.total ?? subtotal + surcharge
            );
            const method = v?.payment?.method || "—";
            const createdMs =
              tsToMs(v.createdAt) ?? idToMs(v._id) ?? idToMs(v.id) ?? 0;

            return (
              <button
                key={`${v.chunkDoc || "x"}_${v._id || v.id}`}
                onClick={() => setSel(v)}
                className="w-full text-left rounded-2xl border border-white/10 bg-white/5 active:bg-white/10 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold leading-tight">
                      {money(total)}{" "}
                      <span className="font-normal">• {items} ítems</span>
                    </div>
                    <div className="text-xs text-white/60 mt-0.5">
                      {fmtDate(createdMs)} •{" "}
                      {v.location?.toUpperCase?.() || "—"}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Badge>{labelMethod(method)}</Badge>
                      {typeof surcharge === "number" && surcharge > 0 && (
                        <Badge>Recargo {money(surcharge)}</Badge>
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
          onClose={() => setSel(null)}
          onDeleted={() => {
            setSel(null);
            ctx?.fetchVentas?.(); // refresca listado
          }}
        />
      )}
    </div>
  );
}

/* =================== Drawer Detalle =================== */
function VentaDrawer({ venta, onClose, onDeleted }) {
  const ctx = useContext(ContextGeneral);
  const firestore = ctx?.firestore;

  // Normalizo
  const createdMs =
    tsToMs(venta?.createdAt) ?? idToMs(venta?._id) ?? idToMs(venta?.id) ?? 0;

  const subtotal = Number(venta?.totals?.subtotal ?? 0);
  const surcharge =
    Number(
      venta?.totals?.surchargeAmount ?? venta?.payment?.surcharge?.amount ?? 0
    ) || 0;
  const total = Number(
    venta?.totals?.total ?? venta?.total ?? subtotal + surcharge
  );

  const method = venta?.payment?.method || "—";
  const provider = venta?.payment?.provider || "manual";
  const s = venta?.payment?.surcharge || {};
  const hasSurcharge = !!s?.applied || surcharge > 0;

  // Soft delete: marcar como anulada dentro del chunk
  async function handleDeleteVenta() {
    if (!firestore) return toast.error("Firestore no disponible");

    const ok = window.confirm(
      "¿Anular esta venta?\n\nSe marcará como 'voided' dentro del chunk."
    );
    if (!ok) return;

    const chunkId = venta?.chunkDoc; // ej: "001"
    const fieldKey = venta?._id; // ej: "v_1695851112345"
    if (!chunkId || !fieldKey) {
      toast.error("Faltan referencias del chunk/venta.");
      return;
    }

    try {
      const ref = doc(firestore, "ventas", chunkId);
      await updateDoc(ref, {
        [`${fieldKey}.status`]: "voided",
        [`${fieldKey}.deletedAt`]: serverTimestamp(),
        [`${fieldKey}.updatedAt`]: serverTimestamp(),
      });

      // Optimista local
      if (typeof ctx?.setVentas === "function") {
        ctx.setVentas((prev = []) =>
          prev.map((v) =>
            v._id === fieldKey && v.chunkDoc === chunkId
              ? { ...v, status: "voided" }
              : v
          )
        );
      }

      toast.success("Venta anulada (soft delete).");
      onDeleted?.();
    } catch (e) {
      console.error(e);
      toast.error("No se pudo anular la venta.");
    }
  }

  // Hard delete: eliminar definitivamente el campo v_* del chunk
  async function handleHardDeleteVenta() {
    if (!firestore) return toast.error("Firestore no disponible");

    const chunkId = venta?.chunkDoc; // ej: "001"
    const fieldKey = venta?._id; // ej: "v_1695851112345"
    if (!chunkId || !fieldKey) {
      toast.error("Faltan referencias del chunk/venta.");
      return;
    }

    const confirm1 = window.confirm(
      "⚠️ Esta acción eliminará DEFINITIVAMENTE la venta del chunk.\n\n¿Continuar?"
    );
    if (!confirm1) return;

    const typed = window.prompt(
      "Para confirmar, escribí: ELIMINAR\n\n(Esto no podrá deshacerse)"
    );
    if ((typed || "").trim().toUpperCase() !== "ELIMINAR") return;

    try {
      const ref = doc(firestore, "ventas", chunkId);
      await updateDoc(ref, { [fieldKey]: deleteField() });

      // Optimista local
      if (typeof ctx?.setVentas === "function") {
        ctx.setVentas((prev = []) =>
          prev.filter((v) => !(v._id === fieldKey && v.chunkDoc === chunkId))
        );
      }

      toast.success("Venta eliminada definitivamente.");
      onDeleted?.();
    } catch (e) {
      console.error(e);
      toast.error("No se pudo eliminar definitivamente la venta.");
    }
  }

  return (
    <div className="fixed inset-0 z-40">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Panel derecho */}
      <div className="absolute right-0 top-0 h-full w-full md:w-[980px] bg-[#0C212D] border-l border-white/10 shadow-2xl flex flex-col">
        {/* Header */}
        <div className="px-4 md:px-5 py-3 md:py-4 border-b border-white/10 flex items-center justify-between sticky top-0 bg-[#0C212D]/95 backdrop-blur">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-[#EE7203] to-[#FF3816] ring-1 ring-white/10 flex items-center justify-center">
              <ReceiptIcon className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-base md:text-lg font-semibold leading-tight truncate">
                Venta {venta?._id || venta?.id || ""}
              </h3>
              <p className="text-xs text-white/60 truncate">
                {fmtDate(createdMs)} • {venta?.location?.toUpperCase?.()}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-2">
              <Badge>{labelMethod(method)}</Badge>
              <Badge>{venta?.status || "pending"}</Badge>
            </div>
            <button
              onClick={onClose}
              className="ml-2 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-sm"
            >
              Cerrar
            </button>
          </div>
        </div>

        {/* Contenido */}
        <div className="flex-1 overflow-auto p-4 md:p-5">
          <div className="grid lg:grid-cols-5 gap-4 md:gap-5">
            {/* LÍNEAS */}
            <div className="lg:col-span-3">
              <div className="rounded-2xl border border-white/10 overflow-hidden">
                <div className="max-h-[45vh] md:max-h-[55vh] overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-white/5 text-white/70 sticky top-0 z-10">
                      <tr>
                        <Th>SKU</Th>
                        <Th>Producto</Th>
                        <Th className="text-right">Cant.</Th>
                        <Th className="text-right">P. Unit.</Th>
                        <Th className="text-right">Subtotal</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {(venta?.lines || []).map((l, i) => {
                        const qty = Number(l?.qty || 0);
                        const unit = Number(l?.unitPrice || 0);
                        const sub = Number(l?.subtotal ?? qty * unit);
                        return (
                          <tr
                            key={`${l.productId || l.sku || "x"}_${i}`}
                            className="border-t border-white/5"
                          >
                            <Td className="whitespace-nowrap">
                              {l?.sku || "-"}
                            </Td>
                            <Td className="max-w-[360px]">
                              <div className="truncate font-medium">
                                {l?.name || "-"}
                              </div>
                              <div className="text-xs text-white/50 truncate">
                                {l?.category || "—"}
                              </div>
                            </Td>
                            <Td className="text-right">{qty}</Td>
                            <Td className="text-right">{money(unit)}</Td>
                            <Td className="text-right">{money(sub)}</Td>
                          </tr>
                        );
                      })}
                      {(!venta?.lines || venta.lines.length === 0) && (
                        <tr>
                          <td
                            colSpan={5}
                            className="p-6 text-center text-white/60"
                          >
                            Sin líneas registradas.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* RESUMEN & PAGO */}
            <div className="lg:col-span-2 space-y-4 md:space-y-5">
              {/* Totales */}
              <div className="rounded-2xl border border-white/10 p-4">
                <p className="text-xs text-white/60 mb-2">Totales</p>
                <KV label="Subtotal" value={money(subtotal)} />
                <div className="mt-1">
                  <KV
                    label={
                      hasSurcharge
                        ? `Recargo ${
                            s?.mode === "percent"
                              ? `${Number(s?.value || 0)}%`
                              : money(Number(s?.value || 0))
                          }`
                        : "Recargo"
                    }
                    value={money(surcharge)}
                  />
                </div>
                <div className="flex items-center justify-between pt-2 mt-2 border-t border-white/10">
                  <span className="text-sm text-white/70">Total</span>
                  <span className="font-semibold">{money(total)}</span>
                </div>
              </div>

              {/* Pago */}
              <div className="rounded-2xl border border-white/10 p-4">
                <p className="text-xs text-white/60 mb-2">Pago</p>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge>{labelMethod(method)}</Badge>
                  {provider && <Badge>{provider}</Badge>}
                  {venta?.createdByEmail && (
                    <span className="text-xs text-white/60 truncate">
                      por {venta.createdByEmail}
                    </span>
                  )}
                </div>
              </div>

              {/* Metadatos */}
              <div className="rounded-2xl border border-white/10 p-4">
                <p className="text-xs text-white/60 mb-2">Metadatos</p>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <KV label="ID" value={venta?._id || venta?.id || "—"} />
                  <KV label="Estado" value={venta?.status || "pending"} />
                  <KV label="Org" value={venta?.orgId || "—"} />
                  <KV
                    label="Sede"
                    value={venta?.location?.toUpperCase?.() || "—"}
                  />
                  <KV label="Creado" value={fmtDate(createdMs)} />
                  <KV label="Usuario" value={venta?.createdByEmail || "—"} />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer (stack en mobile) */}
        <div className="px-4 md:px-5 py-3 border-t border-white/10 bg-[#0C212D]/95 backdrop-blur">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="text-sm text-white/70">
              {venta?.lines?.length || 0} ítems • Total:{" "}
              <span className="font-semibold text-white">{money(total)}</span>
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-sm"
              >
                Cerrar
              </button>

              {/* Soft delete (anular) */}
              <button
                onClick={handleDeleteVenta}
                className="px-4 py-2 rounded-xl text-sm bg-red-500/20 hover:bg-red-500/25 text-red-200 ring-1 ring-white/10"
                title="Anular venta (soft delete en chunk)"
              >
                Anular
              </button>

              {/* Hard delete (eliminar definitivamente) */}
              <button
                onClick={handleHardDeleteVenta}
                className="px-4 py-2 rounded-xl text-sm bg-red-600/20 hover:bg-red-600/30 text-red-200 ring-1 ring-red-500/40"
                title="Eliminar definitivamente (borra el campo v_* del chunk)"
              >
                Eliminar definitivamente
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* =================== UI Helpers =================== */
function Badge({ children }) {
  return (
    <span className="px-2 py-0.5 rounded-md text-xs bg-white/10">
      {children}
    </span>
  );
}
function KV({ label, value }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-white/70">{label}</span>
      <span className="text-sm">{String(value)}</span>
    </div>
  );
}
function Th({ children, className = "" }) {
  return <th className={`px-3 py-2 text-left ${className}`}>{children}</th>;
}
function Td({ children, className = "" }) {
  return <td className={`px-3 py-2 ${className}`}>{children}</td>;
}
function ReceiptIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none">
      <path
        d="M6 3h12v18l-3-2-3 2-3-2-3 2V3z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path d="M9 7h6M9 11h6M9 15h4" stroke="currentColor" strokeWidth="1.5" />
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
  if (m === "transferencia") return "Transferencia / QR";
  if (m === "mercadago" || m === "mercadopago") return "MercadoPago";
  return m || "—";
}
