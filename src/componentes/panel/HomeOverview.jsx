// /src/componentes/panel/HomeOverview.jsx
"use client";

import React, { useContext, useMemo, useState } from "react";
import ContextGeneral from "@/servicios/contextGeneral";

const LOW_STOCK_THRESHOLD = 3; // alerta de poco stock
const RECENT_SALES_LIMIT = 12; // últimas ventas a mostrar
const TOP_PRODUCTS_LIMIT = 5; // top productos por cantidad

export default function HomeOverview({ location = "pv1" }) {
  const ctx = useContext(ContextGeneral);

  // Productos y ventas desde Context
  const productos = Array.isArray(ctx?.productos) ? ctx.productos : [];
  const ventas = Array.isArray(ctx?.ventas) ? ctx.ventas : [];
  const stockField = location === "pv2" ? "stockPv2" : "stockPv1";

  // Órdenes (solo consumo desde Context)
  const ordenes = Array.isArray(ctx?.ordenes) ? ctx.ordenes : [];
  const loadingOrdenes = !!ctx?.loadingOrdenes;

  // Loaders (solo UI; el Home NO hace fetch)
  const loadingVentas = ctx?.loader === true && ventas.length === 0;

  // ====== Modal genérico ======
  const [modal, setModal] = useState({ open: false, title: "", content: null });
  const openModal = (title, content) =>
    setModal({ open: true, title, content });
  const closeModal = () => setModal({ open: false, title: "", content: null });

  // ===== Derivados =====
  const ventasDeSede = useMemo(
    () => (ventas || []).filter((v) => v?.location === location),
    [ventas, location]
  );

  const kpis = useMemo(() => {
    const now = Date.now();
    const startOfToday = startOfDay(now);
    const startOfMonth = startOfMonthMs(now);

    let hoyMonto = 0,
      hoyTickets = 0,
      mesMonto = 0,
      mesTickets = 0,
      itemsVendidosMes = 0;

    ventasDeSede.forEach((v) => {
      const ms = getMs(v?.createdAt, v?._id);
      const totalV = Number(v?.totals?.total ?? v?.total ?? 0);
      if (ms >= startOfToday) {
        hoyMonto += totalV;
        hoyTickets += 1;
      }
      if (ms >= startOfMonth) {
        mesMonto += totalV;
        mesTickets += 1;
        itemsVendidosMes += (v?.lines || []).reduce(
          (acc, l) => acc + (parseInt(l?.qty ?? 0, 10) || 0),
          0
        );
      }
    });

    const lowStock = (productos || []).filter(
      (p) => Number.parseInt(p?.[stockField] ?? 0, 10) <= LOW_STOCK_THRESHOLD
    ).length;

    const totalSkus = (productos || []).length;

    return {
      hoyMonto,
      hoyTickets,
      mesMonto,
      mesTickets,
      itemsVendidosMes,
      lowStock,
      totalSkus,
    };
  }, [ventasDeSede, productos, stockField]);

  const recientes = useMemo(
    () => ventasDeSede.slice(0, RECENT_SALES_LIMIT),
    [ventasDeSede]
  );

  const topProductos = useMemo(() => {
    const map = new Map();
    ventasDeSede.forEach((v) => {
      (v?.lines || []).forEach((l) => {
        const key = l?.productId || l?.sku || l?.name || "unknown";
        const prev = map.get(key) || {
          key,
          name: l?.name || l?.sku || "Producto",
          qty: 0,
          revenue: 0,
        };
        prev.qty += Number(l?.qty || 0);
        prev.revenue += Number(l?.subtotal || 0);
        map.set(key, prev);
      });
    });
    const arr = Array.from(map.values());
    arr.sort((a, b) => b.qty - a.qty);
    return arr.slice(0, TOP_PRODUCTS_LIMIT);
  }, [ventasDeSede]);

  // ===== Handlers de detalle (abre modal con contenido) =====
  function showVentasHoy() {
    const start = startOfDay(Date.now());
    const list = ventasDeSede.filter((v) => getMs(v.createdAt, v._id) >= start);
    openModal("Ventas de HOY", <VentasList ventas={list} />);
  }
  function showVentasMes() {
    const start = startOfMonthMs(Date.now());
    const list = ventasDeSede.filter((v) => getMs(v.createdAt, v._id) >= start);
    openModal("Ventas del MES", <VentasList ventas={list} />);
  }
  function showSkus() {
    const rows = [...(productos || [])].sort((a, b) =>
      (a.name || "").localeCompare(b.name || "")
    );
    openModal(
      `SKUs en inventario (${rows.length}) — ${location.toUpperCase()}`,
      <ProductosList rows={rows} stockField={stockField} />
    );
  }
  function showLowStock() {
    const rows = (productos || [])
      .filter(
        (p) => Number.parseInt(p?.[stockField] ?? 0, 10) <= LOW_STOCK_THRESHOLD
      )
      .sort(
        (a, b) => Number(a?.[stockField] ?? 0) - Number(b?.[stockField] ?? 0)
      );
    openModal(
      `Stock bajo (≤ ${LOW_STOCK_THRESHOLD}) — ${location.toUpperCase()}`,
      <ProductosList rows={rows} stockField={stockField} />
    );
  }
  function showVenta(v) {
    openModal(
      `Venta ${v._id} — ${fmtDate(getMs(v.createdAt, v._id))}`,
      <VentaDetalle venta={v} />
    );
  }
  function showOrden(o) {
    openModal(`Orden ${o.code || o.id.slice(-6)}`, <OrdenDetalle orden={o} />);
  }
  function showTopProductosFull() {
    const map = new Map();
    ventasDeSede.forEach((v) => {
      (v?.lines || []).forEach((l) => {
        const key = l?.productId || l?.sku || l?.name || "unknown";
        const prev = map.get(key) || {
          key,
          name: l?.name || l?.sku || "Producto",
          qty: 0,
          revenue: 0,
        };
        prev.qty += Number(l?.qty || 0);
        prev.revenue += Number(l?.subtotal || 0);
        map.set(key, prev);
      });
    });
    const arr = Array.from(map.values())
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 50);
    openModal(
      "Top productos (últimos registros)",
      <TopProductosList rows={arr} />
    );
  }
  function showTopProductoDetalle(tp) {
    const lines = [];
    ventasDeSede.forEach((v) => {
      (v?.lines || []).forEach((l) => {
        const key = l?.productId || l?.sku || l?.name || "unknown";
        if (key === tp.key || l?.name === tp.name || l?.sku === tp.name) {
          lines.push({ venta: v, line: l });
        }
      });
    });
    openModal(
      `Detalle: ${tp.name}`,
      <TopProductoDetalle name={tp.name} lines={lines} />
    );
  }

  // ===== UI =====
  return (
    <div className="space-y-6 overflow-x-hidden max-w-full">
      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          title="Ventas HOY"
          value={money(kpis.hoyMonto)}
          hint={`${kpis.hoyTickets} tickets`}
          onClick={showVentasHoy}
        />
        <KpiCard
          title="Ventas del MES"
          value={money(kpis.mesMonto)}
          hint={`${kpis.mesTickets} tickets • ${kpis.itemsVendidosMes} ítems`}
          onClick={showVentasMes}
        />
        <KpiCard
          title="SKUs en inventario"
          value={kpis.totalSkus}
          hint={location.toUpperCase()}
          onClick={showSkus}
        />
        <KpiCard
          title="Stock bajo"
          value={kpis.lowStock}
          hint={`≤ ${LOW_STOCK_THRESHOLD} u. • ${location.toUpperCase()}`}
          tone="warn"
          onClick={showLowStock}
        />
      </div>

      {/* Si es taller, muestra resumen de órdenes */}
      {location === "taller" && (
        <div className="rounded-2xl border border-white/10 bg-[#112C3E]/80 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">Órdenes activas</h3>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                className="text-xs px-2 py-1 rounded-lg bg-white/10 hover:bg-white/15"
                onClick={() =>
                  openModal("Órdenes activas", <OrdenesList rows={ordenes} />)
                }
              >
                Ver detalle
              </button>
              <span className="text-xs text-white/60">
                {loadingOrdenes ? "Cargando…" : `${ordenes.length} órdenes`}
              </span>
            </div>
          </div>

          {/* Tabla md+ / cards mobile */}
          <div className="hidden md:block overflow-x-auto overscroll-x-contain">
            <table className="w-full text-sm">
              <thead className="bg-white/5 text-white/70 sticky top-0 z-10">
                <tr>
                  <Th>#</Th>
                  <Th>Vehículo</Th>
                  <Th>Cliente</Th>
                  <Th>Estado</Th>
                  <Th className="text-right">Estimado</Th>
                </tr>
              </thead>
              <tbody>
                {ordenes.slice(0, 8).map((o) => (
                  <tr
                    key={o.id}
                    className="border-t border-white/5 hover:bg-white/5 cursor-pointer"
                    onClick={() => showOrden(o)}
                  >
                    <Td>{o.code || o.id.slice(-6)}</Td>
                    <Td className="break-words">
                      {o.vehicle?.plate || o.vehicle?.model || "—"}
                    </Td>
                    <Td className="break-words">
                      {o.customer?.name || o.customerEmail || "—"}
                    </Td>
                    <Td>
                      <span className="px-2 py-0.5 rounded-md text-xs bg-white/10">
                        {o.status || "open"}
                      </span>
                    </Td>
                    <Td className="text-right">
                      {money(o.estimatedTotal || 0)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="md:hidden space-y-2 w-full overflow-hidden">
            {ordenes.slice(0, 8).map((o) => (
              <button
                key={o.id}
                onClick={() => showOrden(o)}
                className="w-full text-left rounded-xl border border-white/10 bg-white/5 active:bg-white/10 p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 break-words">
                    <div className="text-sm font-semibold">
                      #{o.code || o.id.slice(-6)} •{" "}
                      <span className="font-normal">
                        {o.vehicle?.plate || o.vehicle?.model || "—"}
                      </span>
                    </div>
                    <div className="text-xs text-white/60 mt-0.5 truncate">
                      {o.customer?.name || o.customerEmail || "—"}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="px-2 py-0.5 rounded bg-white/10 text-[11px] inline-block">
                      {o.status || "open"}
                    </div>
                    <div className="text-xs text-white/70 mt-1">
                      {money(o.estimatedTotal || 0)}
                    </div>
                  </div>
                </div>
              </button>
            ))}
            {ordenes.length === 0 && (
              <div className="rounded-xl border border-white/10 p-3 text-white/60">
                Sin órdenes abiertas.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Dos columnas: últimas ventas + top productos */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Últimas ventas */}
        <div className="rounded-2xl border border-white/10 bg-[#112C3E]/80 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">Últimas ventas</h3>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                className="text-xs px-2 py-1 rounded-lg bg-white/10 hover:bg-white/15"
                onClick={() =>
                  openModal(
                    "Todas las ventas recientes",
                    <VentasList ventas={ventasDeSede.slice(0, 100)} />
                  )
                }
              >
                Ver detalle
              </button>
              <span className="text-xs text-white/60">
                {loadingVentas ? "Cargando…" : `${recientes.length} mostradas`}
              </span>
            </div>
          </div>

          {/* Tabla md+ / cards mobile */}
          <div className="hidden md:block overflow-x-auto overscroll-x-contain">
            <table className="w-full text-sm">
              <thead className="bg-white/5 text-white/70 sticky top-0 z-10">
                <tr>
                  <Th>Fecha</Th>
                  <Th className="text-right">Ítems</Th>
                  <Th className="text-right">Total</Th>
                  <Th>Por</Th>
                </tr>
              </thead>
              <tbody>
                {recientes.map((v) => {
                  const items = (v?.lines || []).reduce(
                    (acc, l) => acc + (parseInt(l?.qty ?? 0, 10) || 0),
                    0
                  );
                  return (
                    <tr
                      key={`${v.chunkDoc}_${v._id}`}
                      className="border-t border-white/5 hover:bg-white/5 cursor-pointer"
                      onClick={() => showVenta(v)}
                    >
                      <Td>{fmtDate(getMs(v.createdAt, v._id))}</Td>
                      <Td className="text-right">{items}</Td>
                      <Td className="text-right">
                        {money(v?.totals?.total ?? v?.total)}
                      </Td>
                      <Td className="truncate max-w-[200px] break-words">
                        {v.createdByEmail || "—"}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="md:hidden space-y-2 w-full overflow-hidden">
            {recientes.length === 0 ? (
              <div className="rounded-xl border border-white/10 p-3 text-white/60">
                Sin ventas recientes.
              </div>
            ) : (
              recientes.map((v) => {
                const items = (v?.lines || []).reduce(
                  (acc, l) => acc + (parseInt(l?.qty ?? 0, 10) || 0),
                  0
                );
                const tot = Number(v?.totals?.total ?? v?.total ?? 0);
                return (
                  <button
                    key={`${v.chunkDoc}_${v._id}`}
                    onClick={() => showVenta(v)}
                    className="w-full text-left rounded-xl border border-white/10 bg-white/5 active:bg-white/10 p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 break-words">
                        <div className="text-sm font-semibold">
                          {money(tot)} •{" "}
                          <span className="font-normal">{items} ítems</span>
                        </div>
                        <div className="text-xs text-white/60 mt-0.5 truncate">
                          {fmtDate(getMs(v.createdAt, v._id))} •{" "}
                          {v.createdByEmail || "—"}
                        </div>
                      </div>
                      <span className="shrink-0 text-[11px] px-2 py-0.5 rounded bg-white/10">
                        {v.location?.toUpperCase?.() || "—"}
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Top productos + low stock */}
        <div className="rounded-2xl border border-white/10 bg-[#112C3E]/80 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">
              {location === "taller"
                ? "Top repuestos (venta)"
                : "Top productos (venta)"}
            </h3>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                className="text-xs px-2 py-1 rounded-lg bg-white/10 hover:bg-white/15"
                onClick={showTopProductosFull}
              >
                Ver detalle
              </button>
              <span className="text-xs text-white/60">
                {topProductos.length} ítems
              </span>
            </div>
          </div>

          {/* Tabla md+ / cards mobile */}
          <div className="hidden md:block overflow-x-auto overscroll-x-contain">
            <table className="w-full text-sm">
              <thead className="bg-white/5 text-white/70 sticky top-0 z-10">
                <tr>
                  <Th>Producto</Th>
                  <Th className="text-right">Unidades</Th>
                  <Th className="text-right">Ingresos</Th>
                </tr>
              </thead>
              <tbody>
                {topProductos.map((p, i) => (
                  <tr
                    key={i}
                    className="border-t border-white/5 hover:bg-white/5 cursor-pointer"
                    onClick={() => showTopProductoDetalle(p)}
                  >
                    <Td className="truncate max-w-[240px] break-words">
                      {p.name}
                    </Td>
                    <Td className="text-right">{p.qty}</Td>
                    <Td className="text-right">{money(p.revenue)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="md:hidden space-y-2 w-full overflow-hidden">
            {topProductos.length === 0 ? (
              <div className="rounded-xl border border-white/10 p-3 text-white/60">
                Sin datos suficientes.
              </div>
            ) : (
              topProductos.map((p, i) => (
                <button
                  key={i}
                  onClick={() => showTopProductoDetalle(p)}
                  className="w-full text-left rounded-xl border border-white/10 bg-white/5 active:bg-white/10 p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 break-words">
                      <div className="text-sm font-semibold truncate">
                        {p.name}
                      </div>
                      <div className="text-xs text-white/60 mt-0.5">
                        {p.qty} u • {money(p.revenue)}
                      </div>
                    </div>
                    <span className="shrink-0 text-[11px] px-2 py-0.5 rounded bg-white/10">
                      TOP
                    </span>
                  </div>
                </button>
              ))
            )}
          </div>

          {/* Low stock compacto */}
          <div className="mt-4 border-t border-white/10 pt-3">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-semibold">
                Stock bajo (≤ {LOW_STOCK_THRESHOLD}) — {location.toUpperCase()}
              </h4>
              <button
                className="text-xs px-2 py-1 rounded-lg bg-white/10 hover:bg-white/15"
                onClick={showLowStock}
              >
                Ver detalle
              </button>
            </div>

            {/* Lista compacta (ambos tamaños) */}
            <ul className="space-y-1 max-h-40 overflow-auto pr-1">
              {productos
                .filter(
                  (p) =>
                    Number.parseInt(p?.[stockField] ?? 0, 10) <=
                    LOW_STOCK_THRESHOLD
                )
                .sort(
                  (a, b) =>
                    Number(a?.[stockField] ?? 0) - Number(b?.[stockField] ?? 0)
                )
                .slice(0, 10)
                .map((p) => (
                  <li
                    key={`${p.chunkDoc}_${p.id}`}
                    className="flex items-center justify-between text-sm hover:bg-white/5 rounded-md px-2 py-1 cursor-pointer"
                    onClick={() =>
                      openModal(
                        `Producto: ${p.name}`,
                        <ProductoDetalle prod={p} stockField={stockField} />
                      )
                    }
                  >
                    <span className="truncate max-w-[70%]">{p.name}</span>
                    <span className="px-2 py-0.5 rounded bg-white/10 text-xs">
                      {Number.parseInt(p?.[stockField] ?? 0, 10)} u
                    </span>
                  </li>
                ))}
              {productos.filter(
                (p) =>
                  Number.parseInt(p?.[stockField] ?? 0, 10) <=
                  LOW_STOCK_THRESHOLD
              ).length === 0 && (
                <li className="text-sm text-white/60">Sin alertas.</li>
              )}
            </ul>
          </div>
        </div>
      </div>

      {/* ====== Modal ====== */}
      {modal.open && (
        <Modal title={modal.title} onClose={closeModal}>
          {modal.content}
        </Modal>
      )}

      <style jsx global>{`
        /* Evita overflow horizontal por textos largos */
        th,
        td,
        .break-words {
          word-break: break-word;
          overflow-wrap: anywhere;
        }
      `}</style>
    </div>
  );
}

/* ===== Subcomponentes/UI ===== */
function KpiCard({ title, value, hint, tone, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left rounded-2xl border border-white/10 bg-[#112C3E]/80 p-4 shadow hover:bg-white/5 transition-colors w-full"
      aria-label={`Ver detalle de ${title}`}
    >
      <div className="flex items-center justify-between">
        <h4 className="text-sm text-white/70">{title}</h4>
        <span
          className={`inline-block h-2.5 w-2.5 rounded-full ${
            tone === "warn" ? "bg-[#FF3816]" : "bg-[#EE7203]"
          }`}
        />
      </div>
      <div className="text-2xl font-semibold mt-1">{String(value)}</div>
      {hint ? <div className="text-xs text-white/60 mt-1">{hint}</div> : null}
    </button>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-[100] bg-black/60">
      {/* Cerrar al click fuera */}
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div
        className="relative z-[101] mx-auto my-6 w-full max-w-4xl px-4"
        role="dialog"
        aria-modal="true"
      >
        <div className="w-full rounded-2xl bg-[#0F2837] border border-white/10 shadow-2xl">
          <div className="p-3 md:p-4 border-b border-white/10 sticky top-0 bg-[#0F2837]/95 backdrop-blur z-10 flex items-center justify-between rounded-t-2xl">
            <h3 className="font-semibold truncate">{title}</h3>
            <button
              onClick={onClose}
              className="text-white/80 hover:text-white rounded-lg px-2 py-1 bg-white/5"
              aria-label="Cerrar"
            >
              ×
            </button>
          </div>
          <div className="p-3 md:p-4 max-h-[75vh] overflow-auto">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ===== Listas con versión responsive (tabla md+ / cards mobile) ===== */
function VentasList({ ventas }) {
  if (!ventas?.length)
    return <p className="text-sm text-white/60">Sin ventas.</p>;

  return (
    <>
      {/* Tabla md+ */}
      <div className="hidden md:block overflow-x-auto overscroll-x-contain">
        <table className="w-full text-sm">
          <thead className="bg-white/5 text-white/70 sticky top-0 z-10">
            <tr>
              <Th>Fecha</Th>
              <Th>Ticket</Th>
              <Th className="text-right">Ítems</Th>
              <Th className="text-right">Total</Th>
              <Th>Usuario</Th>
            </tr>
          </thead>
          <tbody>
            {ventas.map((v) => {
              const items = (v?.lines || []).reduce(
                (acc, l) => acc + (parseInt(l?.qty ?? 0, 10) || 0),
                0
              );
              return (
                <tr
                  key={`${v.chunkDoc}_${v._id}`}
                  className="border-t border-white/5"
                >
                  <Td>{fmtDate(getMs(v.createdAt, v._id))}</Td>
                  <Td className="truncate">{v._id}</Td>
                  <Td className="text-right">{items}</Td>
                  <Td className="text-right">
                    {money(v?.totals?.total ?? v?.total)}
                  </Td>
                  <Td className="truncate">{v.createdByEmail || "—"}</Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Cards mobile */}
      <div className="md:hidden space-y-2 w-full overflow-hidden">
        {ventas.map((v) => {
          const items = (v?.lines || []).reduce(
            (acc, l) => acc + (parseInt(l?.qty ?? 0, 10) || 0),
            0
          );
          const total = Number(v?.totals?.total ?? v?.total ?? 0);
          return (
            <div
              key={`${v.chunkDoc}_${v._id}`}
              className="rounded-xl border border-white/10 bg-white/5 p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 break-words">
                  <div className="text-sm font-semibold">
                    {money(total)} •{" "}
                    <span className="font-normal">{items} ítems</span>
                  </div>
                  <div className="text-xs text-white/60 mt-0.5 truncate">
                    {fmtDate(getMs(v.createdAt, v._id))} • Ticket {v._id}
                  </div>
                </div>
                <span className="shrink-0 text-[11px] px-2 py-0.5 rounded bg-white/10">
                  {v.createdByEmail || "—"}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function OrdenesList({ rows }) {
  if (!rows?.length)
    return <p className="text-sm text-white/60">Sin órdenes.</p>;

  return (
    <>
      {/* Tabla md+ */}
      <div className="hidden md:block overflow-x-auto overscroll-x-contain">
        <table className="w-full text-sm">
          <thead className="bg-white/5 text-white/70 sticky top-0 z-10">
            <tr>
              <Th>#</Th>
              <Th>Vehículo</Th>
              <Th>Cliente</Th>
              <Th>Estado</Th>
              <Th>Creada</Th>
              <Th className="text-right">Estimado</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.id} className="border-t border-white/5">
                <Td>{o.code || o.id.slice(-6)}</Td>
                <Td className="break-words">
                  {o.vehicle?.plate || o.vehicle?.model || "—"}
                </Td>
                <Td className="break-words">
                  {o.customer?.name || o.customerEmail || "—"}
                </Td>
                <Td>{o.status || "open"}</Td>
                <Td>{fmtDate(getMs(o.createdAt, o.id))}</Td>
                <Td className="text-right">{money(o.estimatedTotal || 0)}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Cards mobile */}
      <div className="md:hidden space-y-2 w-full overflow-hidden">
        {rows.map((o) => (
          <div
            key={o.id}
            className="rounded-xl border border-white/10 bg-white/5 p-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 break-words">
                <div className="text-sm font-semibold">
                  #{o.code || o.id.slice(-6)} •{" "}
                  <span className="font-normal">
                    {o.vehicle?.plate || o.vehicle?.model || "—"}
                  </span>
                </div>
                <div className="text-xs text-white/60 mt-0.5 truncate">
                  {o.customer?.name || o.customerEmail || "—"} •{" "}
                  {fmtDate(getMs(o.createdAt, o.id))}
                </div>
              </div>
              <div className="shrink-0 text-right text-xs">
                <div className="px-2 py-0.5 rounded bg-white/10 inline-block">
                  {o.status || "open"}
                </div>
                <div className="mt-1">{money(o.estimatedTotal || 0)}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function TopProductosList({ rows }) {
  if (!rows?.length) return <p className="text-sm text-white/60">Sin datos.</p>;

  return (
    <>
      {/* Tabla md+ */}
      <div className="hidden md:block overflow-x-auto overscroll-x-contain">
        <table className="w-full text-sm">
          <thead className="bg-white/5 text-white/70 sticky top-0 z-10">
            <tr>
              <Th>Producto</Th>
              <Th className="text-right">Unidades</Th>
              <Th className="text-right">Ingresos</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p, i) => (
              <tr key={i} className="border-t border-white/5">
                <Td className="truncate break-words">{p.name}</Td>
                <Td className="text-right">{p.qty}</Td>
                <Td className="text-right">{money(p.revenue)}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Cards mobile */}
      <div className="md:hidden space-y-2 w-full overflow-hidden">
        {rows.map((p, i) => (
          <div
            key={i}
            className="rounded-xl border border-white/10 bg-white/5 p-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 break-words">
                <div className="text-sm font-semibold truncate">{p.name}</div>
                <div className="text-xs text-white/60 mt-0.5">
                  {p.qty} u • {money(p.revenue)}
                </div>
              </div>
              <span className="shrink-0 text-[11px] px-2 py-0.5 rounded bg-white/10">
                TOP
              </span>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function TopProductoDetalle({ name, lines }) {
  if (!lines?.length)
    return (
      <p className="text-sm text-white/60">Sin ventas para este producto.</p>
    );

  const totalQty = lines.reduce((a, x) => a + Number(x.line.qty || 0), 0);
  const totalRev = lines.reduce((a, x) => a + Number(x.line.subtotal || 0), 0);

  return (
    <div className="space-y-3 text-sm">
      <div className="grid grid-cols-2 gap-2">
        <Info label="Producto" value={name} />
        <Info label="Unidades vendidas" value={totalQty} />
        <Info label="Ingresos" value={money(totalRev)} />
      </div>

      {/* Tabla md+ */}
      <div className="hidden md:block border-t border-white/10 pt-3">
        <h4 className="font-semibold mb-2">Ventas relacionadas</h4>
        <table className="w-full text-sm">
          <thead className="bg-white/5 text-white/70">
            <tr>
              <Th>Fecha</Th>
              <Th>Ticket</Th>
              <Th className="text-right">Cant.</Th>
              <Th className="text-right">Unit.</Th>
              <Th className="text-right">Subtotal</Th>
            </tr>
          </thead>
          <tbody>
            {lines.map(({ venta, line }, i) => (
              <tr key={i} className="border-t border-white/5">
                <Td>{fmtDate(getMs(venta.createdAt, venta._id))}</Td>
                <Td className="truncate">{venta._id}</Td>
                <Td className="text-right">{line.qty}</Td>
                <Td className="text-right">{money(line.unitPrice)}</Td>
                <Td className="text-right">{money(line.subtotal)}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Cards mobile */}
      <div className="md:hidden border-t border-white/10 pt-3 space-y-2 w-full overflow-hidden">
        <h4 className="font-semibold">Ventas relacionadas</h4>
        {lines.map(({ venta, line }, i) => (
          <div
            key={i}
            className="rounded-xl border border-white/10 bg-white/5 p-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 break-words">
                <div className="text-sm font-semibold">
                  {fmtDate(getMs(venta.createdAt, venta._id))}
                </div>
                <div className="text-xs text-white/60 mt-0.5 truncate">
                  Ticket {venta._id}
                </div>
              </div>
              <div className="shrink-0 text-right text-xs">
                <div>
                  {line.qty} u • {money(line.unitPrice)}
                </div>
                <div className="mt-0.5 font-semibold">
                  {money(line.subtotal)}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProductosList({ rows, stockField }) {
  if (!rows?.length)
    return <p className="text-sm text-white/60">Sin productos.</p>;

  return (
    <>
      {/* Tabla md+ */}
      <div className="hidden md:block overflow-x-auto overscroll-x-contain">
        <table className="w-full text-sm">
          <thead className="bg-white/5 text-white/70 sticky top-0 z-10">
            <tr>
              <Th>SKU</Th>
              <Th>Nombre</Th>
              <Th>Tipo</Th>
              <Th>Proveedor</Th>
              <Th className="text-right">Stock</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr
                key={`${p.chunkDoc}_${p.id}`}
                className="border-t border-white/5"
              >
                <Td className="truncate">{p.sku || "—"}</Td>
                <Td className="truncate break-words">{p.name || "—"}</Td>
                <Td className="truncate">{p.category || "—"}</Td>
                <Td className="truncate">{p.provider || "—"}</Td>
                <Td className="text-right">
                  {Number.parseInt(p?.[stockField] ?? 0, 10)}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Cards mobile */}
      <div className="md:hidden space-y-2 w-full overflow-hidden">
        {rows.map((p) => (
          <div
            key={`${p.chunkDoc}_${p.id}`}
            className="rounded-xl border border-white/10 bg-white/5 p-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 break-words">
                <div className="text-sm font-semibold truncate">
                  {p.name || "—"}
                </div>
                <div className="text-xs text-white/60 mt-0.5 truncate">
                  SKU {p.sku || "—"} • {p.category || "—"} • {p.provider || "—"}
                </div>
              </div>
              <span className="shrink-0 px-2 py-0.5 rounded bg-white/10 text-[11px]">
                {Number.parseInt(p?.[stockField] ?? 0, 10)} u
              </span>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function VentaDetalle({ venta }) {
  const subtotal = Number(venta?.totals?.subtotal ?? 0);
  const surcharge =
    Number(
      venta?.totals?.surchargeAmount ?? venta?.payment?.surcharge?.amount ?? 0
    ) || 0;
  const total = Number(
    venta?.totals?.total ?? venta?.total ?? subtotal + surcharge
  );
  const createdMs = getMs(venta?.createdAt, venta?._id);

  return (
    <div className="space-y-4 text-sm">
      <div className="grid grid-cols-2 gap-2">
        <Info label="Ticket" value={venta?._id || "—"} />
        <Info label="Fecha" value={fmtDate(createdMs)} />
        <Info label="Sede" value={venta?.location?.toUpperCase?.() || "—"} />
        <Info label="Usuario" value={venta?.createdByEmail || "—"} />
        <Info label="Subtotal" value={money(subtotal)} />
        <Info label="Recargo" value={money(surcharge)} />
        <Info label="Total" value={money(total)} />
      </div>

      {/* Tabla md+ */}
      <div className="hidden md:block border-t border-white/10 pt-3">
        <h4 className="font-semibold mb-2">Líneas</h4>
        <table className="w-full text-sm">
          <thead className="bg-white/5 text-white/70">
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
                  <Td className="whitespace-nowrap">{l?.sku || "-"}</Td>
                  <Td className="max-w-[360px]">
                    <div className="truncate font-medium">{l?.name || "-"}</div>
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
                <td colSpan={5} className="p-6 text-center text-white/60">
                  Sin líneas registradas.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Cards mobile */}
      <div className="md:hidden border-t border-white/10 pt-3 space-y-2 w-full overflow-hidden">
        <h4 className="font-semibold">Líneas</h4>
        {(venta?.lines || []).length === 0 ? (
          <div className="rounded-xl border border-white/10 p-3 text-white/60">
            Sin líneas registradas.
          </div>
        ) : (
          (venta?.lines || []).map((l, i) => {
            const qty = Number(l?.qty || 0);
            const unit = Number(l?.unitPrice || 0);
            const sub = Number(l?.subtotal ?? qty * unit);
            return (
              <div
                key={`${l.productId || l.sku || "x"}_${i}`}
                className="rounded-xl border border-white/10 bg-white/5 p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 break-words">
                    <div className="text-sm font-semibold truncate">
                      {l?.name || "-"}
                    </div>
                    <div className="text-xs text-white/60 mt-0.5 truncate">
                      SKU {l?.sku || "-"} • {l?.category || "—"}
                    </div>
                  </div>
                  <div className="shrink-0 text-right text-xs">
                    <div>
                      {qty} u • {money(unit)}
                    </div>
                    <div className="mt-0.5 font-semibold">{money(sub)}</div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

/* ===== Pequeños helpers UI ===== */
function Info({ label, value }) {
  return (
    <div>
      <div className="text-xs text-white/60">{label}</div>
      <div className="font-medium">{String(value)}</div>
    </div>
  );
}
function Th({ children, className = "" }) {
  return <th className={`px-3 py-2 text-left ${className}`}>{children}</th>;
}
function Td({ children, className = "" }) {
  return <td className={`px-3 py-2 align-top ${className}`}>{children}</td>;
}

/* ===== Helpers ===== */
function money(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return "-";
  return num.toLocaleString("es-AR", { style: "currency", currency: "ARS" });
}
function getMs(ts, idFallback) {
  if (!ts) {
    const n = Number(String(idFallback || "").replace("v_", ""));
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof ts?.toDate === "function") return ts.toDate().getTime();
  if (ts instanceof Date) return ts.getTime();
  if (typeof ts?.seconds === "number") return ts.seconds * 1000;
  return 0;
}
function fmtDate(ms) {
  if (!ms) return "—";
  const d = new Date(ms);
  return d.toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });
}
function startOfDay(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function startOfMonthMs(ms) {
  const d = new Date(ms);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function finalPriceContado(p) {
  return p.discountActive && p.priceDiscount > 0 ? p.priceDiscount : p.price;
}
