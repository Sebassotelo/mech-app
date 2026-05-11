"use client";
import React, { useContext, useMemo, useState, useEffect, useRef } from "react";
import { flushSync } from "react-dom";
import { toast } from "sonner";
import ContextGeneral from "@/servicios/contextGeneral";
import useDismissibleModal from "@/hooks/useDismissibleModal";
import HelpHint from "@/componentes/HelpHint";
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

// ==========================
// Cols config (LS)
// ==========================
const LS_COLS = "mx.ventas.columns";
const DEFAULT_COLS = {
  sku: true,
  name: true,
  category: true,
  price: true,
  stock: true,
  action: true,
};

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
  // descuento
  d_apply: "mx.disc.apply",
  d_mode: "mx.disc.mode",
  d_percent: "mx.disc.percent",
  d_fixed: "mx.disc.fixed",
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

  // Presupuestos desde Context
  const presupuestos = Array.isArray(ctx?.presupuestos) ? ctx.presupuestos : [];
  const loadingBudgets = !!ctx?.presupuestosLoading;
  const fetchPresupuestos = ctx?.fetchPresupuestos;
  const ventasCtx = Array.isArray(ctx?.ventas) ? ctx.ventas : [];

  const [q, setQ] = useState("");
  const [onlyStock, setOnlyStock] = useState(false);
  const [cart, setCart] = useState({});

  // ====== Estado de Equivalencias (Nuevo) ======
  const [showEq, setShowEq] = useState(true);

  // ====== Estado de pago (persistente) ======
  const [paymentMethod, setPaymentMethod] = useState("efectivo");
  const [applyExtra, setApplyExtra] = useState(false);
  const [extraMode, setExtraMode] = useState("percent"); // percent | fixed
  const [extraPercent, setExtraPercent] = useState(0);
  const [extraFixed, setExtraFixed] = useState(0);

  // ====== Descuento (persistente) ======
  const [applyDiscount, setApplyDiscount] = useState(true);
  const [discountMode, setDiscountMode] = useState("percent");
  const [discountPercent, setDiscountPercent] = useState(0);
  const [discountFixed, setDiscountFixed] = useState(0);

  // Flag para no pisar LS antes de cargar
  const [hydrated, setHydrated] = useState(false);

  // ===== Filtro de presupuestos (solo UI) =====
  const [qBudgets, setQBudgets] = useState("");

  // ===== Columnas visibles (LS) =====
  const [cols, setCols] = useState(DEFAULT_COLS);
  const [showColsPanel, setShowColsPanel] = useState(false);
  const colsBtnRef = useRef(null);
  const colsPanelRef = useRef(null);

  // ===== Drawer Carrito
  const [cartOpen, setCartOpen] = useState(false);
  const [paymentMonitor, setPaymentMonitor] = useState(null);
  const [paymentQueueOpen, setPaymentQueueOpen] = useState(false);
  const [cancelingMonitorKey, setCancelingMonitorKey] = useState("");
  const [reconcilingMonitorKey, setReconcilingMonitorKey] = useState("");

  const getMpRequestHeaders = async () => {
    if (!auth?.currentUser) {
      throw new Error("No hay sesión activa para operar con Mercado Pago");
    }
    const idToken = await auth.currentUser.getIdToken();
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    };
  };

  // ==========================
  // Carga inicial desde localStorage
  // ==========================
  useEffect(() => {
    try {
      // ----- Recargo / pago -----
      const m = localStorage.getItem(LS.method);
      const a = localStorage.getItem(LS.apply);
      const md = localStorage.getItem(LS.mode);
      const p = localStorage.getItem(LS.percent);
      const f = localStorage.getItem(LS.fixed);

      const pm = m || "efectivo";
      const applyExtraInit = a !== null ? a === "true" : false;
      const extraModeInit = md || "percent";
      const extraPercentInit = p !== null ? Number(p) || 0 : 0;
      const extraFixedInit = f !== null ? Number(f) || 0 : 0;

      // ----- Descuento -----
      const da = localStorage.getItem(LS.d_apply);
      const dm = localStorage.getItem(LS.d_mode);
      const dp = localStorage.getItem(LS.d_percent);
      const df = localStorage.getItem(LS.d_fixed);

      // Si no había nada para d_apply, por defecto:
      // - si es efectivo => descuento aplicado
      const applyDiscountInit = da !== null ? da === "true" : pm === "efectivo";

      const discountModeInit = dm || "percent";
      const discountPercentInit = dp !== null ? Number(dp) || 0 : 0;
      const discountFixedInit = df !== null ? Number(df) || 0 : 0;

      setPaymentMethod(pm);
      setApplyExtra(applyExtraInit);
      setExtraMode(extraModeInit);
      setExtraPercent(extraPercentInit);
      setExtraFixed(extraFixedInit);

      setApplyDiscount(applyDiscountInit);
      setDiscountMode(discountModeInit);
      setDiscountPercent(discountPercentInit);
      setDiscountFixed(discountFixedInit);
    } catch {}

    // ----- Columnas -----
    try {
      const saved = localStorage.getItem(LS_COLS);
      if (saved) {
        const parsed = JSON.parse(saved);
        setCols({ ...DEFAULT_COLS, ...parsed });
      }
    } catch {}

    setHydrated(true);
  }, []);

  // Persistir configuración
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(LS.method, paymentMethod);
      localStorage.setItem(LS.apply, String(applyExtra));
      localStorage.setItem(LS.mode, extraMode);
      localStorage.setItem(LS.percent, String(extraPercent ?? 0));
      localStorage.setItem(LS.fixed, String(extraFixed ?? 0));
      localStorage.setItem(LS.d_apply, String(applyDiscount));
      localStorage.setItem(LS.d_mode, discountMode);
      localStorage.setItem(LS.d_percent, String(discountPercent ?? 0));
      localStorage.setItem(LS.d_fixed, String(discountFixed ?? 0));
    } catch {}
  }, [
    hydrated,
    paymentMethod,
    applyExtra,
    extraMode,
    extraPercent,
    extraFixed,
    applyDiscount,
    discountMode,
    discountPercent,
    discountFixed,
  ]);

  useEffect(() => {
    try {
      localStorage.setItem(LS_COLS, JSON.stringify(cols));
    } catch {}
  }, [cols]);

  // cerrar panel de columnas al clickear afuera
  useEffect(() => {
    function onDocClick(e) {
      if (!showColsPanel) return;
      const btn = colsBtnRef.current;
      const panel = colsPanelRef.current;
      if (btn && (btn === e.target || btn.contains(e.target))) return;
      if (panel && panel.contains(e.target)) return;
      setShowColsPanel(false);
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [showColsPanel]);

  // cerrar drawer con ESC
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") {
        setCartOpen(false);
        setShowColsPanel(false);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const stockField = location === "pv2" ? "stockPv2" : "stockPv1";

  // ============================================================
  //   LÓGICA DE FILTRADO AVANZADA (Directa + Indirecta)
  // ============================================================

  // Helper: Extraer códigos válidos y limpiar "fantasmas"
  const getValidEqCodes = (product) => {
    if (!Array.isArray(product.equivalences)) return [];
    return product.equivalences
      .map((e) => String(e.code || "").trim())
      .filter((c) => {
        // 1. Descartar muy cortos
        if (c.length <= 2) return false;

        // 2. FILTRO ESPECIFICO: Ocultar el código basura exacto
        if (c === "EQ-X8YULX12") return false;

        return true;
      });
  };

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();

    // Si no hay búsqueda, mostramos todo (filtrado solo por stock/estado)
    if (!t) {
      return productosCtx
        .filter((p) => {
          const hasStock = !onlyStock || parseInt(p[stockField] ?? 0, 10) > 0;
          return p.enabled !== false && hasStock;
        })
        .map((p) => ({
          ...p,
          _matchType: "direct",
          _validEqs: getValidEqCodes(p),
        }))
        .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    }

    // --- FASE 1: Búsqueda Directa ---
    // Productos que coinciden por Nombre, SKU o que TIENEN el código EQ buscado
    const directMatches = [];
    const directMatchIds = new Set();
    const relevantEqCodes = new Set(); // Guardaremos los códigos de los productos encontrados

    productosCtx.forEach((p) => {
      // 1. Validar estado y stock base
      const hasStock = !onlyStock || parseInt(p[stockField] ?? 0, 10) > 0;
      if (p.enabled === false || !hasStock) return;

      const validCodes = getValidEqCodes(p);

      // 2. Match por Texto (Nombre/SKU/Cat)
      const matchText =
        (p.name || "").toLowerCase().includes(t) ||
        (p.sku || "").toLowerCase().includes(t) ||
        (p.category || "").toLowerCase().includes(t);

      // 3. Match por Código EQ específico (si el usuario busca "EQ-123")
      const matchCode = validCodes.some((c) => c.toLowerCase().includes(t));

      if (matchText || matchCode) {
        directMatches.push(p);
        directMatchIds.add(p.id);
        // Guardamos los códigos de este producto para buscar a sus "hermanos"
        validCodes.forEach((c) => relevantEqCodes.add(c));
      }
    });

    // --- FASE 2: Búsqueda Indirecta (Equivalencias) ---
    // Buscamos productos que NO coincidieron por nombre, pero comparten código con los que sí
    let indirectMatches = [];

    if (showEq && relevantEqCodes.size > 0) {
      indirectMatches = productosCtx.filter((p) => {
        // 1. Validar estado/stock
        const hasStock = !onlyStock || parseInt(p[stockField] ?? 0, 10) > 0;
        if (p.enabled === false || !hasStock) return false;

        // 2. Si ya está en direct matches, ignorar
        if (directMatchIds.has(p.id)) return false;

        // 3. Chequear si tiene algún código en común con los encontrados en Fase 1
        const pCodes = getValidEqCodes(p);
        const isEquivalent = pCodes.some((c) => relevantEqCodes.has(c));

        return isEquivalent;
      });
    }

    // Unimos y agregamos flag visual para saber por qué aparece
    const resultDirect = directMatches.map((p) => ({
      ...p,
      _matchType: "direct",
      _validEqs: getValidEqCodes(p),
    }));
    const resultIndirect = indirectMatches.map((p) => ({
      ...p,
      _matchType: "indirect",
      _validEqs: getValidEqCodes(p),
    }));

    const combined = [...resultDirect, ...resultIndirect];

    // Ordenar: Directos primero, luego alfabético
    return combined.sort((a, b) => {
      if (a._matchType !== b._matchType) {
        return a._matchType === "direct" ? -1 : 1;
      }
      return (a.name || "").localeCompare(b.name || "");
    });
  }, [productosCtx, q, onlyStock, stockField, showEq]);

  // ===== Paginación =====
  const [pageSize, setPageSize] = useState(10);
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
    [filtered, startIndex, endIndex],
  );

  /* =========================
   * Totales + Recargo / Descuento
   * ========================= */
  const subtotal = useMemo(
    () =>
      Object.values(cart).reduce(
        (acc, it) => acc + it.qty * finalPrice(it.prod),
        0,
      ),
    [cart],
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

  const currentDiscValue =
    discountMode === "percent"
      ? Number(discountPercent) || 0
      : Number(discountFixed) || 0;

  const discountAmount = useMemo(() => {
    if (!applyDiscount) return 0;
    if (discountMode === "percent") {
      return (subtotal * Math.max(0, Number(discountPercent) || 0)) / 100;
    }
    return Math.max(0, Number(discountFixed) || 0);
  }, [applyDiscount, discountMode, discountPercent, discountFixed, subtotal]);

  const total = useMemo(() => {
    const t = subtotal + surchargeAmount - discountAmount;
    return Math.max(0, t);
  }, [subtotal, surchargeAmount, discountAmount]);

  /* =========================
   * Cambio de medio de pago
   * ========================= */
  const handleChangePaymentMethod = (e) => {
    const value = e.target.value;
    setPaymentMethod(value);

    if (value === "efectivo") {
      setApplyDiscount(true);
      if (!discountPercent && !discountFixed) {
        setDiscountMode("percent");
      }
      toast.info("Pago en efectivo: recordá aplicar un descuento.", {
        description:
          "Abajo configurás si el descuento es en % o en monto fijo y el valor.",
      });
    } else {
      setApplyDiscount(false);
    }
  };

  /* =========================
   * Cart ops
   * ========================= */
  function addToCart(prod) {
    const current = cart[prod.id]?.qty || 0;
    const available = parseInt(prod[stockField] ?? 0, 10);
    if (available <= current) return toast.error("Stock insuficiente");

    const nextQty = current + 1;
    setCart((c) => ({ ...c, [prod.id]: { prod, qty: nextQty } }));

    toast.success(`Agregado al carrito: ${prod.name} (x${nextQty})`, {
      description: `Unitario: ${money(finalPrice(prod))}`,
    });
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
    const ventaId = `v_${Date.now()}`;
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
          const toWrite = {};
          toWrite[ventaId] = ventaObj;
          tx.set(ref, toWrite, { merge: true });
        });
        return { ok: true, docId: targetId, ventaId };
      } catch (e) {
        if (String(e?.message).includes("FULL")) {
          targetId = pad3(parseInt(targetId, 10) + 1);
          attempts++;
          continue;
        }
        throw e;
      }
    }
    throw new Error("No se pudo guardar la venta en Firestore");
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
    if (nombre == null) return;
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
        discountAmount: Number(discountAmount),
        total: Number(total),
        currency: "ARS",
      },
      paymentLike: {
        surcharge: {
          applied: !!applyExtra,
          mode: extraMode,
          value:
            extraMode === "percent"
              ? Number(extraPercent) || 0
              : Number(extraFixed) || 0,
          amount: Number(surchargeAmount),
        },
        discount: {
          applied: !!applyDiscount,
          mode: discountMode,
          value:
            discountMode === "percent"
              ? Number(discountPercent) || 0
              : Number(discountFixed) || 0,
          amount: Number(discountAmount),
        },
      },
      status: "draft",
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
        </tr>`,
      )
      .join("");

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
  table{ width:100%; border-collapse:collapse; margin-top:8px; font-size:12px; table-layout: fixed;}
  th,td{ border-bottom:1px solid #ddd; padding:8px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
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
          <th style="width:120px">SKU</th>
          <th>Producto</th>
          <th class="right" style="width:70px">Cant.</th>
          <th class="right" style="width:110px">Unit.</th>
          <th class="right" style="width:120px">Subtotal</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    <table class="totals">
      <tr>
        <td class="right" style="width:80%;">Subtotal</td>
        <td class="right" style="width:20%;">${fmt(
          b?.totals?.subtotal || 0,
        )}</td>
      </tr>
      <tr>
        <td class="right">Recargo</td>
        <td class="right">${fmt(b?.totals?.surchargeAmount || 0)}</td>
      </tr>
      <tr>
        <td class="right">Descuento</td>
        <td class="right">-${fmt(b?.totals?.discountAmount || 0)}</td>
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
      const blob = new Blob([html], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      const w = window.open(url, "_blank", "noopener,noreferrer");
      if (w && typeof w.focus === "function") {
        setTimeout(() => URL.revokeObjectURL(url), 30_000);
        return;
      }
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
      const p = productosCtx.find((x) => x.id === l.productId) || {
        id: l.productId,
        name: l.name,
        sku: l.sku,
        category: l.category,
        [stockField]: 9999,
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
   * STOCK RAPIDO (admin/manager)
   * ========================= */
  async function addStockQuick(prod) {
    const deltaStr = prompt(
      `Sumar al stock (${location.toUpperCase()}) para "${
        prod.name
      }"\nIngrese cantidad (puede ser negativa para restar):`,
      "1",
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
        },
      );

      if (typeof ctx?.setProductos === "function") {
        ctx.setProductos((prev = []) =>
          prev.map((p) => {
            if (p.id !== prod.id) return p;
            const cur = parseInt(p[stockField] ?? 0, 10);
            return { ...p, [stockField]: Math.max(0, cur + delta) };
          }),
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

    const groups = {};
    for (const it of lines) {
      const cd = it.prod.chunkDoc;
      if (!groups[cd]) groups[cd] = [];
      groups[cd].push(it);
    }

    const isMercadoPago = paymentMethod === "mercadago";

    const updateStockByGroups = async (direction = -1) => {
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
            const next = current + Number(qty) * direction;

            if (next < 0) {
              throw new Error(`Stock insuficiente para ${prod.name}`);
            }

            updates[`${field}.${stockField}`] = next;
            updates[`${field}.updatedAt`] = serverTimestamp();
          }

          tx.update(ref, updates);
        });
      }
    };

    const syncStockInMemory = (direction = -1) => {
      if (typeof ctx?.setProductos !== "function") return;

      ctx.setProductos((prev = []) =>
        prev.map((p) => {
          const hit = lines.find((l) => l.prod.id === p.id);
          if (!hit) return p;

          const cur = parseInt(p[stockField] ?? 0, 10);
          const next = Math.max(0, cur + hit.qty * direction);
          return { ...p, [stockField]: next };
        }),
      );
    };

    const markVentaMpError = async (
      chunkDocId,
      ventaKey,
      message,
      { releaseReservation = false } = {},
    ) => {
      const ref = doc(firestore, "ventas", chunkDocId);
      const updates = {
        [`${ventaKey}.status`]: "payment_error",
        [`${ventaKey}.payment.status`]: "error",
        [`${ventaKey}.payment.errorMessage`]: String(message || "")
          .slice(0, 250),
        [`${ventaKey}.payment.updatedAt`]: serverTimestamp(),
      };

      if (releaseReservation) {
        updates[`${ventaKey}.stockReservationActive`] = false;
        updates[`${ventaKey}.stockReleasedAt`] = serverTimestamp();
      }

      await updateDoc(ref, updates);
    };

    const getMpRequestHeaders = async () => {
      if (!auth?.currentUser) {
        throw new Error("No hay sesión activa para operar con Mercado Pago");
      }
      const idToken = await auth.currentUser.getIdToken();
      return {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      };
    };

    const createMercadoPagoOrder = async ({ ventaKey, chunkDocId, total, lines }) => {
      const headers = await getMpRequestHeaders();
      const res = await fetch("/api/mp/create-order", {
        method: "POST",
        headers,
        body: JSON.stringify({ ventaKey, chunkDocId, total, lines }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          data?.error || "No se pudo cargar la venta en Mercado Pago",
        );
      }

      return data;
    };

    const run = async () => {
      const initialMonitor = isMercadoPago
        ? {
            ventaId: null,
            chunkDocId: null,
            open: true,
            total: Number(total),
            itemCount: lines.length,
            location,
            orderId: null,
            paymentId: null,
            paymentStatus: "preparing",
            status: "payment_preparing",
          }
        : null;

      if (initialMonitor) {
        flushSync(() => {
          setPaymentQueueOpen(false);
          setCartOpen(false);
          setPaymentMonitor(initialMonitor);
        });
      }

      // 1) Reservar/descontar stock por chunk
      await updateStockByGroups(-1);

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
          discountAmount: Number(discountAmount),
          total: Number(total),
          currency: "ARS",
        },
        payment: {
          method: paymentMethod,
          provider: isMercadoPago ? "mercadopago" : "manual",
          status: isMercadoPago ? "pending" : "approved",
          updatedAt: serverTimestamp(),
          surcharge: {
            applied: !!applyExtra,
            mode: extraMode,
            value:
              extraMode === "percent"
                ? Number(extraPercent) || 0
                : Number(extraFixed) || 0,
            amount: Number(surchargeAmount),
          },
          discount: {
            applied: !!applyDiscount,
            mode: discountMode,
            value:
              discountMode === "percent"
                ? Number(discountPercent) || 0
                : Number(discountFixed) || 0,
            amount: Number(discountAmount),
          },
        },
        status: isMercadoPago ? "payment_pending" : "paid",
        stockReservationActive: !!isMercadoPago,
        stockReservedAt: isMercadoPago ? serverTimestamp() : null,
      };

      let ventaSaved;
      try {
        ventaSaved = await appendVentaChunked(ventaPayload);
        if (initialMonitor) {
          setPaymentMonitor((prev) =>
            prev
              ? {
                  ...prev,
                  ventaId: ventaSaved.ventaId,
                  chunkDocId: ventaSaved.docId,
                }
              : prev,
          );
        }
      } catch (err) {
        if (initialMonitor) {
          setPaymentMonitor((prev) =>
            prev
              ? {
                  ...prev,
                  paymentStatus: "error",
                  status: "payment_error",
                }
              : prev,
          );
        }
        await updateStockByGroups(1);
        throw err;
      }

      let mpOrder = null;
      if (isMercadoPago) {
        try {
          mpOrder = await createMercadoPagoOrder({
            ventaKey: ventaSaved.ventaId,
            chunkDocId: ventaSaved.docId,
            total: ventaPayload.totals.total,
            lines: ventaPayload.lines,
          });
          setPaymentMonitor((prev) =>
            prev
              ? {
                  ...prev,
                  orderId: mpOrder?.orderId || null,
                  paymentId: mpOrder?.paymentId || null,
                  paymentStatus: "pending",
                  status: "payment_pending",
                }
              : prev,
          );
        } catch (err) {
          await updateStockByGroups(1);
          syncStockInMemory(1);
          await markVentaMpError(ventaSaved.docId, ventaSaved.ventaId, err?.message, {
            releaseReservation: true,
          });
          setPaymentMonitor((prev) =>
            prev
              ? {
                  ...prev,
                  paymentStatus: "error",
                  status: "payment_error",
                }
              : prev,
          );
          throw new Error(
            "La venta quedó guardada, pero no se pudo cargar el QR de Mercado Pago.",
          );
        }
      }

      // 3) Actualizar stock en memoria
      syncStockInMemory(-1);

      return {
        isMercadoPago,
        ventaId: ventaSaved.ventaId,
        chunkDocId: ventaSaved.docId,
        total: ventaPayload.totals.total,
        itemCount: ventaPayload.lines.length,
        location,
        orderId: mpOrder?.orderId || null,
        paymentId: mpOrder?.paymentId || null,
      };
    };

    try {
      const result = await toast.promise(run(), {
        loading: isMercadoPago
          ? "Cargando venta en el QR de Mercado Pago…"
          : "Procesando venta…",
        success: ({ isMercadoPago: mp }) =>
          mp
            ? "Venta lista. El cliente ya puede escanear el QR del local."
            : "Venta registrada y stock actualizado.",
        error: (e) => e?.message || "No se pudo completar la venta",
      });
      if (result?.isMercadoPago) {
        setPaymentMonitor((prev) =>
          prev
            ? {
                ...prev,
                ventaId: result.ventaId,
                chunkDocId: result.chunkDocId,
                total: result.total,
                itemCount: result.itemCount,
                location: result.location,
                orderId: result.orderId,
                paymentId: result.paymentId,
                paymentStatus: result.orderId ? "pending" : prev.paymentStatus,
                status: result.orderId ? "payment_pending" : prev.status,
              }
            : prev,
        );
        setCart({});
      } else {
        setCart({});
        setCartOpen(false);
      }
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

  // helper para colspan según columnas visibles
  const visibleCount =
    (cols.sku ? 1 : 0) +
    (cols.name ? 1 : 0) +
    (cols.category ? 1 : 0) +
    (cols.price ? 1 : 0) +
    (cols.stock ? 1 : 0) +
    (cols.action ? 1 : 0);

  // ====== Drag-to-scroll refs/handlers (tabla md+)
  const tableScrollRef = useRef(null);
  const isDownRef = useRef(false);
  const startXRef = useRef(0);
  const startScrollRef = useRef(0);

  const onMouseDown = (e) => {
    const el = tableScrollRef.current;
    if (!el) return;
    isDownRef.current = true;
    startXRef.current = e.clientX;
    startScrollRef.current = el.scrollLeft;
  };
  const onMouseMove = (e) => {
    const el = tableScrollRef.current;
    if (!el || !isDownRef.current) return;
    const dx = e.clientX - startXRef.current;
    el.scrollLeft = startScrollRef.current - dx;
    e.preventDefault();
  };
  const endDrag = () => {
    isDownRef.current = false;
  };

  const cartCount = Object.values(cart).length;
  const cartTotalStr = money(total);
  const trackedVenta = useMemo(() => {
    if (!paymentMonitor?.ventaId || !paymentMonitor?.chunkDocId) return null;
    return (
      ventasCtx.find(
        (venta) =>
          venta?.id === paymentMonitor.ventaId &&
          venta?.chunkDoc === paymentMonitor.chunkDocId,
      ) || null
    );
  }, [paymentMonitor, ventasCtx]);
  const trackedMonitorStatus = getVentaMonitorStatus(
    trackedVenta || paymentMonitor,
  );
  const shouldShowMonitorShortcut = ["preparing", "pending", "error"].includes(
    trackedMonitorStatus,
  );
  const mpVentasByLocation = useMemo(() => {
    return ventasCtx
      .filter((venta) => venta?.location === location)
      .filter(
        (venta) =>
          String(venta?.payment?.provider || "").toLowerCase() ===
          "mercadopago",
      )
      .filter((venta) => !String(venta?.status || "").toLowerCase().includes("void"))
      .sort((a, b) => {
        const aStatus = getVentaMonitorStatus(a);
        const bStatus = getVentaMonitorStatus(b);
        const aPending = aStatus === "pending" ? 0 : 1;
        const bPending = bStatus === "pending" ? 0 : 1;
        if (aPending !== bPending) return aPending - bPending;
        return getVentaUpdatedMs(b) - getVentaUpdatedMs(a);
      });
  }, [ventasCtx, location]);
  const mpVentasPending = useMemo(
    () =>
      mpVentasByLocation.filter(
        (venta) => getVentaMonitorStatus(venta) === "pending",
      ),
    [mpVentasByLocation],
  );
  const mpVentasRecent = useMemo(
    () =>
      mpVentasByLocation
        .filter((venta) => getVentaMonitorStatus(venta) !== "pending")
        .slice(0, 6),
    [mpVentasByLocation],
  );
  const hasPaymentQueue = mpVentasByLocation.length > 0;
  const activeMonitorVenta = trackedVenta || paymentMonitor || null;

  async function cancelMercadoPagoVenta(targetVenta) {
    const venta = targetVenta || activeMonitorVenta;
    const ventaKey = venta?.id || paymentMonitor?.ventaId || "";
    const chunkDocId = venta?.chunkDoc || paymentMonitor?.chunkDocId || "";
    const monitorKey = `${chunkDocId}_${ventaKey}`;
    const orderId =
      getLatestPaymentEntry(venta)?.orderId ||
      venta?.payment?.orderId ||
      paymentMonitor?.orderId ||
      null;

    if (!orderId) {
      toast.error("La venta todavia no tiene una order valida para cancelar.");
      return;
    }

    setCancelingMonitorKey(monitorKey);
    try {
      const headers = await getMpRequestHeaders();
      const res = await fetch("/api/mp/cancel-order", {
        method: "POST",
        headers,
        body: JSON.stringify({ orderId }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(
          data?.error || "No se pudo cancelar la venta en Mercado Pago",
        );
      }

      toast.success(
        data?.status === "canceled"
          ? "Venta cancelada y reserva liberada."
          : "La venta ya fue actualizada con su ultimo estado.",
      );
    } catch (err) {
      toast.error(err?.message || "No se pudo cancelar la venta");
    } finally {
      setCancelingMonitorKey("");
    }
  }

  async function reconcileMercadoPagoVenta(targetVenta) {
    const venta = targetVenta || activeMonitorVenta;
    const ventaKey = venta?.id || paymentMonitor?.ventaId || "";
    const chunkDocId = venta?.chunkDoc || paymentMonitor?.chunkDocId || "";
    const monitorKey = `${chunkDocId}_${ventaKey}`;
    const orderId =
      getLatestPaymentEntry(venta)?.orderId ||
      venta?.payment?.orderId ||
      paymentMonitor?.orderId ||
      null;

    if (!orderId) {
      toast.error("La venta todavia no tiene una order valida para consultar.");
      return;
    }

    setReconcilingMonitorKey(monitorKey);
    try {
      const headers = await getMpRequestHeaders();
      const res = await fetch("/api/mp/reconcile-order", {
        method: "POST",
        headers,
        body: JSON.stringify({ orderId }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(
          data?.error || "No se pudo consultar el estado en Mercado Pago",
        );
      }

      const normalizedStatus = String(data?.status || "").toLowerCase();
      if (normalizedStatus === "approved") {
        toast.success("Pago confirmado y venta actualizada.");
      } else if (normalizedStatus === "pending") {
        toast.message("El pago sigue pendiente en Mercado Pago.");
      } else if (normalizedStatus === "canceled" || normalizedStatus === "expired") {
        toast.message("La venta fue actualizada con el ultimo estado de Mercado Pago.");
      } else {
        toast.success("Estado del pago reconsultado correctamente.");
      }
    } catch (err) {
      toast.error(err?.message || "No se pudo consultar el pago");
    } finally {
      setReconcilingMonitorKey("");
    }
  }

  function openPaymentMonitor(venta) {
    setPaymentMonitor({
      ventaId: venta?.id,
      chunkDocId: venta?.chunkDoc,
      open: true,
      total: venta?.totals?.total || 0,
      itemCount: Array.isArray(venta?.lines) ? venta.lines.length : 0,
      location: venta?.location || location,
      orderId:
        getLatestPaymentEntry(venta)?.orderId || venta?.payment?.orderId || null,
      paymentId: getLatestPaymentEntry(venta)?.paymentId || null,
    });
    setPaymentQueueOpen(false);
  }

  const floatingRailClass =
    "fixed left-3 right-3 md:left-auto md:right-4 md:w-[280px] z-40";

  // Responsive polish: FAB full-width en mobile + safe-area
  const fabClass =
    "fixed z-40 shadow-lg bg-gradient-to-r from-[#EE7203] to-[#FF3816] font-medium " +
    "rounded-2xl text-sm " +
    "left-3 right-3 bottom-[calc(env(safe-area-inset-bottom,0px)+12px)] md:left-auto md:right-4 md:bottom-4 md:w-auto " +
    "px-4 py-3 flex items-center justify-center gap-2";

  return (
    <div className="relative pb-24">
      {false && (mpVentasPending.length > 0 || mpVentasRecent.length > 0) && (
        <section className="mb-3 rounded-2xl border border-slate-700 bg-[#0E2330] p-3 sm:p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="text-[11px] uppercase tracking-[0.2em] text-white/45">
                Mercado Pago
              </div>
              <h3 className="mt-1 text-base font-semibold">Cobros en curso</h3>
              <p className="mt-1 text-sm text-white/60">
                Seguimiento en tiempo real de ventas cargadas al QR de esta sede.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <MiniStat
                label="Pendientes"
                value={String(mpVentasPending.length)}
                tone="sky"
              />
              <MiniStat
                label="Recientes"
                value={String(mpVentasRecent.length)}
                tone="white"
              />
            </div>
          </div>

          <div className="mt-4 grid gap-3 xl:grid-cols-[1.2fr_0.8fr]">
            <div className="rounded-2xl border border-white/10 bg-[#0C212D] p-3">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="font-medium">Pendientes</div>
                <div className="text-xs text-white/45">
                  {mpVentasPending.length > 0
                    ? "Se actualiza solo con el webhook"
                    : "Sin cobros pendientes"}
                </div>
              </div>
              {mpVentasPending.length === 0 ? (
                <div className="rounded-xl border border-dashed border-white/10 px-3 py-4 text-sm text-white/50">
                  No hay ventas de Mercado Pago esperando pago en este momento.
                </div>
              ) : (
                <div className="space-y-2">
                  {mpVentasPending.slice(0, 6).map((venta) => (
                    <PaymentQueueRow
                      key={`${venta.chunkDoc}_${venta.id}`}
                      venta={venta}
                      onOpen={() => openPaymentMonitor(venta)}
                    />
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-white/10 bg-[#0C212D] p-3">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="font-medium">Últimas resueltas</div>
                <div className="text-xs text-white/45">Aprobadas o cerradas</div>
              </div>
              {mpVentasRecent.length === 0 ? (
                <div className="rounded-xl border border-dashed border-white/10 px-3 py-4 text-sm text-white/50">
                  Todavía no hay cobros de Mercado Pago resueltos en esta sede.
                </div>
              ) : (
                <div className="space-y-2">
                  {mpVentasRecent.map((venta) => (
                    <PaymentQueueRow
                      key={`${venta.chunkDoc}_${venta.id}`}
                      venta={venta}
                      compact
                      onOpen={() => openPaymentMonitor(venta)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Controles + Tabla */}
      <div className="mb-3 w-full rounded-2xl border border-slate-700 bg-[#0E2330] p-2 sm:p-3">
        <div className="mb-3 flex items-start justify-between gap-3 border-b border-white/10 px-1 pb-3">
          <div>
            <h3 className="text-sm font-semibold text-white">Venta rápida</h3>
            <p className="mt-1 text-xs text-white/55">
              Buscá productos, armá el carrito y registrá el cobro de esta sede.
            </p>
          </div>
          <HelpHint
            title="Ventas"
            description="Esta vista se usa para operar el punto de venta de la sede actual."
            sections={[
              {
                label: "Qué es",
                value:
                  "Es la pantalla interna para buscar productos y concretar ventas.",
              },
              {
                label: "Qué hace",
                value:
                  "Permite filtrar productos, usar equivalencias, cargar cantidades y cobrar con el método elegido.",
              },
              {
                label: "Quién lo ve",
                value:
                  "La ven usuarios con permiso en la sede actual y el admin general.",
              },
              {
                label: "Uso interno",
                value:
                  "Sí. El cliente participa solo durante la operación de compra.",
              },
            ]}
          />
        </div>
        <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 w-full">
          {/* Input de búsqueda + botón limpiar debajo */}
          <div className="w-full sm:flex-1 flex flex-col gap-1 min-w-0">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar por Nombre / SKU / Categoría / Código equivalencia…"
              className="w-full rounded-xl bg-[#0C212D] border border-white/10 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#EE7203]/70"
            />
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setQ("")}
                disabled={!q.trim()}
                className={`inline-flex items-center justify-center rounded-lg border px-2 py-1 text-xs transition ${
                  q.trim()
                    ? "border-white/20 bg-white/5 text-white/80 hover:bg-white/10"
                    : "border-white/5 bg-transparent text-white/30 cursor-not-allowed"
                }`}
              >
                Limpiar
              </button>

              {/* hint de equivalencias */}
              {q.trim() && (
                <span className="text-[11px] text-white/50 truncate">
                  Busca también por equivalencia (EQ-...)
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-2 text-sm text-white/80 select-none">
              <input
                type="checkbox"
                checked={onlyStock}
                onChange={(e) => setOnlyStock(e.target.checked)}
                className="accent-[#EE7203]"
              />
              Solo stock
            </label>

            <label className="inline-flex items-center gap-2 text-sm text-white/80 select-none">
              <input
                type="checkbox"
                checked={showEq}
                onChange={(e) => setShowEq(e.target.checked)}
                className="accent-[#EE7203]"
              />
              Mostrar equivalencias
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

            {/* Selector de columnas */}
            <div className="relative">
              <button
                ref={colsBtnRef}
                onClick={() => setShowColsPanel((v) => !v)}
                className="px-3 py-2 rounded-lg text-sm bg-white/10 hover:bg-white/15"
                title="Configurar columnas"
              >
                Columnas
              </button>
              {showColsPanel && (
                <div
                  ref={colsPanelRef}
                  className="absolute right-0 mt-2 w-64 max-w-[85vw] rounded-xl border border-white/10 bg-[#0C212D] shadow-xl p-3 z-20"
                >
                  <p className="text-xs text-white/60 mb-2">
                    Mostrar/ocultar columnas
                  </p>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    {[
                      ["sku", "SKU"],
                      ["name", "Nombre"],
                      ["category", "Cat."],
                      ["price", "Precio"],
                      ["stock", "Stock"],
                      ["action", "Acción"],
                    ].map(([key, label]) => (
                      <label
                        key={key}
                        className="inline-flex items-center gap-2 text-white/90"
                      >
                        <input
                          type="checkbox"
                          className="accent-[#EE7203]"
                          checked={!!cols[key]}
                          onChange={(e) =>
                            setCols((c) => ({ ...c, [key]: e.target.checked }))
                          }
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                  <div className="flex items-center justify-end gap-2 mt-3">
                    <button
                      onClick={() => setCols(DEFAULT_COLS)}
                      className="px-2 py-1 text-xs rounded-md bg-white/10 hover:bg-white/15"
                    >
                      Reset
                    </button>
                    <button
                      onClick={() => setShowColsPanel(false)}
                      className="px-3 py-1.5 text-xs rounded-md bg-gradient-to-r from-[#EE7203] to-[#FF3816]"
                    >
                      OK
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Tabla md+ */}
      <div
        ref={tableScrollRef}
        className="hidden md:block overflow-x-auto rounded-2xl border border-slate-700 bg-[#0E2330] select-none cursor-grab active:cursor-grabbing"
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseLeave={endDrag}
        onMouseUp={endDrag}
        style={{ WebkitOverflowScrolling: "touch" }}
        title="Arrastrá para desplazarte horizontalmente"
      >
        <table className="w-full text-sm table-fixed">
          <thead className="bg-[#0A1B25] text-white/70">
            <tr>
              {cols.sku && <Th className="w-32">SKU</Th>}
              {cols.name && <Th>Nombre</Th>}
              {cols.category && <Th className="w-40">Cat.</Th>}
              {cols.price && <Th className="w-36 text-right">Precio</Th>}
              {cols.stock && (
                <Th className="w-44 text-right">
                  Stock {location.toUpperCase()}
                </Th>
              )}
              {cols.action && <Th className="w-40 text-right">Acción</Th>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={visibleCount}
                  className="p-6 text-center text-white/60"
                >
                  Cargando…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={visibleCount}
                  className="p-6 text-center text-white/60"
                >
                  Sin resultados
                </td>
              </tr>
            ) : (
              pageItems.map((p) => {
                const stock = parseInt(p[stockField] ?? 0, 10);
                const isIndirect = p._matchType === "indirect";
                const validEqs = p._validEqs || [];

                return (
                  <tr
                    key={`${p.chunkDoc}_${p.id}`}
                    className={`border-t border-white/5 hover:bg-white/[0.03] transition ${isIndirect ? "bg-[#EE7203]/5" : ""}`}
                  >
                    {cols.sku && (
                      <Td title={p.sku || "-"} className="whitespace-nowrap">
                        <span className="block truncate">{p.sku || "-"}</span>
                      </Td>
                    )}

                    {cols.name && (
                      <Td title={p.name || "-"} className="overflow-hidden">
                        <div className="min-w-0">
                          <span className="block truncate max-w-[32rem]">
                            {p.name}
                          </span>

                          {/* Renderizado de códigos de equivalencia filtrados */}
                          {validEqs.length > 0 && (
                            <div className="mt-1 flex flex-wrap items-center gap-1">
                              <span className="text-[10px] uppercase font-bold text-[#EE7203] bg-[#EE7203]/10 border border-[#EE7203]/20 px-1.5 py-0.5 rounded">
                                Eq:
                              </span>
                              {validEqs.slice(0, 5).map((m, i) => (
                                <span
                                  key={i}
                                  className={`text-[11px] font-mono px-1.5 py-0.5 rounded border ${
                                    isIndirect // Si es indirecto, resaltamos las EQs porque son la razón de aparición
                                      ? "bg-[#EE7203]/20 text-[#EE7203] border-[#EE7203]/30"
                                      : "bg-white/5 text-white/90 border-white/10"
                                  }`}
                                >
                                  {m}
                                </span>
                              ))}
                              {validEqs.length > 5 && (
                                <span className="text-[10px] text-white/50">
                                  ...
                                </span>
                              )}
                            </div>
                          )}
                          {isIndirect && (
                            <div className="text-[10px] text-[#EE7203] mt-0.5 font-medium">
                              ↳ Relacionado por equivalencia
                            </div>
                          )}
                        </div>
                      </Td>
                    )}

                    {cols.category && (
                      <Td
                        title={p.category || "-"}
                        className="whitespace-nowrap"
                      >
                        <span className="block truncate">
                          {p.category || "-"}
                        </span>
                      </Td>
                    )}

                    {cols.price && (
                      <Td className="text-right whitespace-nowrap">
                        {money(finalPrice(p))}
                      </Td>
                    )}

                    {cols.stock && (
                      <Td className="text-right">
                        <div className="inline-flex items-center gap-2 justify-end w-full">
                          <span className="whitespace-nowrap">{stock}</span>
                          {canEditStock && (
                            <button
                              onClick={() => addStockQuick(p)}
                              className="px-2 py-0.5 rounded-md bg-white/10 hover:bg-white/15 text-xs"
                              title={`Ajustar stock: ${p.name || ""}`}
                            >
                              +
                            </button>
                          )}
                        </div>
                      </Td>
                    )}

                    {cols.action && (
                      <Td className="text-right">
                        <div className="inline-flex items-center justify-end gap-2 w-full">
                          <button
                            onClick={() => addToCart(p)}
                            disabled={stock <= 0}
                            className={`px-3 py-1.5 rounded-lg text-xs transition ${
                              stock > 0
                                ? "bg-gradient-to-r from-[#EE7203] to-[#FF3816] hover:opacity-95"
                                : "bg-white/10 text-white/50 cursor-not-allowed"
                            }`}
                            title={`Agregar: ${p.name || ""}`}
                          >
                            Agregar
                          </button>
                        </div>
                      </Td>
                    )}
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
            const isIndirect = p._matchType === "indirect";
            const validEqs = p._validEqs || [];

            return (
              <div
                key={`${p.chunkDoc}_${p.id}`}
                className={`rounded-2xl border border-slate-700 p-3 w-full ${isIndirect ? "bg-[#EE7203]/10" : "bg-[#132836]"}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div
                      className="text-sm font-semibold truncate"
                      title={p.name}
                    >
                      {p.name}
                    </div>

                    <div
                      className="text-xs text-white/60 mt-0.5 truncate"
                      title={`SKU ${p.sku || "-"} • ${p.category || "-"}`}
                    >
                      SKU {p.sku || "-"} • {p.category || "-"}
                    </div>

                    {validEqs.length > 0 && (
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        <span className="text-[10px] uppercase font-bold text-[#EE7203] bg-[#EE7203]/10 border border-[#EE7203]/20 px-1.5 py-0.5 rounded">
                          Eq:
                        </span>
                        {validEqs.slice(0, 3).map((m, i) => (
                          <span
                            key={i}
                            className={`text-[11px] font-mono px-1.5 py-0.5 rounded border ${
                              isIndirect
                                ? "bg-[#EE7203]/20 text-[#EE7203] border-[#EE7203]/30"
                                : "bg-white/5 text-white/90 border-white/10"
                            }`}
                          >
                            {m}
                          </span>
                        ))}
                        {validEqs.length > 3 && (
                          <span className="text-[10px] text-white/50">...</span>
                        )}
                      </div>
                    )}
                    {isIndirect && (
                      <div className="text-[10px] text-[#EE7203] mt-1">
                        ↳ Producto equivalente
                      </div>
                    )}

                    <div className="text-xs text-white/70 mt-1">
                      {money(finalPrice(p))} • Stock {stock}
                    </div>
                  </div>

                  <div className="flex flex-col gap-1 items-end shrink-0">
                    <button
                      onClick={() => addToCart(p)}
                      disabled={stock <= 0}
                      className={`px-3 py-1.5 rounded-lg text-xs transition ${
                        stock > 0
                          ? "bg-gradient-to-r from-[#EE7203] to-[#FF3816] hover:opacity-95"
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
                        +
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

      {/* ===== Floating Cart Button (FAB) ===== */}
      <button
        onClick={() => setCartOpen(true)}
        className={fabClass}
        title="Abrir carrito"
      >
        <span className="truncate">
          Carrito · {cartCount} · {cartTotalStr}
        </span>
      </button>

      {/* ===== Drawer Carrito ===== */}
      {cartOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/60 z-40"
            onClick={() => setCartOpen(false)}
          />
          {/* Panel */}
          <aside
            className="fixed top-0 right-0 h-full w-full sm:w-[420px] z-50 bg-[#0C212D] border-l border-white/10 shadow-2xl flex flex-col"
            role="dialog"
            aria-modal="true"
          >
            <div className="p-4 border-b border-white/10 flex items-center justify-between">
              <div className="font-semibold">
                Carrito <span className="text-white/60">({cartCount})</span>
              </div>
              <button
                onClick={() => setCartOpen(false)}
                className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15"
                aria-label="Cerrar"
              >
                ✕
              </button>
            </div>

            <div className="p-4 overflow-y-auto flex-1 space-y-4">
              {/* Pago / Recargo / Descuento */}
              <div className="rounded-2xl border border-slate-700 p-3 bg-[#0E2330]">
                <p className="text-xs text-white/70 mb-1.5">Medio de pago</p>
                <select
                  value={paymentMethod}
                  onChange={handleChangePaymentMethod}
                  className="w-full inp mb-2"
                >
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-white/55">
                  • Usá <span className="font-semibold">Transferencia/QR</span>{" "}
                  cuando el pago entra directo a la cuenta. <br />•{" "}
                  <span className="font-semibold">MercadoPago</span> suele tener
                  recargo (comisión). <br />•{" "}
                  <span className="font-semibold">Efectivo</span> normalmente
                  tiene algún descuento, que configurás abajo.
                </p>

                {paymentMethod === "efectivo" && (
                  <div className="mt-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-2">
                    <p className="text-[11px] text-emerald-50">
                      Estás cobrando en <strong>efectivo</strong>. Por costumbre
                      y para incentivar el pago en mano, suele aplicarse un{" "}
                      <strong>descuento</strong>. Abajo elegís si el descuento
                      es en <strong>%</strong> o en <strong>$</strong> y el
                      monto.
                    </p>
                  </div>
                )}

                {/* Recargo */}
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
                  <p className="text-[11px] text-white/55">
                    Usá el recargo para cubrir comisiones (ej: MercadoPago) o
                    financiación con tarjeta.
                  </p>

                  <div
                    className={`grid grid-cols-1 sm:grid-cols-2 gap-2 ${
                      applyExtra ? "" : "opacity-60 pointer-events-none"
                    }`}
                  >
                    <select
                      value={extraMode}
                      onChange={(e) => setExtraMode(e.target.value)}
                      className="inp"
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
                      className="inp"
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

                {/* Descuento */}
                <div className="mt-4 space-y-2">
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="accent-[#EE7203]"
                      checked={applyDiscount}
                      onChange={(e) => setApplyDiscount(e.target.checked)}
                    />
                    Aplicar descuento
                  </label>
                  <p className="text-[11px] text-white/55">
                    El descuento se usa, por ejemplo, para pagos en efectivo o
                    beneficios especiales de cliente.
                  </p>

                  <div
                    className={`grid grid-cols-1 sm:grid-cols-2 gap-2 ${
                      applyDiscount ? "" : "opacity-60 pointer-events-none"
                    }`}
                  >
                    <select
                      value={discountMode}
                      onChange={(e) => setDiscountMode(e.target.value)}
                      className="inp"
                    >
                      <option value="percent">% Porcentaje</option>
                      <option value="fixed">$ Monto fijo</option>
                    </select>

                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={currentDiscValue}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (discountMode === "percent") setDiscountPercent(v);
                        else setDiscountFixed(v);
                      }}
                      placeholder={
                        discountMode === "percent" ? "% ej: 10" : "$ ej: 500"
                      }
                      className="inp"
                    />
                  </div>
                  {applyDiscount && (
                    <p className="text-xs text-white/60">
                      Descuento{" "}
                      {discountMode === "percent"
                        ? `${Number(discountPercent || 0)}%`
                        : money(Number(discountFixed || 0))}
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
                        <p className="truncate" title={prod.name}>
                          {prod.name}
                        </p>
                        <p
                          className="text-xs text-white/60 truncate"
                          title={prod.sku}
                        >
                          {prod.sku}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <input
                          type="number"
                          value={qty}
                          min={1}
                          className="w-16 inp"
                          onChange={(e) => setQty(prod.id, e.target.value)}
                        />
                        <button
                          className="px-2 py-1 rounded-lg bg-white/10 hover:bg-white/15"
                          onClick={() => removeFromCart(prod.id)}
                          title="Quitar del carrito"
                        >
                          x
                        </button>
                      </div>

                      <div className="text-right w-24 whitespace-nowrap shrink-0">
                        {money(finalPrice(prod) * qty)}
                      </div>
                    </div>
                  ))}

                  <div className="border-t border-white/10 pt-3 mt-3 space-y-1">
                    <Row label="Subtotal" value={money(subtotal)} />
                    <Row label="Recargo" value={money(surchargeAmount)} />
                    <Row
                      label="Descuento"
                      value={`-${money(discountAmount)}`}
                    />
                    <div className="flex items-center justify-between pt-1">
                      <span className="text-sm text-white/70">Total</span>
                      <span className="font-semibold">{money(total)}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Presupuestos */}
              <div className="pt-2 border-t border-white/10">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <h4 className="font-semibold text-sm">Presupuestos</h4>
                  <button
                    onClick={() =>
                      typeof fetchPresupuestos === "function" &&
                      fetchPresupuestos()
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
                    <div className="p-3 text-white/60 text-sm">
                      Sin resultados
                    </div>
                  ) : (
                    budgetsFiltered.slice(0, 25).map((b) => (
                      <div
                        key={`${b.chunkDoc}_${b.id}`}
                        className="px-3 py-2 text-sm border-b border-white/5"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div
                              className="font-medium truncate"
                              title={b.name || "(sin nombre)"}
                            >
                              {b.name || "(sin nombre)"}
                            </div>
                            <div
                              className="text-xs text-white/60 truncate"
                              title={`${b.createdByEmail || "—"} • ${String(
                                b.location || "",
                              ).toUpperCase()} • ${money(b?.totals?.total || 0)}`}
                            >
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

            <div className="p-4 border-t border-white/10">
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
          </aside>
        </>
      )}

      {hasPaymentQueue && (
        <button
          type="button"
          onClick={() => setPaymentQueueOpen(true)}
          className={`${floatingRailClass} bottom-[calc(env(safe-area-inset-bottom,0px)+72px)] rounded-2xl border border-sky-400/20 bg-[#112C3E]/95 px-3.5 py-2.5 text-left shadow-[0_14px_28px_rgba(0,0,0,0.28)] ring-1 ring-black/10 transition hover:-translate-y-0.5 hover:bg-[#17374D]`}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-[0.18em] text-white/45">
                Mercado Pago
              </div>
              <div className="mt-0.5 text-sm font-semibold">Cobros</div>
            </div>
            <span className="rounded-full border border-sky-400/30 bg-sky-500/15 px-2 py-0.5 text-[11px] font-medium text-sky-100">
              {mpVentasPending.length} pendientes
            </span>
          </div>
          <div className="mt-2 text-[11px] text-white/55">
            Ver pendientes y reconsultar pagos
          </div>
        </button>
      )}

      {paymentMonitor && !paymentMonitor.open && shouldShowMonitorShortcut && (
        <button
          type="button"
          onClick={() =>
            setPaymentMonitor((prev) => (prev ? { ...prev, open: true } : prev))
          }
          className={`${floatingRailClass} bottom-[calc(env(safe-area-inset-bottom,0px)+126px)] rounded-2xl border border-white/10 bg-[#112C3E]/95 px-3.5 py-2.5 text-left shadow-[0_14px_28px_rgba(0,0,0,0.28)] ring-1 ring-black/10 transition hover:-translate-y-0.5 hover:bg-[#17374D]`}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-[0.18em] text-white/45">
                Cobro actual
              </div>
              <div className="mt-0.5 text-sm font-semibold">Seguimiento</div>
            </div>
            <StatusPill status={trackedMonitorStatus} />
          </div>
          <div className="mt-2 text-[11px] text-white/55">
            {trackedMonitorStatus === "pending"
              ? "Abrí para ver si ya pagó"
              : "Abrí para revisar el resultado"}
          </div>
        </button>
      )}

      {paymentQueueOpen && (
        <PaymentQueueModal
          pending={mpVentasPending}
          recent={mpVentasRecent}
          onClose={() => setPaymentQueueOpen(false)}
          onOpenVenta={openPaymentMonitor}
          onCancelVenta={cancelMercadoPagoVenta}
          onReconcileVenta={reconcileMercadoPagoVenta}
          cancelingMonitorKey={cancelingMonitorKey}
          reconcilingMonitorKey={reconcilingMonitorKey}
        />
      )}

      {paymentMonitor?.open && (
        <PaymentMonitorModal
          venta={trackedVenta}
          fallback={paymentMonitor}
          onCancel={() => cancelMercadoPagoVenta(activeMonitorVenta)}
          onReconcile={() => reconcileMercadoPagoVenta(activeMonitorVenta)}
          canceling={
            cancelingMonitorKey ===
            `${paymentMonitor?.chunkDocId || ""}_${paymentMonitor?.ventaId || ""}`
          }
          reconciling={
            reconcilingMonitorKey ===
            `${paymentMonitor?.chunkDocId || ""}_${paymentMonitor?.ventaId || ""}`
          }
          onClose={() =>
            setPaymentMonitor((prev) => (prev ? { ...prev, open: false } : prev))
          }
        />
      )}

      <style jsx global>{`
        .inp {
          background: #0c212d;
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 0.5rem;
          padding: 0.4rem 0.6rem;
          outline: none;
          color: white;
          width: 100%;
          font-size: 0.875rem;
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
function Td({ children, className = "", title }) {
  return (
    <td
      title={title}
      className={`px-3 py-2 ${className}`}
      style={{ overflow: "hidden", textOverflow: "ellipsis" }}
    >
      {children}
    </td>
  );
}
function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-white/70">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  );
}

function MiniStat({ label, value, tone = "white" }) {
  const toneClass =
    tone === "sky"
      ? "border-sky-400/20 bg-sky-500/10 text-sky-100"
      : "border-white/10 bg-white/5 text-white";
  return (
    <div className={`rounded-xl border px-3 py-2 ${toneClass}`}>
      <div className="text-[10px] uppercase tracking-[0.16em] text-white/45">
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}

function PaymentQueueRow({
  venta,
  onOpen,
  onCancel,
  onReconcile,
  canceling = false,
  reconciling = false,
  compact = false,
}) {
  const status = getVentaMonitorStatus(venta);
  const payment = getLatestPaymentEntry(venta);
  const total = Number(venta?.totals?.total ?? 0);
  const updatedLabel = timestampLabel(
    payment?.updatedAt || venta?.paidAt || venta?.createdAt,
  );
  const canReconcile = !!(payment?.orderId || venta?.payment?.orderId);

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={status} />
            <span className="text-sm text-white/45">{venta?.id || "—"}</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <span className="font-medium">{money(total)}</span>
            <span className="text-white/60">
              {Array.isArray(venta?.lines) ? venta.lines.length : 0} ítems
            </span>
            <span className="text-white/50">{updatedLabel}</span>
          </div>
          {!compact && (
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-white/50">
              <span>Order: {payment?.orderId || venta?.payment?.orderId || "—"}</span>
              <span>Payment: {payment?.paymentId || "—"}</span>
              <span className="truncate">
                {payment?.statusDetail || venta?.payment?.statusDetail || "Sin detalle"}
              </span>
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {canReconcile && typeof onReconcile === "function" && (
            <button
              type="button"
              onClick={onReconcile}
              disabled={reconciling}
              className={`rounded-xl px-3 py-2 text-sm ${
                reconciling
                  ? "cursor-wait bg-sky-500/10 text-sky-100"
                  : "bg-sky-500/15 text-sky-100 hover:bg-sky-500/25"
              }`}
            >
              {reconciling ? "Consultando..." : "Reconsultar"}
            </button>
          )}
          {status === "pending" && typeof onCancel === "function" && (
            <button
              type="button"
              onClick={onCancel}
              disabled={canceling}
              className={`rounded-xl px-3 py-2 text-sm ${
                canceling
                  ? "cursor-wait bg-red-500/10 text-red-100"
                  : "bg-red-500/15 text-red-100 hover:bg-red-500/25"
              }`}
            >
              {canceling ? "Cancelando..." : "Cancelar"}
            </button>
          )}
          <button
            type="button"
            onClick={onOpen}
            className="rounded-xl bg-white/10 px-3 py-2 text-sm hover:bg-white/15"
          >
            Ver seguimiento
          </button>
        </div>
      </div>
    </div>
  );
}

function PaymentQueueModal({
  pending,
  recent,
  onClose,
  onOpenVenta,
  onCancelVenta,
  onReconcileVenta,
  cancelingMonitorKey = "",
  reconcilingMonitorKey = "",
}) {
  const { modalRef, handleBackdropMouseDown } = useDismissibleModal(
    true,
    onClose,
  );

  return (
    <div
      className="fixed inset-0 z-[58] flex items-center justify-center p-3 sm:p-4"
      onMouseDown={handleBackdropMouseDown}
    >
      <div className="absolute inset-0 bg-black/70" />
      <div
        ref={modalRef}
        className="relative z-10 flex max-h-[min(92vh,860px)] w-full max-w-4xl flex-col overflow-hidden rounded-[28px] border border-white/10 bg-[#112C3E] shadow-[0_28px_70px_rgba(0,0,0,0.45)]"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-white/10 p-4 sm:p-6">
          <div>
            <p className="text-[11px] uppercase tracking-[0.2em] text-white/45">
              Mercado Pago
            </p>
            <h3 className="mt-1 text-xl font-semibold">Cobros en curso</h3>
            <p className="mt-1 text-sm text-white/60">
              Revisá qué cobros siguen esperando pago y cuáles ya se resolvieron.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-white/10 px-3 py-1.5 text-sm hover:bg-white/15"
          >
            Cerrar
          </button>
        </div>

        <div className="overflow-y-auto p-4 sm:p-6">
          <div className="grid gap-4 sm:grid-cols-[1.15fr_0.85fr]">
          <div className="rounded-2xl border border-white/10 bg-[#0C212D] p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="font-medium">Pendientes</div>
                <div className="text-xs text-white/45">
                  Esperando confirmacion del cliente
                </div>
              </div>
              <MiniStat label="Pendientes" value={String(pending.length)} tone="sky" />
            </div>

            {pending.length === 0 ? (
              <div className="rounded-xl border border-dashed border-white/10 px-3 py-4 text-sm text-white/50">
                No hay ventas pendientes en este momento.
              </div>
            ) : (
              <div className="space-y-2">
                {pending.slice(0, 8).map((venta) => (
                  <PaymentQueueRow
                    key={`${venta.chunkDoc}_${venta.id}`}
                    venta={venta}
                    onCancel={() => onCancelVenta?.(venta)}
                    onReconcile={() => onReconcileVenta?.(venta)}
                    canceling={
                      cancelingMonitorKey === `${venta.chunkDoc || ""}_${venta.id || ""}`
                    }
                    reconciling={
                      reconcilingMonitorKey === `${venta.chunkDoc || ""}_${venta.id || ""}`
                    }
                    onOpen={() => onOpenVenta(venta)}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-white/10 bg-[#0C212D] p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="font-medium">Ultimas resueltas</div>
                <div className="text-xs text-white/45">
                  Aprobadas o cerradas recientemente
                </div>
              </div>
              <MiniStat label="Recientes" value={String(recent.length)} />
            </div>

            {recent.length === 0 ? (
              <div className="rounded-xl border border-dashed border-white/10 px-3 py-4 text-sm text-white/50">
                Todavia no hay cobros resueltos para mostrar.
              </div>
            ) : (
              <div className="space-y-2">
                {recent.map((venta) => (
                  <PaymentQueueRow
                    key={`${venta.chunkDoc}_${venta.id}`}
                    venta={venta}
                    compact
                    onReconcile={() => onReconcileVenta?.(venta)}
                    reconciling={
                      reconcilingMonitorKey === `${venta.chunkDoc || ""}_${venta.id || ""}`
                    }
                    onOpen={() => onOpenVenta(venta)}
                  />
                ))}
              </div>
            )}
          </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusPill({ status }) {
  const meta = getPaymentMonitorMeta(status);
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium ${meta.pillClass}`}
    >
      {meta.shortLabel}
    </span>
  );
}

function PaymentMonitorModal({
  venta,
  fallback,
  onCancel,
  onReconcile,
  canceling = false,
  reconciling = false,
  onClose,
}) {
  const { modalRef, handleBackdropMouseDown } = useDismissibleModal(
    true,
    onClose,
  );
  const status = getVentaMonitorStatus(venta || fallback);
  const meta = getPaymentMonitorMeta(status);
  const payment = getLatestPaymentEntry(venta || fallback);
  const total = Number(venta?.totals?.total ?? fallback?.total ?? 0);
  const itemCount = Number(venta?.lines?.length ?? fallback?.itemCount ?? 0);
  const saleLabel = venta?.id || fallback?.ventaId || "—";
  const locationLabel =
    String(venta?.location || fallback?.location || "")
      .toUpperCase()
      .replace("PV", "PV ") || "—";
  const updatedAt = payment?.updatedAt || venta?.paidAt || venta?.createdAt || null;
  const orderId =
    payment?.orderId || venta?.payment?.orderId || fallback?.orderId || "—";
  const paymentId = payment?.paymentId || fallback?.paymentId || "—";
  const canCancel = status === "pending" && orderId && orderId !== "—";
  const canReconcile = orderId && orderId !== "—";

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-4"
      onMouseDown={handleBackdropMouseDown}
    >
      <div className="absolute inset-0 bg-black/70" />
      <div
        ref={modalRef}
        className="relative z-10 flex max-h-[min(92vh,860px)] w-full max-w-xl flex-col overflow-hidden rounded-[28px] border border-white/10 bg-[#112C3E] shadow-[0_28px_70px_rgba(0,0,0,0.45)]"
      >
        <div className={`h-1.5 w-full shrink-0 ${meta.barClass}`} />
        <div className="overflow-y-auto">
          <div className="p-4 sm:p-6">
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-[0.2em] text-white/45">
                Cobro presencial
              </p>
              <h3 className="mt-1 text-xl font-semibold">Mercado Pago</h3>
              <p className="mt-2 text-sm text-white/60">
                Seguimiento del cobro cargado al QR del local.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              {canReconcile && (
                <button
                  type="button"
                  onClick={onReconcile}
                  disabled={reconciling}
                  className={`rounded-xl px-3 py-1.5 text-sm ${
                    reconciling
                      ? "cursor-wait bg-sky-500/10 text-sky-100"
                      : "bg-sky-500/15 text-sky-100 hover:bg-sky-500/25"
                  }`}
                >
                  {reconciling ? "Consultando..." : "Reconsultar pago"}
                </button>
              )}
              {canCancel && (
                <button
                  type="button"
                  onClick={onCancel}
                  disabled={canceling}
                  className={`rounded-xl px-3 py-1.5 text-sm ${
                    canceling
                      ? "cursor-wait bg-red-500/10 text-red-100"
                      : "bg-red-500/15 text-red-100 hover:bg-red-500/25"
                  }`}
                >
                  {canceling ? "Cancelando..." : "Cancelar venta"}
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl bg-white/10 px-3 py-1.5 text-sm hover:bg-white/15"
              >
                Cerrar
              </button>
            </div>
          </div>
          </div>

          <div className="mt-4 rounded-2xl border border-white/10 bg-[#0C212D] p-4">
            <div className="flex flex-wrap items-center gap-3">
              <StatusPill status={status} />
              <div className="text-sm text-white/60">
                Venta <span className="font-medium text-white">{saleLabel}</span>
              </div>
            </div>

            <div className="mt-3 flex items-start gap-3">
              <div className={`mt-1 h-3 w-3 rounded-full ${meta.dotClass}`} />
              <div>
                <div className="font-medium">{meta.title}</div>
                <p className="mt-1 text-sm text-white/65">{meta.description}</p>
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <InfoTile label="Total" value={money(total)} />
            <InfoTile label="Ítems" value={String(itemCount)} />
            <InfoTile label="Sede" value={locationLabel} />
            <InfoTile
              label="Último cambio"
              value={timestampLabel(updatedAt)}
            />
          </div>

          <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="grid gap-2 sm:grid-cols-2">
              <InfoRow
                label="Estado pago"
                value={
                  payment?.status ||
                  venta?.payment?.status ||
                  fallback?.paymentStatus ||
                  "pending"
                }
              />
              <InfoRow label="Order ID" value={orderId} />
              <InfoRow label="Payment ID" value={paymentId} />
              <InfoRow label="Detalle" value={payment?.statusDetail || venta?.payment?.statusDetail || "—"} />
            </div>
          </div>

          {Array.isArray(venta?.lines) && venta.lines.length > 0 && (
            <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="font-medium">Detalle del pedido</div>
                <div className="text-xs text-white/45">
                  {venta.lines.length} productos cargados al cobro
                </div>
              </div>
              <div className="space-y-2">
                {venta.lines.map((line, index) => (
                  <div
                    key={`${line?.productId || line?.sku || "line"}_${index}`}
                    className="flex items-center justify-between gap-3 rounded-xl bg-black/10 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">
                        {line?.name || "Producto"}
                      </div>
                      <div className="text-xs text-white/50">
                        {line?.sku || line?.productId || "Sin código"}
                      </div>
                    </div>
                    <div className="shrink-0 text-right text-sm">
                      <div>{line?.qty || 0} x {money(Number(line?.unitPrice || 0))}</div>
                      <div className="text-xs text-white/55">
                        {money(Number(line?.subtotal || 0))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(status === "preparing" || status === "pending") && (
            <div className="mt-4 rounded-2xl border border-sky-400/20 bg-sky-500/10 px-4 py-3 text-sm text-sky-50">
              {status === "preparing"
                ? "La venta ya está cerrada. Estamos cargando el cobro en Mercado Pago para dejar listo el QR."
                : "Pedile al cliente que escanee el QR físico del local. Este panel se actualiza solo cuando Mercado Pago confirma el pago."}
            </div>
          )}
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoTile({ label, value }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
      <div className="text-[11px] uppercase tracking-[0.18em] text-white/45">
        {label}
      </div>
      <div className="mt-1 text-sm font-medium">{value}</div>
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-black/10 px-3 py-2">
      <span className="text-sm text-white/60">{label}</span>
      <span className="max-w-[55%] truncate text-sm">{value}</span>
    </div>
  );
}

/* helpers data */
function getVentaUpdatedMs(venta) {
  const payment = getLatestPaymentEntry(venta);
  const ts = payment?.updatedAt || venta?.paidAt || venta?.createdAt || null;
  if (!ts) return 0;
  if (typeof ts?.toDate === "function") return ts.toDate().getTime();
  if (typeof ts?.seconds === "number") return ts.seconds * 1000;
  return 0;
}
function getLatestPaymentEntry(venta) {
  const payments = Array.isArray(venta?.payments) ? venta.payments : [];
  return payments.length > 0 ? payments[payments.length - 1] : null;
}
function getVentaMonitorStatus(venta) {
  const payment = getLatestPaymentEntry(venta);
  const paymentStatus = String(
    payment?.status || venta?.payment?.status || "",
  ).toLowerCase();
  const saleStatus = String(venta?.status || "").toLowerCase();

  if (paymentStatus === "preparing" || saleStatus === "payment_preparing")
    return "preparing";
  if (paymentStatus === "approved" || saleStatus === "paid") return "approved";
  if (paymentStatus === "expired" || saleStatus === "payment_expired")
    return "expired";
  if (paymentStatus === "canceled" || saleStatus === "payment_canceled")
    return "canceled";
  if (paymentStatus === "rejected" || saleStatus === "payment_rejected")
    return "rejected";
  if (paymentStatus === "error" || saleStatus === "payment_error")
    return "error";
  return "pending";
}
function getPaymentMonitorMeta(status) {
  switch (status) {
    case "preparing":
      return {
        shortLabel: "Preparando",
        title: "Preparando cobro",
        description:
          "La venta ya se confirmó. El sistema está terminando de cargar el cobro en Mercado Pago.",
        pillClass: "border-indigo-400/30 bg-indigo-500/15 text-indigo-100",
        dotClass: "animate-pulse bg-indigo-300",
        barClass: "bg-gradient-to-r from-indigo-400 to-sky-400",
      };
    case "approved":
      return {
        shortLabel: "Aprobado",
        title: "Pago confirmado",
        description:
          "Mercado Pago ya confirmó la cobranza y la venta quedó registrada como pagada.",
        pillClass: "border-emerald-400/30 bg-emerald-500/15 text-emerald-100",
        dotClass: "bg-emerald-400",
        barClass: "bg-gradient-to-r from-emerald-400 to-emerald-500",
      };
    case "expired":
      return {
        shortLabel: "Vencido",
        title: "La orden venció",
        description:
          "El cliente no pagó a tiempo. El sistema debería liberar la reserva de stock automáticamente.",
        pillClass: "border-amber-400/30 bg-amber-500/15 text-amber-100",
        dotClass: "bg-amber-300",
        barClass: "bg-gradient-to-r from-amber-300 to-amber-500",
      };
    case "canceled":
      return {
        shortLabel: "Cancelado",
        title: "Cobro cancelado",
        description:
          "Mercado Pago informó que la orden fue cancelada. La venta quedó guardada solo como intento.",
        pillClass: "border-orange-400/30 bg-orange-500/15 text-orange-100",
        dotClass: "bg-orange-300",
        barClass: "bg-gradient-to-r from-orange-300 to-orange-500",
      };
    case "rejected":
      return {
        shortLabel: "Rechazado",
        title: "Pago rechazado",
        description:
          "El intento de cobro fue rechazado. Podés volver a intentar desde una nueva venta si hace falta.",
        pillClass: "border-rose-400/30 bg-rose-500/15 text-rose-100",
        dotClass: "bg-rose-300",
        barClass: "bg-gradient-to-r from-rose-300 to-rose-500",
      };
    case "error":
      return {
        shortLabel: "Error",
        title: "Error al cargar el cobro",
        description:
          "La venta se guardó, pero la orden de Mercado Pago no terminó de cargarse correctamente.",
        pillClass: "border-red-400/30 bg-red-500/15 text-red-100",
        dotClass: "bg-red-300",
        barClass: "bg-gradient-to-r from-red-400 to-red-500",
      };
    default:
      return {
        shortLabel: "Esperando",
        title: "Esperando pago del cliente",
        description:
          "La venta ya fue enviada a Mercado Pago. Queda pendiente hasta que el cliente complete el pago desde el QR.",
        pillClass: "border-sky-400/30 bg-sky-500/15 text-sky-100",
        dotClass: "animate-pulse bg-sky-300",
        barClass: "bg-gradient-to-r from-sky-400 to-cyan-400",
      };
  }
}
function finalPrice(p) {
  return p.discountActive && p.priceDiscount > 0 ? p.priceDiscount : p.price;
}
function money(n) {
  if (typeof n !== "number" || isNaN(n)) return "-";
  return n.toLocaleString("es-AR", { style: "currency", currency: "ARS" });
}
function timestampLabel(ts) {
  if (!ts) return "—";
  if (typeof ts?.toDate === "function") {
    return ts.toDate().toLocaleString("es-AR", {
      dateStyle: "short",
      timeStyle: "short",
    });
  }
  if (typeof ts?.seconds === "number") {
    return new Date(ts.seconds * 1000).toLocaleString("es-AR", {
      dateStyle: "short",
      timeStyle: "short",
    });
  }
  return "—";
}
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
