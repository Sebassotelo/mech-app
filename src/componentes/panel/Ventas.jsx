"use client";
import React, { useContext, useMemo, useState, useEffect } from "react";
import { toast } from "sonner";
import ContextGeneral from "@/servicios/contextGeneral";
import {
  collection,
  doc,
  getDocs,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";

const CHUNK_SIZE = 200;

/* =========================
 * Config pagos
 * ========================= */
const PAYMENT_METHODS = [
  { id: "transferencia", label: "Transferencia / QR" },
  { id: "efectivo", label: "Efectivo" },
  { id: "mercadago", label: "MercadoPago" },
];

const LS = {
  method: "mx.pay.method",
  apply: "mx.pay.apply",
  mode: "mx.pay.mode", // percent | fixed
  percent: "mx.pay.percent", // número %
  fixed: "mx.pay.fixed", // número $
};

export default function Ventas({ location = "pv1" }) {
  const ctx = useContext(ContextGeneral);
  const firestore = ctx?.firestore;
  const auth = ctx?.auth;

  // Productos desde Context
  const productosCtx = Array.isArray(ctx?.productos) ? ctx.productos : [];
  const loading = ctx?.loader === true && productosCtx.length === 0;

  const [q, setQ] = useState("");
  const [onlyStock, setOnlyStock] = useState(false);
  const [cart, setCart] = useState({});

  /* ====== Estado de pago (persistente) ====== */
  const [paymentMethod, setPaymentMethod] = useState("efectivo"); // transferencia | efectivo | mercadago
  const [applyExtra, setApplyExtra] = useState(false);
  const [extraMode, setExtraMode] = useState("percent"); // percent | fixed
  const [extraPercent, setExtraPercent] = useState(0); // %
  const [extraFixed, setExtraFixed] = useState(0); // $

  // Restaurar preferencias
  useEffect(() => {
    try {
      const m = localStorage.getItem(LS.method);
      const a = localStorage.getItem(LS.apply);
      const md = localStorage.getItem(LS.mode);
      const p = localStorage.getItem(LS.percent);
      const f = localStorage.getItem(LS.fixed);
      if (m) setPaymentMethod(m);
      if (a !== null) setApplyExtra(a === "true");
      if (md) setExtraMode(md);
      if (p !== null) setExtraPercent(Number(p) || 0);
      if (f !== null) setExtraFixed(Number(f) || 0);
    } catch {}
  }, []);
  // Guardar preferencias
  useEffect(() => {
    try {
      localStorage.setItem(LS.method, paymentMethod);
      localStorage.setItem(LS.apply, String(applyExtra));
      localStorage.setItem(LS.mode, extraMode);
      localStorage.setItem(LS.percent, String(extraPercent || 0));
      localStorage.setItem(LS.fixed, String(extraFixed || 0));
    } catch {}
  }, [paymentMethod, applyExtra, extraMode, extraPercent, extraFixed]);

  const stockField = location === "pv2" ? "stockPv2" : "stockPv1";

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return productosCtx
      .filter((p) => {
        const inTxt =
          !t ||
          p.name?.toLowerCase().includes(t) ||
          p.sku?.toLowerCase().includes(t) ||
          p.category?.toLowerCase().includes(t);
        const hasStock = !onlyStock || parseInt(p[stockField] ?? 0, 10) > 0;
        return inTxt && p.enabled !== false && hasStock;
      })
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }, [productosCtx, q, onlyStock, stockField]);

  // ===== Paginación =====
  const [pageSize, setPageSize] = useState(25); // 0 = todos
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [q, onlyStock, productosCtx, pageSize]);

  const totalCount = filtered.length;
  const totalPages =
    pageSize === 0 ? 1 : Math.max(1, Math.ceil(totalCount / pageSize));
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [totalPages, page]);

  const startIndex = pageSize === 0 ? 0 : (page - 1) * pageSize;
  const endIndex =
    pageSize === 0 ? totalCount : Math.min(totalCount, startIndex + pageSize);
  const pageItems = useMemo(
    () => filtered.slice(startIndex, endIndex),
    [filtered, startIndex, endIndex]
  );

  /* =========================
   * Totales + Recargo
   * ========================= */
  const subtotal = useMemo(
    () =>
      Object.values(cart).reduce(
        (acc, it) => acc + it.qty * finalPrice(it.prod),
        0
      ),
    [cart]
  );

  const currentExtraValue =
    extraMode === "percent"
      ? Number(extraPercent) || 0
      : Number(extraFixed) || 0;

  const surchargeAmount = useMemo(() => {
    if (!applyExtra) return 0;
    if (extraMode === "percent") {
      return (subtotal * Math.max(0, Number(extraPercent) || 0)) / 100;
    }
    return Math.max(0, Number(extraFixed) || 0);
  }, [applyExtra, extraMode, extraPercent, extraFixed, subtotal]);

  const total = useMemo(
    () => subtotal + surchargeAmount,
    [subtotal, surchargeAmount]
  );

  /* =========================
   * Cart ops
   * ========================= */
  function addToCart(prod) {
    const current = cart[prod.id]?.qty || 0;
    const available = parseInt(prod[stockField] ?? 0, 10);
    if (available <= current) return toast.error("Stock insuficiente");
    setCart((c) => ({ ...c, [prod.id]: { prod, qty: current + 1 } }));
  }

  function setQty(prodId, qty) {
    const qn = Math.max(1, parseInt(qty || 1, 10));
    const it = cart[prodId];
    if (!it) return;
    const available = parseInt(it.prod[stockField] ?? 0, 10);
    if (qn > available) return toast.error("No hay stock suficiente");
    setCart((c) => ({ ...c, [prodId]: { ...c[prodId], qty: qn } }));
  }

  function removeFromCart(prodId) {
    setCart((c) => {
      const { [prodId]: _, ...rest } = c;
      return rest;
    });
  }

  // ===== Helpers ventas chunking =====
  function pad3(n) {
    return String(n).padStart(3, "0");
  }
  async function getLastVentasDocId() {
    const colRef = collection(firestore, "ventas");
    const snap = await getDocs(colRef);
    if (snap.empty) return "001";
    const ids = snap.docs
      .map((d) => d.id)
      .filter((id) => /^\d+$/.test(id))
      .map((id) => parseInt(id, 10))
      .sort((a, b) => a - b);
    if (ids.length === 0) return "001";
    return pad3(ids[ids.length - 1]);
  }
  async function appendVentaChunked(ventaObj) {
    let targetId = await getLastVentasDocId();
    let attempts = 0;
    while (attempts < 3) {
      const ref = doc(firestore, "ventas", targetId);
      try {
        await runTransaction(firestore, async (tx) => {
          const snap = await tx.get(ref);
          const data = snap.exists() ? snap.data() || {} : {};
          const keys = Object.keys(data).filter((k) => k.startsWith("v_"));
          if (keys.length >= CHUNK_SIZE) throw new Error("FULL");
          const ventaId = `v_${Date.now()}`;
          const toWrite = {};
          toWrite[ventaId] = ventaObj;
          tx.set(ref, toWrite, { merge: true });
        });
        return { ok: true, docId: targetId };
      } catch (e) {
        if (String(e?.message).includes("FULL")) {
          targetId = pad3(parseInt(targetId, 10) + 1);
          attempts++;
          continue;
        }
        throw e;
      }
    }
  }

  // 🔸 Checkout
  async function checkout() {
    if (!firestore) return toast.error("Firestore no disponible");
    const lines = Object.values(cart);
    if (lines.length === 0) return toast.error("Agregá productos al carrito");

    // Agrupar por chunkDoc
    const groups = {};
    for (const it of lines) {
      const cd = it.prod.chunkDoc;
      if (!groups[cd]) groups[cd] = [];
      groups[cd].push(it);
    }

    const run = async () => {
      // 1) Descontar stock por chunk
      for (const [chunkId, chunkLines] of Object.entries(groups)) {
        const ref = doc(firestore, "productos", chunkId);
        await runTransaction(firestore, async (tx) => {
          const snap = await tx.get(ref);
          if (!snap.exists())
            throw new Error("Documento de productos no existe");
          const data = snap.data() || {};
          const updates = {};
          for (const { prod, qty } of chunkLines) {
            const field = `p_${prod.id}`;
            const obj = data[field];
            if (!obj) throw new Error(`Producto ${prod.name} no encontrado`);
            const current = parseInt(obj[stockField] ?? 0, 10);
            if (current < qty)
              throw new Error(`Stock insuficiente para ${prod.name}`);
            const next = current - qty;
            updates[`${field}.${stockField}`] = next;
            updates[`${field}.updatedAt`] = serverTimestamp();
          }
          tx.update(ref, updates);
        });
      }

      // 2) Registrar la venta en /ventas
      const user = auth?.currentUser || ctx?.user || null;

      const ventaPayload = {
        orgId: ctx?.orgId || "default_org",
        location,
        createdAt: serverTimestamp(),
        createdBy: user?.uid || null,
        createdByEmail: user?.email || null,
        lines: lines.map(({ prod, qty }) => ({
          productId: prod.id,
          chunkDoc: prod.chunkDoc,
          sku: prod.sku || null,
          name: prod.name || null,
          category: prod.category || null,
          qty,
          unitPrice: Number(finalPrice(prod)), // precio base (sin recargo)
          subtotal: Number(finalPrice(prod)) * qty,
        })),
        totals: {
          subtotal: Number(subtotal),
          surchargeAmount: Number(surchargeAmount), // 💾 recargo calculado
          total: Number(total),
          currency: "ARS",
        },
        payment: {
          method: paymentMethod, // transferencia | efectivo | mercadago
          provider: paymentMethod === "mercadago" ? "mercadopago" : "manual",
          status: "not_started",
          // 💾 detalle de recargo (según modo y valor actual)
          surcharge: {
            applied: !!applyExtra,
            mode: extraMode, // "percent" | "fixed"
            value:
              extraMode === "percent"
                ? Number(extraPercent) || 0
                : Number(extraFixed) || 0,
            amount: Number(surchargeAmount), // ARS aplicados
          },
        },
        status: "pending",
      };

      await appendVentaChunked(ventaPayload);

      // 3) ✅ Actualizar stock en memoria
      if (typeof ctx?.setProductos === "function") {
        ctx.setProductos((prev = []) =>
          prev.map((p) => {
            const hit = lines.find((l) => l.prod.id === p.id);
            if (!hit) return p;
            const cur = parseInt(p[stockField] ?? 0, 10);
            const next = Math.max(0, cur - hit.qty);
            return { ...p, [stockField]: next };
          })
        );
      }
    };

    try {
      await toast.promise(run(), {
        loading: "Procesando venta…",
        success: "Venta registrada y stock actualizado.",
        error: (e) => e?.message || "No se pudo completar la venta",
      });
      setCart({});
    } catch (e) {
      console.error(e);
    }
  }

  if (location === "taller") {
    return (
      <div className="text-white/70">
        La venta está disponible solo para PV1 y PV2.
      </div>
    );
  }

  return (
    <div className="grid gap-6 md:grid-cols-3 overflow-x-hidden md:overflow-x-visible">
      {/* Productos */}
      <div className="md:col-span-2 w-full overflow-x-hidden md:overflow-visible">
        {/* Filtros: mobile-first, se apilan */}
        <div className="mb-3 flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 w-full">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar producto por nombre / SKU / categoría…"
            className="w-full sm:flex-1 rounded-xl bg-[#0C212D] border border-white/10 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#EE7203]/70"
          />

          {/* Solo con stock */}
          <label className="inline-flex items-center gap-2 text-sm text-white/80">
            <input
              type="checkbox"
              checked={onlyStock}
              onChange={(e) => setOnlyStock(e.target.checked)}
              className="accent-[#EE7203]"
            />
            Solo con stock
          </label>

          {/* Page size selector */}
          <label className="inline-flex items-center gap-2 text-sm text-white/80">
            Ver:
            <select
              value={pageSize}
              onChange={(e) => setPageSize(parseInt(e.target.value, 10))}
              className="rounded-lg bg-[#0C212D] border border-white/10 px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[#EE7203]/70"
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={0}>Todos</option>
            </select>
          </label>
        </div>

        {/* Tabla md+ (desktop intacto) */}
        <div className="hidden md:block overflow-x-auto rounded-2xl border border-white/10">
          <table className="w-full text-sm">
            <thead className="bg-white/5 text-white/70">
              <tr>
                <Th>SKU</Th>
                <Th>Nombre</Th>
                <Th>Cat.</Th>
                <Th className="text-right">Precio</Th>
                <Th className="text-right">Stock {location.toUpperCase()}</Th>
                <Th className="w-28 text-center">Acción</Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-white/60">
                    Cargando…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-white/60">
                    Sin resultados
                  </td>
                </tr>
              ) : (
                pageItems.map((p) => {
                  const stock = parseInt(p[stockField] ?? 0, 10);
                  return (
                    <tr
                      key={`${p.chunkDoc}_${p.id}`}
                      className="border-t border-white/5"
                    >
                      <Td>{p.sku || "-"}</Td>
                      <Td className="font-medium">{p.name}</Td>
                      <Td>{p.category || "-"}</Td>
                      <Td className="text-right">{money(finalPrice(p))}</Td>
                      <Td className="text-right">{stock}</Td>
                      <Td className="text-center">
                        <button
                          onClick={() => addToCart(p)}
                          disabled={stock <= 0}
                          className={`px-3 py-1.5 rounded-lg text-xs ${
                            stock > 0
                              ? "bg-gradient-to-r from-[#EE7203] to-[#FF3816]"
                              : "bg-white/10 text-white/50 cursor-not-allowed"
                          }`}
                        >
                          Agregar
                        </button>
                      </Td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Cards mobile (sin overflow X) */}
        <div className="md:hidden space-y-2 w-full overflow-hidden">
          {loading ? (
            <div className="rounded-xl border border-white/10 p-3 text-white/60">
              Cargando…
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-xl border border-white/10 p-3 text-white/60">
              Sin resultados
            </div>
          ) : (
            pageItems.map((p) => {
              const stock = parseInt(p[stockField] ?? 0, 10);
              return (
                <div
                  key={`${p.chunkDoc}_${p.id}`}
                  className="rounded-xl border border-white/10 bg-white/5 p-3 w-full"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 break-words">
                      <div className="text-sm font-semibold truncate">
                        {p.name}
                      </div>
                      <div className="text-xs text-white/60 mt-0.5 truncate">
                        SKU {p.sku || "-"} • {p.category || "-"}
                      </div>
                      <div className="text-xs text-white/70 mt-1">
                        {money(finalPrice(p))} • Stock {stock}
                      </div>
                    </div>
                    <button
                      onClick={() => addToCart(p)}
                      disabled={stock <= 0}
                      className={`shrink-0 px-3 py-1.5 rounded-lg text-xs ${
                        stock > 0
                          ? "bg-gradient-to-r from-[#EE7203] to-[#FF3816]"
                          : "bg-white/10 text-white/50 cursor-not-allowed"
                      }`}
                    >
                      Agregar
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer de paginación */}
        {!loading && filtered.length > 0 && (
          <div className="mt-3 flex flex-col md:flex-row items-center justify-between gap-3 text-sm text-white/80">
            <div className="w-full md:w-auto">
              Mostrando{" "}
              <span className="text-white">
                {totalCount === 0 ? 0 : startIndex + 1}–{endIndex}
              </span>{" "}
              de <span className="text-white">{totalCount}</span> productos
            </div>
            {pageSize !== 0 && (
              <div className="flex flex-wrap items-center gap-1">
                <button
                  className="px-2 py-1 rounded-lg bg-white/10 hover:bg-white/15 disabled:opacity-50"
                  onClick={() => setPage(1)}
                  disabled={page <= 1}
                >
                  « Primero
                </button>
                <button
                  className="px-2 py-1 rounded-lg bg-white/10 hover:bg-white/15 disabled:opacity-50"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                >
                  ‹ Anterior
                </button>
                <span className="px-2">
                  Página <span className="text-white">{page}</span> de{" "}
                  <span className="text-white">{totalPages}</span>
                </span>
                <button
                  className="px-2 py-1 rounded-lg bg-white/10 hover:bg-white/15 disabled:opacity-50"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                >
                  Siguiente ›
                </button>
                <button
                  className="px-2 py-1 rounded-lg bg-white/10 hover:bg-white/15 disabled:opacity-50"
                  onClick={() => setPage(totalPages)}
                  disabled={page >= totalPages}
                >
                  Última »
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Carrito / Pagos */}
      <div className="md:col-span-1 w-full overflow-x-hidden md:overflow-visible">
        <div className="rounded-2xl border border-white/10 bg-[#0C212D]/40 p-4 md:sticky md:top-4">
          <h3 className="font-semibold mb-3">Carrito</h3>

          {/* MÉTODO DE PAGO */}
          <div className="mb-4 rounded-xl border border-white/10 p-3 bg-white/5">
            <p className="text-xs text-white/70 mb-2">Medio de pago</p>
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              className="w-full rounded-lg bg-[#0C212D] border border-white/10 px-2.5 py-2 text-sm outline-none focus:ring-2 focus:ring-[#EE7203]/70"
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>

            {/* RECARGO */}
            <div className="mt-3 space-y-2">
              <label className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="accent-[#EE7203]"
                  checked={applyExtra}
                  onChange={(e) => setApplyExtra(e.target.checked)}
                />
                Aplicar recargo
              </label>

              <div
                className={`grid grid-cols-1 sm:grid-cols-2 gap-2 ${
                  applyExtra ? "" : "opacity-60 pointer-events-none"
                }`}
              >
                <select
                  value={extraMode}
                  onChange={(e) => setExtraMode(e.target.value)}
                  className="rounded-lg bg-[#0C212D] border border-white/10 px-2.5 py-2 text-sm outline-none focus:ring-2 focus:ring-[#EE7203]/70"
                >
                  <option value="percent">% Porcentaje</option>
                  <option value="fixed">$ Monto fijo</option>
                </select>

                {/* El input muestra el número del modo actual */}
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={currentExtraValue}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (extraMode === "percent") setExtraPercent(v);
                    else setExtraFixed(v);
                  }}
                  placeholder={
                    extraMode === "percent" ? "% ej: 10" : "$ ej: 500"
                  }
                  className="rounded-lg bg-[#0C212D] border border-white/10 px-2.5 py-2 text-sm outline-none focus:ring-2 focus:ring-[#EE7203]/70"
                />
              </div>
              {applyExtra && (
                <p className="text-xs text-white/60">
                  Recargo{" "}
                  {extraMode === "percent"
                    ? `${Number(extraPercent || 0)}%`
                    : money(Number(extraFixed || 0))}
                </p>
              )}
            </div>
          </div>

          {Object.values(cart).length === 0 ? (
            <p className="text-sm text-white/60">Sin productos.</p>
          ) : (
            <div className="space-y-3">
              {Object.values(cart).map(({ prod, qty }) => (
                <div
                  key={prod.id}
                  className="flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <p className="truncate">{prod.name}</p>
                    <p className="text-xs text-white/60">{prod.sku}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      value={qty}
                      min={1}
                      className="w-16 inp"
                      onChange={(e) => setQty(prod.id, e.target.value)}
                    />
                    <button
                      className="px-2 py-1 rounded-lg bg-white/10"
                      onClick={() => removeFromCart(prod.id)}
                    >
                      x
                    </button>
                  </div>
                  <div className="text-right w-24">
                    {money(finalPrice(prod) * qty)}
                  </div>
                </div>
              ))}

              <div className="border-t border-white/10 pt-3 mt-3 space-y-1">
                <Row label="Subtotal" value={money(subtotal)} />
                <Row label="Recargo" value={money(surchargeAmount)} />
                <div className="flex items-center justify-between pt-1">
                  <span className="text-sm text-white/70">Total</span>
                  <span className="font-semibold">{money(total)}</span>
                </div>
              </div>

              <button
                onClick={checkout}
                className="w-full mt-2 px-4 py-2 rounded-xl bg-gradient-to-r from-[#EE7203] to-[#FF3816] font-medium"
              >
                Finalizar venta
              </button>
            </div>
          )}
        </div>
      </div>

      <style jsx global>{`
        .inp {
          background: #0c212d;
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 0.75rem;
          padding: 0.4rem 0.6rem;
          outline: none;
        }
        .inp:focus {
          box-shadow: 0 0 0 2px rgba(238, 114, 3, 0.6);
        }
        /* Evita que elementos hijos rompan el viewport en mobile */
        @media (max-width: 767px) {
          html,
          body {
            width: 100%;
            overflow-x: hidden;
          }
        }
      `}</style>
    </div>
  );
}

/* helpers UI */
function Th({ children, className = "" }) {
  return <th className={`px-3 py-2 text-left ${className}`}>{children}</th>;
}
function Td({ children, className = "" }) {
  return <td className={`px-3 py-2 ${className}`}>{children}</td>;
}
function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-white/70">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  );
}

/* helpers data */
function finalPrice(p) {
  return p.discountActive && p.priceDiscount > 0 ? p.priceDiscount : p.price;
}
function money(n) {
  if (typeof n !== "number" || isNaN(n)) return "-";
  return n.toLocaleString("es-AR", { style: "currency", currency: "ARS" });
}
