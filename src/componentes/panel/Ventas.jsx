// /src/componentes/ventas/Ventas.jsx
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
  updateDoc,
  deleteField,
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

  const userRole =
    ctx?.role || ctx?.claims?.role || ctx?.userRole || ctx?.profile?.role;
  const canEditStock = ["admin", "manager"].includes(String(userRole || ""));

  // Productos desde Context
  const productosCtx = Array.isArray(ctx?.productos) ? ctx.productos : [];
  const loading = ctx?.loader === true && productosCtx.length === 0;

  // Presupuestos desde Context (fetch 1 sola vez en Context)
  const presupuestos = Array.isArray(ctx?.presupuestos) ? ctx.presupuestos : [];
  const loadingBudgets = !!ctx?.presupuestosLoading;
  const fetchPresupuestos = ctx?.fetchPresupuestos;

  const [q, setQ] = useState("");
  const [onlyStock, setOnlyStock] = useState(false);
  const [cart, setCart] = useState({});

  /* ====== Estado de pago (persistente) ====== */
  const [paymentMethod, setPaymentMethod] = useState("efectivo"); // transferencia | efectivo | mercadago
  const [applyExtra, setApplyExtra] = useState(false);
  const [extraMode, setExtraMode] = useState("percent"); // percent | fixed
  const [extraPercent, setExtraPercent] = useState(0); // %
  const [extraFixed, setExtraFixed] = useState(0); // $

  // ===== Filtro de presupuestos (solo UI) =====
  const [qBudgets, setQBudgets] = useState("");

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

  /* =========================
   * Helpers chunking ventas
   * ========================= */
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

  /* =========================
   * Helpers chunking presupuestos
   * ========================= */
  async function getLastBudgetDocId() {
    const colRef = collection(firestore, "presupuestos");
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
  async function appendBudgetChunked(budgetObj) {
    let targetId = await getLastBudgetDocId();
    let attempts = 0;
    while (attempts < 3) {
      const ref = doc(firestore, "presupuestos", targetId);
      try {
        await runTransaction(firestore, async (tx) => {
          const snap = await tx.get(ref);
          const data = snap.exists() ? snap.data() || {} : {};
          const keys = Object.keys(data).filter((k) => k.startsWith("b_"));
          if (keys.length >= CHUNK_SIZE) throw new Error("FULL");
          const budgetId = `b_${Date.now()}`;
          const toWrite = {};
          toWrite[budgetId] = budgetObj;
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

  /* =========================
   * Guardar como Presupuesto
   * ========================= */
  async function saveAsBudget() {
    if (!firestore) return toast.error("Firestore no disponible");
    const lines = Object.values(cart);
    if (lines.length === 0) return toast.error("Agregá productos al carrito");

    let nombre = prompt("Nombre del presupuesto (ej: Cliente + Patente):", "");
    if (nombre == null) return; // cancelado
    nombre = (nombre || "").trim();
    if (!nombre) return toast.error("Ingresá un nombre para el presupuesto");

    const user = auth?.currentUser || ctx?.user || null;

    const payload = {
      orgId: ctx?.orgId || "default_org",
      location,
      name: nombre,
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
        unitPrice: Number(finalPrice(prod)),
        subtotal: Number(finalPrice(prod)) * qty,
      })),
      totals: {
        subtotal: Number(subtotal),
        surchargeAmount: Number(surchargeAmount),
        total: Number(total),
        currency: "ARS",
      },
      paymentLike: {
        // no es una venta, pero guardamos cómo se calculó
        surcharge: {
          applied: !!applyExtra,
          mode: extraMode,
          value:
            extraMode === "percent"
              ? Number(extraPercent) || 0
              : Number(extraFixed) || 0,
          amount: Number(surchargeAmount),
        },
      },
      status: "draft", // es un presupuesto, no una venta
    };

    try {
      await toast.promise(appendBudgetChunked(payload), {
        loading: "Guardando presupuesto…",
        success: "Presupuesto guardado",
        error: "No se pudo guardar el presupuesto",
      });
      if (typeof fetchPresupuestos === "function") await fetchPresupuestos();
    } catch (e) {
      console.error(e);
    }
  }

  function printBudget(b) {
    const now = new Date();
    const fmt = (n) =>
      typeof n === "number"
        ? n.toLocaleString("es-AR", { style: "currency", currency: "ARS" })
        : n;

    const rows = (b.lines || [])
      .map(
        (l) => `
        <tr>
          <td>${esc(l.sku || "-")}</td>
          <td>${esc(l.name || "-")}</td>
          <td style="text-align:right">${l.qty}</td>
          <td style="text-align:right">${fmt(l.unitPrice)}</td>
          <td style="text-align:right">${fmt(l.subtotal)}</td>
        </tr>`
      )
      .join("");

    // HTML completo con auto-print al cargar
    const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Presupuesto - ${esc(b.name || "")}</title>
<style>
  body{ font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, "Helvetica Neue", Arial; color:#111; }
  .shell{ max-width: 900px; margin: 0 auto; padding: 24px; }
  h1{ margin:0 0 4px; font-size:22px; }
  h2{ margin:0 0 12px; font-size:14px; color:#444;}
  table{ width:100%; border-collapse:collapse; margin-top:8px; font-size:12px;}
  th,td{ border-bottom:1px solid #ddd; padding:8px; }
  thead th{ background:#f5f5f5; text-align:left;}
  .totals{ margin-top:12px; width:100%; }
  .totals td{ padding:6px 8px; }
  .right{ text-align:right;}
  .muted{ color:#666; font-size:11px; }
  .badge{ display:inline-block; padding:2px 8px; border:1px solid #999; border-radius:999px; font-size:11px; color:#444; }
  @media print { .no-print{ display:none } }
</style>
</head>
<body onload="setTimeout(()=>{ try{ window.focus(); window.print(); }catch(e){} }, 100);">
  <div class="shell">
    <div style="display:flex; justify-content:space-between; align-items:flex-end; gap:12px;">
      <div>
        <h1>Presupuesto</h1>
        <h2>${esc(b.name || "")}</h2>
        <div class="muted">Generado: ${now.toLocaleString("es-AR")}</div>
        <div class="muted">Sede: ${esc((b.location || "").toUpperCase())}</div>
      </div>
      <div><span class="badge">Mecánico App</span></div>
    </div>

    <table>
      <thead>
        <tr>
          <th>SKU</th>
          <th>Producto</th>
          <th class="right">Cant.</th>
          <th class="right">Unit.</th>
          <th class="right">Subtotal</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    <table class="totals">
      <tr>
        <td class="right" style="width:80%;">Subtotal</td>
        <td class="right" style="width:20%;">${fmt(
          b?.totals?.subtotal || 0
        )}</td>
      </tr>
      <tr>
        <td class="right">Recargo</td>
        <td class="right">${fmt(b?.totals?.surchargeAmount || 0)}</td>
      </tr>
      <tr>
        <td class="right"><strong>Total</strong></td>
        <td class="right"><strong>${fmt(b?.totals?.total || 0)}</strong></td>
      </tr>
    </table>

    <p class="muted">* Este documento es un presupuesto. No implica reserva de stock ni constituye factura.</p>

    <button class="no-print" onclick="window.print()">Imprimir / Guardar PDF</button>
  </div>
</body>
</html>`;

    try {
      // 1) Intento abrir en una pestaña nueva con un Blob (menos probable que lo bloquee)
      const blob = new Blob([html], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      const w = window.open(url, "_blank", "noopener,noreferrer");

      if (w && typeof w.focus === "function") {
        // liberar la URL cuando la pestaña nueva ya tuvo tiempo de cargar
        setTimeout(() => URL.revokeObjectURL(url), 30_000);
        return;
      }

      // 2) Fallback sin popups: iframe oculto que imprime
      const iframe = document.createElement("iframe");
      iframe.style.position = "fixed";
      iframe.style.right = "0";
      iframe.style.bottom = "0";
      iframe.style.width = "0";
      iframe.style.height = "0";
      iframe.style.border = "0";
      document.body.appendChild(iframe);
      iframe.onload = () => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
        } finally {
          // liberar recursos y remover iframe
          setTimeout(() => {
            URL.revokeObjectURL(url);
            document.body.removeChild(iframe);
          }, 1000);
        }
      };
      iframe.src = url;
    } catch (e) {
      console.error(e);
      toast.error("No se pudo generar el PDF para imprimir");
    }
  }

  async function deleteBudget(b) {
    if (!firestore) return;
    if (!confirm("¿Eliminar este presupuesto?")) return;
    try {
      const ref = doc(firestore, "presupuestos", b.chunkDoc);
      await toast.promise(updateDoc(ref, { [b.id]: deleteField() }), {
        loading: "Eliminando…",
        success: "Presupuesto eliminado",
        error: "No se pudo eliminar",
      });
      if (typeof fetchPresupuestos === "function") await fetchPresupuestos();
    } catch (e) {
      console.error(e);
    }
  }

  function loadBudgetIntoCart(b) {
    const next = {};
    for (const l of b.lines || []) {
      // busco el producto real para respetar stock y precio actual
      const p = productosCtx.find((x) => x.id === l.productId) || {
        // fallback plano
        id: l.productId,
        name: l.name,
        sku: l.sku,
        category: l.category,
        [stockField]: 9999, // permito cargar aunque no esté en memoria
        price: l.unitPrice,
        priceDiscount: 0,
        discountActive: false,
        chunkDoc: l.chunkDoc,
      };
      next[p.id] = { prod: p, qty: l.qty };
    }
    setCart(next);
    toast.success("Presupuesto cargado al carrito");
  }

  /* =========================
   * STOCK RÁPIDO (admin/manager)
   * ========================= */
  async function addStockQuick(prod) {
    const deltaStr = prompt(
      `Sumar al stock (${location.toUpperCase()}) para "${
        prod.name
      }"\nIngrese cantidad (puede ser negativa para restar):`,
      "1"
    );
    if (deltaStr == null) return;
    const delta = parseInt(deltaStr, 10);
    if (isNaN(delta) || delta === 0) return toast.error("Cantidad inválida");

    const ref = doc(firestore, "productos", prod.chunkDoc);
    try {
      await toast.promise(
        runTransaction(firestore, async (tx) => {
          const snap = await tx.get(ref);
          if (!snap.exists())
            throw new Error("Documento de productos no existe");
          const data = snap.data() || {};
          const field = `p_${prod.id}`;
          const obj = data[field];
          if (!obj) throw new Error("Producto no encontrado");
          const current = parseInt(obj[stockField] ?? 0, 10);
          const next = Math.max(0, current + delta);
          const updates = {};
          updates[`${field}.${stockField}`] = next;
          updates[`${field}.updatedAt`] = serverTimestamp();
          tx.update(ref, updates);
        }),
        {
          loading: "Actualizando stock…",
          success: "Stock actualizado",
          error: (e) => e?.message || "No se pudo actualizar",
        }
      );

      // Update local context
      if (typeof ctx?.setProductos === "function") {
        ctx.setProductos((prev = []) =>
          prev.map((p) => {
            if (p.id !== prod.id) return p;
            const cur = parseInt(p[stockField] ?? 0, 10);
            return { ...p, [stockField]: Math.max(0, cur + delta) };
          })
        );
      }
    } catch (e) {
      console.error(e);
    }
  }

  /* =========================
   * Checkout → VENTA
   * ========================= */
  const checkout = async () => {
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

      // 2) Registrar venta
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
          unitPrice: Number(finalPrice(prod)),
          subtotal: Number(finalPrice(prod)) * qty,
        })),
        totals: {
          subtotal: Number(subtotal),
          surchargeAmount: Number(surchargeAmount),
          total: Number(total),
          currency: "ARS",
        },
        payment: {
          method: paymentMethod,
          provider: paymentMethod === "mercadago" ? "mercadopago" : "manual",
          status: "not_started",
          surcharge: {
            applied: !!applyExtra,
            mode: extraMode,
            value:
              extraMode === "percent"
                ? Number(extraPercent) || 0
                : Number(extraFixed) || 0,
            amount: Number(surchargeAmount),
          },
        },
        status: "pending",
      };

      await appendVentaChunked(ventaPayload);

      // 3) Actualizar stock en memoria
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
  };

  if (location === "taller") {
    return (
      <div className="text-white/70">
        La venta está disponible solo para PV1 y PV2.
      </div>
    );
  }

  /* =========================
   * UI
   * ========================= */
  const budgetsFiltered = useMemo(() => {
    const t = qBudgets.trim().toLowerCase();
    return (presupuestos || []).filter((b) => {
      if (!t) return true;
      return (
        (b.name || "").toLowerCase().includes(t) ||
        (b.createdByEmail || "").toLowerCase().includes(t)
      );
    });
  }, [presupuestos, qBudgets]);

  return (
    <div className="grid gap-6 md:grid-cols-3 overflow-x-hidden md:overflow-x-visible">
      {/* Productos */}
      <div className="md:col-span-2 w-full overflow-x-hidden md:overflow-visible">
        <div className="mb-3 flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 w-full">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar producto por nombre / SKU / categoría…"
            className="w-full sm:flex-1 rounded-xl bg-[#0C212D] border border-white/10 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#EE7203]/70"
          />

          <label className="inline-flex items-center gap-2 text-sm text-white/80">
            <input
              type="checkbox"
              checked={onlyStock}
              onChange={(e) => setOnlyStock(e.target.checked)}
              className="accent-[#EE7203]"
            />
            Solo con stock
          </label>

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

        {/* Tabla md+ */}
        <div className="hidden md:block overflow-x-auto rounded-2xl border border-white/10">
          <table className="w-full text-sm">
            <thead className="bg-white/5 text-white/70">
              <tr>
                <Th>SKU</Th>
                <Th>Nombre</Th>
                <Th>Cat.</Th>
                <Th className="text-right">Precio</Th>
                <Th className="text-right">Stock {location.toUpperCase()}</Th>
                <Th className="w-40 text-center">Acción</Th>
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
                      <Td className="text-right">
                        <div className="inline-flex items-center gap-2 justify-end w-full">
                          <span>{stock}</span>
                          {canEditStock && (
                            <button
                              onClick={() => addStockQuick(p)}
                              className="px-2 py-0.5 rounded-md bg-white/10 hover:bg-white/15 text-xs"
                              title="Ajustar stock rápido"
                            >
                              + stock
                            </button>
                          )}
                        </div>
                      </Td>
                      <Td className="text-center">
                        <div className="flex items-center justify-center gap-2">
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
                          {canEditStock && (
                            <button
                              onClick={() => addStockQuick(p)}
                              className="px-3 py-1.5 rounded-lg text-xs bg-white/10 hover:bg-white/15"
                            >
                              Ajustar
                            </button>
                          )}
                        </div>
                      </Td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Cards mobile */}
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
                    <div className="flex flex-col gap-1">
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
                      {canEditStock && (
                        <button
                          onClick={() => addStockQuick(p)}
                          className="px-3 py-1.5 rounded-lg text-xs bg-white/10 hover:bg-white/15"
                        >
                          + stock
                        </button>
                      )}
                    </div>
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

      {/* Carrito / Pagos / Presupuestos */}
      <div className="md:col-span-1 w-full overflow-x-hidden md:overflow-visible">
        <div className="rounded-2xl border border-white/10 bg-[#0C212D]/40 p-4 md:sticky md:top-4 space-y-4">
          <h3 className="font-semibold">Carrito</h3>

          {/* MÉTODO DE PAGO */}
          <div className="rounded-xl border border-white/10 p-3 bg-white/5">
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

          {/* Items del carrito */}
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

              <div className="grid grid-cols-1 gap-2">
                <button
                  onClick={checkout}
                  className="w-full px-4 py-2 rounded-xl bg-gradient-to-r from-[#EE7203] to-[#FF3816] font-medium"
                >
                  Finalizar venta
                </button>

                <button
                  onClick={saveAsBudget}
                  className="w-full px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 font-medium"
                  title="Guardar carrito como presupuesto"
                >
                  Guardar como presupuesto
                </button>
              </div>
            </div>
          )}

          {/* Presupuestos guardados */}
          <div className="pt-2 border-t border-white/10">
            <div className="flex items-center justify-between gap-2 mb-2">
              <h4 className="font-semibold text-sm">Presupuestos</h4>
              <button
                onClick={() =>
                  typeof fetchPresupuestos === "function" && fetchPresupuestos()
                }
                className="text-xs px-2 py-1 rounded-md bg-white/10 hover:bg-white/15"
                title="Refrescar"
              >
                Recargar
              </button>
            </div>
            <input
              value={qBudgets}
              onChange={(e) => setQBudgets(e.target.value)}
              placeholder="Buscar presupuesto…"
              className="w-full rounded-lg bg-[#0C212D] border border-white/10 px-2.5 py-2 text-sm outline-none focus:ring-2 focus:ring-[#EE7203]/70 mb-2"
            />
            <div className="max-h-64 overflow-auto rounded-lg border border-white/10">
              {loadingBudgets ? (
                <div className="p-3 text-white/60 text-sm">Cargando…</div>
              ) : budgetsFiltered.length === 0 ? (
                <div className="p-3 text-white/60 text-sm">Sin resultados</div>
              ) : (
                budgetsFiltered.slice(0, 25).map((b) => (
                  <div
                    key={`${b.chunkDoc}_${b.id}`}
                    className="px-3 py-2 text-sm border-b border-white/5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-medium truncate">
                          {b.name || "(sin nombre)"}
                        </div>
                        <div className="text-xs text-white/60 truncate">
                          {b.createdByEmail || "—"} •{" "}
                          {String(b.location || "").toUpperCase()} •{" "}
                          {money(b?.totals?.total || 0)}
                        </div>
                      </div>
                      <div className="shrink-0 flex items-center gap-1">
                        <button
                          onClick={() => loadBudgetIntoCart(b)}
                          className="px-2 py-1 rounded-md bg-white/10 hover:bg-white/15 text-xs"
                          title="Cargar al carrito"
                        >
                          Cargar
                        </button>
                        <button
                          onClick={() => printBudget(b)}
                          className="px-2 py-1 rounded-md bg-white/10 hover:bg-white/15 text-xs"
                          title="Imprimir / PDF"
                        >
                          PDF
                        </button>
                        <button
                          onClick={() => deleteBudget(b)}
                          className="px-2 py-1 rounded-md bg-red-500/15 hover:bg-red-500/25 text-red-200 text-xs"
                          title="Eliminar"
                        >
                          Eliminar
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
            <p className="text-[11px] text-white/50 mt-1">
              * Se muestran los últimos 25 resultados filtrados.
            </p>
          </div>
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
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
