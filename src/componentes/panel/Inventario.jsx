// src/componentes/dashboard/inventario/Inventario.jsx
"use client";
import React, { useContext, useMemo, useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import ContextGeneral from "@/servicios/contextGeneral";
import {
  doc,
  setDoc,
  updateDoc,
  serverTimestamp,
  deleteField,
  runTransaction, // ⬅️ importante
  getDoc, // (usado en helpers)
} from "firebase/firestore";
import { FiEdit2, FiTrash2 } from "react-icons/fi";

const CHUNK_LIMIT = 200; // capacidad por documento

// === Columnas (persistencia) ===
const LS_COLS = "mx.inv.columns";
const DEFAULT_COLS = {
  nombre: true,
  codigo: true,
  tipo: true,
  proveedor: true,
  costo: true,
  ivaC: false,
  precio: true,
  ivaV: false,
  stock1: true,
  stock2: true,
  vtas: false,
  cpras: false,
  activo: true,
  acciones: true,
};

export default function Inventario() {
  const ctx = useContext(ContextGeneral);
  const firestore = ctx?.firestore;

  // ===== Wire con el Context =====
  const docsSnap = ctx?.productosDocs ?? ctx?.productDocs ?? []; // [{id, data}]
  const itemsCtx = ctx?.productos ?? ctx?.products ?? []; // productos aplanados
  const loading = ctx?.productosLoading ?? ctx?.productsLoading ?? false;

  const items = useMemo(() => {
    if (itemsCtx?.length) return itemsCtx;
    if (docsSnap?.length) return flattenProducts(docsSnap);
    return [];
  }, [itemsCtx, docsSnap]);

  // ===== Proveedores únicos =====
  const providersList = useMemo(() => {
    const set = new Set(
      items
        .map((p) => (p.provider || "").trim())
        .filter((v) => v && v.length > 0)
    );
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [items]);

  // ===== Tipos únicos =====
  const categoriesList = useMemo(() => {
    const set = new Set(
      items
        .map((p) => (p.category || "").trim())
        .filter((v) => v && v.length > 0)
    );
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [items]);

  // ===== Estado UI =====
  const [qtext, setQtext] = useState("");
  const [onlyActive, setOnlyActive] = useState(true);
  const [onlyWithStock, setOnlyWithStock] = useState(false);
  const [onlyLow, setOnlyLow] = useState(false);
  const [lowThreshold, setLowThreshold] = useState(3);

  // Columnas visibles
  const [cols, setCols] = useState(DEFAULT_COLS);
  const [showColsPanel, setShowColsPanel] = useState(false);
  const colsBtnRef = useRef(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(LS_COLS);
      if (saved) setCols({ ...DEFAULT_COLS, ...JSON.parse(saved) });
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(LS_COLS, JSON.stringify(cols));
    } catch {}
  }, [cols]);

  // cerrar panel columnas al click afuera
  useEffect(() => {
    function onDocClick(e) {
      if (!showColsPanel) return;
      const btn = colsBtnRef.current;
      if (btn && (btn === e.target || btn.contains(e.target))) return;
      const panel = document.getElementById("inv-cols-panel");
      if (panel && panel.contains(e.target)) return;
      setShowColsPanel(false);
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [showColsPanel]);

  // Modal Crear/Editar
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blankProduct());

  // refs de inputs
  const skuInputRef = useRef(null);

  // ===== Scanner de código de barras (robusto) =====
  const scanBufferRef = useRef("");
  const lastKeyTimeRef = useRef(0);
  useEffect(() => {
    if (!open) return;

    function onKeyDown(e) {
      try {
        const key = typeof e.key === "string" ? e.key : "";

        if (
          !key ||
          key === "Shift" ||
          key === "Tab" ||
          key === "Alt" ||
          key === "Meta" ||
          key === "Control"
        )
          return;

        const now =
          typeof performance !== "undefined" && performance.now
            ? performance.now()
            : Date.now();

        if (now - (lastKeyTimeRef.current || 0) > 50) {
          scanBufferRef.current = "";
        }
        lastKeyTimeRef.current = now;

        if (key.length === 1) {
          scanBufferRef.current += key;
        }

        if (key === "Enter") {
          const code = (scanBufferRef.current || "").trim();
          if (code.length >= 3) {
            setForm((prev) => ({ ...prev, sku: code.toUpperCase() }));
            skuInputRef.current?.focus?.();
            toast.success("Código leído: " + code);
            e.preventDefault?.();
          }
          scanBufferRef.current = "";
        }
      } catch (err) {
        console.warn("[scanner] Ignorado:", err);
        scanBufferRef.current = "";
      }
    }

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open]);

  // Import progress
  const [imp, setImp] = useState({
    running: false,
    filename: "",
    total: 0,
    processed: 0,
    created: 0,
    updated: 0,
    error: "",
  });

  // ====== ID incremental local para creaciones consecutivas ======
  const nextLocalIdRef = useRef(null);
  useEffect(() => {
    const max = computeMaxId(items, docsSnap);
    if (nextLocalIdRef.current === null || nextLocalIdRef.current < max + 1) {
      nextLocalIdRef.current = max + 1;
    }
  }, [items, docsSnap]);
  function getNextLocalId() {
    if (nextLocalIdRef.current === null) nextLocalIdRef.current = 1;
    const id = String(nextLocalIdRef.current).padStart(6, "0");
    nextLocalIdRef.current += 1;
    return id;
  }

  // ====== ID random único (sin colisiones, con verificación en TX) ======
  const sessionIdsRef = useRef(new Set());
  function randomIdRaw() {
    try {
      if (typeof crypto !== "undefined" && crypto.getRandomValues) {
        const buf = new Uint32Array(2);
        crypto.getRandomValues(buf);
        return (buf[0].toString(36) + buf[1].toString(36))
          .slice(0, 10)
          .toUpperCase();
      }
    } catch {}
    return Math.random().toString(36).slice(2, 12).toUpperCase();
  }
  function getRandomUniqueIdLocal() {
    // Evita repetir en la sesión actual incluso si el contexto aún no refrescó
    const used = new Set(items.map((p) => String(p.id || "")));
    for (const id of sessionIdsRef.current) used.add(id);
    let id = randomIdRaw();
    while (used.has(id)) id = randomIdRaw();
    sessionIdsRef.current.add(id);
    return id;
  }

  // ===== Filtro =====
  const filtered = useMemo(() => {
    const t = qtext.trim().toLowerCase();
    return items
      .filter((p) => {
        const inText =
          !t ||
          p.name?.toLowerCase().includes(t) ||
          p.sku?.toLowerCase().includes(t) ||
          p.category?.toLowerCase().includes(t) ||
          p.provider?.toLowerCase?.().includes(t) ||
          p.description?.toLowerCase?.().includes(t);

        const activeOk = !onlyActive || p.enabled !== false;
        const withStockOk =
          !onlyWithStock ||
          Number.parseInt(p?.stockPv1 ?? 0, 10) > 0 ||
          Number.parseInt(p?.stockPv2 ?? 0, 10) > 0;

        const lowOk =
          !onlyLow ||
          Number.parseInt(p?.stockPv1 ?? 0, 10) <= Number(lowThreshold || 0) ||
          Number.parseInt(p?.stockPv2 ?? 0, 10) <= Number(lowThreshold || 0);

        return inText && activeOk && withStockOk && lowOk;
      })
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }, [items, qtext, onlyActive, onlyWithStock, onlyLow, lowThreshold]);

  // ====== Paginación ======
  const [pageSize, setPageSize] = useState(25); // 0 = todos
  const [page, setPage] = useState(1);

  useEffect(
    () => setPage(1),
    [qtext, onlyActive, onlyWithStock, onlyLow, lowThreshold, items, pageSize]
  );

  const total = filtered.length;
  const totalPages =
    pageSize === 0 ? 1 : Math.max(1, Math.ceil(total / pageSize));

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [totalPages, page]);

  const startIndex = pageSize === 0 ? 0 : (page - 1) * pageSize;
  const endIndex =
    pageSize === 0 ? total : Math.min(total, startIndex + pageSize);
  const pageItems = useMemo(
    () => filtered.slice(startIndex, endIndex),
    [filtered, startIndex, endIndex]
  );

  // ===== Modal =====
  function openCreate() {
    setEditing(null);
    setForm(blankProduct());
    setOpen(true);
  }
  function openEdit(prod) {
    setEditing(prod);
    setForm({
      ...blankProduct(),
      ...prod,
      name: prod.name || "",
      sku: prod.sku || "",
      category: prod.category || "",
      provider: prod.provider || "",
      description: prod.description || "",
      cost: toStr(prod.cost),
      price: toStr(prod.price),
      priceDiscount: toStr(prod.priceDiscount),
      ivaCompras: toStr(prod.ivaCompras),
      ivaVentas: toStr(prod.ivaVentas),
      stockPv1: toStrInt(prod.stockPv1),
      stockPv2: toStrInt(prod.stockPv2),
      minStock: toStrInt(prod.minStock),
      showInSales: !!prod.showInSales,
      showInPurchases: !!prod.showInPurchases,
      taxable: prod.taxable !== false,
      enabled: prod.enabled !== false,
      discountActive: !!prod.discountActive,
    });
    setOpen(true);
  }

  // ======== CREAR con TX: id random + chunk con espacio ===============
  async function createProductWithUniqueIdTx(payload) {
    // Estrategia:
    // 1) Buscar un chunk con espacio real hasta CHUNK_LIMIT.
    // 2) Generar ID random y verificar que el campo p_{id} no exista en ese chunk.
    // 3) Si existe, regenero ID y reintento (en la misma TX).
    // 4) Si el chunk está lleno, paso al siguiente "NNN".
    if (!firestore) throw new Error("Firestore no disponible");

    // Prefiero empezar por un chunk existente con espacio si lo hay.
    const orderedExistingIds =
      (docsSnap || []).map((d) => d.id).sort((a, b) => a.localeCompare(b)) ||
      [];

    // Helper para generar próximo nombre de chunk a partir de un índice numérico
    const chunkIdFromIndex = (idx) => String(idx + 1).padStart(3, "0");

    await runTransaction(firestore, async (tx) => {
      // Paso A: construir lista de candidatos (existentes + uno nuevo al final)
      const candidates = [...orderedExistingIds];
      // Agrego como candidato también el siguiente nuevo por las dudas
      candidates.push(chunkIdFromIndex(candidates.length));

      let chosenDocId = null;
      let chosenData = null;

      // Paso B: encontrar un chunk con espacio
      for (let i = 0; i < candidates.length; i++) {
        const candidateId = candidates[i];
        const ref = doc(firestore, "productos", candidateId);
        let snap = await tx.get(ref);
        if (!snap.exists()) {
          // si no existe, lo creo vacío en la tx
          tx.set(ref, {});
          snap = await tx.get(ref);
        }
        const data = snap.data() || {};
        const count = Object.keys(data).filter((k) =>
          k.startsWith("p_")
        ).length;
        if (count < CHUNK_LIMIT) {
          chosenDocId = candidateId;
          chosenData = data;
          break;
        }
        // si llego al último y está lleno, agrego uno más y lo uso
        if (i === candidates.length - 1) {
          const newId = chunkIdFromIndex(candidates.length);
          const newRef = doc(firestore, "productos", newId);
          tx.set(newRef, {});
          chosenDocId = newId;
          chosenData = {};
          break;
        }
      }

      if (!chosenDocId) throw new Error("No se pudo elegir chunk destino");

      // Paso C: asegurar ID random no usado en este doc
      // Además, evito colisiones de sesión local.
      let newId = getRandomUniqueIdLocal();
      let tries = 0;
      const MAX_TRIES = 20;

      while (tries < MAX_TRIES) {
        const fieldKey = `p_${newId}`;
        if (!Object.prototype.hasOwnProperty.call(chosenData, fieldKey)) {
          // libre, escribo
          const ref = doc(firestore, "productos", chosenDocId);
          const value = {
            ...payload,
            id: newId,
            chunkDoc: chosenDocId,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          };
          // update en TX: no pisa otros campos, sólo suma esta clave
          tx.update(ref, { [fieldKey]: value });
          return; // listo
        }
        // ya existe, generar otro y reintentar
        newId = getRandomUniqueIdLocal();
        tries++;
      }
      throw new Error("No se pudo generar un ID único (reintentar).");
    });
  }

  // ===== Guardar =====
  async function handleSave(e) {
    e?.preventDefault?.();
    if (!firestore) return toast.error("Firestore no disponible");

    const payload = normalizeForSave(form);
    try {
      validate(payload);
      const run = async () => {
        if (editing?.id && editing?.chunkDoc) {
          const docRef = doc(firestore, "productos", editing.chunkDoc);
          await updateDoc(docRef, {
            [`p_${editing.id}`]: {
              ...editing,
              ...payload,
              id: editing.id,
              chunkDoc: editing.chunkDoc,
              updatedAt: serverTimestamp(),
            },
          });
        } else {
          // ⬇️ CREACIÓN segura con TX e ID random no repetido
          await createProductWithUniqueIdTx(payload);
        }
      };
      await toast.promise(run(), {
        loading: "Guardando producto…",
        success: editing ? "Producto actualizado" : "Producto creado",
        error: (err) => err?.message || "Error al guardar",
      });
      setOpen(false);
      setEditing(null);
      setForm(blankProduct());
    } catch (err) {
      console.error(err);
      toast.error(err?.message || "Error al guardar");
    }
  }

  // ===== Borrar =====
  async function handleDelete(prod) {
    if (!firestore) return toast.error("Firestore no disponible");
    if (!confirm("¿Eliminar el producto?")) return;
    try {
      const docRef = doc(firestore, "productos", prod.chunkDoc);
      await toast.promise(
        updateDoc(docRef, { [`p_${prod.id}`]: deleteField() }),
        {
          loading: "Eliminando…",
          success: "Producto eliminado",
          error: "No se pudo eliminar",
        }
      );
    } catch (e) {
      console.error(e);
    }
  }

  // ===== Import (xlsx/csv) =====
  async function handleImportExcel(ev) {
    const file = ev.target.files?.[0];
    ev.target.value = "";
    if (!file) return;

    setImp({
      running: true,
      filename: file.name,
      total: 0,
      processed: 0,
      created: 0,
      updated: 0,
      error: "",
    });

    try {
      if (!firestore) throw new Error("Firestore no disponible");

      const XLSX = await import("xlsx");
      const buff = await file.arrayBuffer();
      const wb = XLSX.read(buff, { type: "array" });

      const sheetName = wb.SheetNames[0];
      if (!sheetName) throw new Error("Hoja de Excel vacía");
      const sheet = wb.Sheets[sheetName];

      const rawRows = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        blankrows: false,
        defval: "",
      });

      if (rawRows.length < 2)
        throw new Error("El Excel no tiene filas de datos");
      const headers = (rawRows[0] || []).map((h) => normHeader(h));
      const rows = rawRows.slice(1).map((r) => {
        const obj = {};
        headers.forEach((h, i) => (obj[h] = (r[i] ?? "").toString().trim()));
        return obj;
      });

      const mapped = rows
        .filter((r) => Object.values(r).some((v) => String(v).trim() !== ""))
        .map(mapRowToProductModel);

      setImp((s) => ({ ...s, total: mapped.length }));

      const byId = new Map(items.map((p) => [String(p.id), p]));
      const usedIds = new Set(items.map((p) => String(p.id)));
      const nextIdCounter = makeNextIdCounter(usedIds);

      const counts = new Map(
        docsSnap.map((d) => [
          d.id,
          Object.keys(d.data || {}).filter((k) => k.startsWith("p_")).length,
        ])
      );
      const nextChunkName = makeNextChunkName(docsSnap.map((d) => d.id));

      const upsertsByDoc = new Map();
      const docsToInit = new Set();

      let created = 0;
      let updated = 0;
      let processed = 0;

      const putInDocBatch = (docId, fieldKey, valueObj) => {
        if (!upsertsByDoc.has(docId)) upsertsByDoc.set(docId, {});
        upsertsByDoc.get(docId)[fieldKey] = valueObj;
      };

      for (const r of mapped) {
        // 1) ID y existente (si lo hay)
        const desiredId = r.id ? pad6(r.id) : nextIdCounter();
        const existing = byId.get(desiredId);
        const fieldKey = `p_${desiredId}`;

        // 2) Payload que NO pisa con vacíos del Excel
        const payload = normalizeForSave({
          ...blankProduct(),
          name: r.name || existing?.name || "",
          sku: r.sku || existing?.sku || "",
          category: r.category || existing?.category || "",
          provider: r.provider || existing?.provider || "",
          description: r.description || existing?.description || "",

          cost: r.cost ?? existing?.cost ?? 0,
          ivaCompras: r.ivaCompras ?? existing?.ivaCompras ?? 0,
          price: r.price ?? existing?.price ?? 0,
          ivaVentas: r.ivaVentas ?? existing?.ivaVentas ?? 0,

          stockPv1: r.stockPv1 ?? existing?.stockPv1 ?? 0,
          stockPv2: r.stockPv2 ?? existing?.stockPv2 ?? 0,
          minStock: r.minStock ?? existing?.minStock ?? 0,

          enabled: r.enabled ?? existing?.enabled ?? true,
          taxable: r.taxable ?? existing?.taxable ?? true,
          showInSales: r.showInSales ?? existing?.showInSales ?? true,
          showInPurchases:
            r.showInPurchases ?? existing?.showInPurchases ?? true,

          priceDiscount: r.priceDiscount ?? existing?.priceDiscount ?? 0,
          discountActive: r.discountActive ?? existing?.discountActive ?? false,
        });

        validate(payload);

        if (existing) {
          const docId = existing.chunkDoc;
          const valueObj = {
            ...existing,
            ...payload,
            id: existing.id,
            chunkDoc: docId,
            updatedAt: serverTimestamp(),
          };
          putInDocBatch(docId, fieldKey, valueObj);
          updated++;
        } else {
          let targetDocId = null;
          for (const [docId, count] of counts.entries()) {
            if (count < CHUNK_LIMIT) {
              targetDocId = docId;
              counts.set(docId, count + 1);
              break;
            }
          }
          if (!targetDocId) {
            targetDocId = nextChunkName();
            counts.set(targetDocId, 1);
            docsToInit.add(targetDocId);
          }
          const valueObj = {
            ...payload,
            id: desiredId,
            chunkDoc: targetDocId,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          };
          putInDocBatch(targetDocId, fieldKey, valueObj);
          byId.set(desiredId, valueObj);
          usedIds.add(desiredId);
          created++;
        }

        processed++;
        if (processed % 50 === 0 || processed === mapped.length) {
          setImp((s) => ({ ...s, processed, created, updated }));
        }
      }

      for (const newDocId of docsToInit) {
        const createRef = doc(firestore, "productos", newDocId);
        await setDoc(createRef, {});
      }
      let docWrites = 0;
      for (const [docId, upserts] of upsertsByDoc.entries()) {
        const docRef = doc(firestore, "productos", docId);
        await updateDoc(docRef, upserts);
        docWrites++;
      }

      setImp((s) => ({ ...s, processed, created, updated }));
      toast.success(
        `Importación OK — Creados: ${created} · Actualizados: ${updated} · Escrituras de doc: ${docWrites}`
      );
    } catch (e) {
      console.error(e);
      setImp((s) => ({ ...s, error: e?.message || "Error al importar" }));
      toast.error(e?.message || "No se pudo importar el archivo");
    } finally {
      setTimeout(() => {
        setImp((s) => ({ ...s, running: false }));
      }, 500);
    }
  }

  // ===== Export Excel (ExcelJS, con estilos) =====
  async function handleExportXLSX() {
    try {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Inventario");

      const ALL_COLS = [
        ["Id", (p) => p.id || ""],
        ["Nombre", (p) => p.name || ""],
        ["Tipo de Producto", (p) => p.category || ""],
        ["Proveedor", (p) => p.provider || ""],
        ["Código", (p) => p.sku || ""],
        ["Stock PV1", (p) => Number(p.stockPv1 ?? 0), "int"],
        ["Stock PV2", (p) => Number(p.stockPv2 ?? 0), "int"],
        ["Costo", (p) => Number(p.cost ?? 0), "currency"],
        ["IVA Compras (%)", (p) => Number(p.ivaCompras ?? 0)],
        [
          "Precio de Venta (contado)",
          (p) => Number(finalPriceContado(p) ?? 0),
          "currency",
        ],
        ["IVA Ventas (%)", (p) => Number(p.ivaVentas ?? 0)],
        ["Descripción", (p) => p.description || ""],
        ["Activo", (p) => (p.enabled !== false ? "SI" : "NO")],
        ["Mostrar en Ventas", (p) => (p.showInSales ? "SI" : "NO")],
        ["Mostrar en Compras", (p) => (p.showInPurchases ? "SI" : "NO")],
      ];

      ws.columns = ALL_COLS.map(([header]) => ({ header, key: header }));

      const data = items.map((p) => ALL_COLS.map(([, get]) => get(p)));
      ws.addRows(data);

      const headerRow = ws.getRow(1);
      headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
      headerRow.alignment = { vertical: "middle", horizontal: "center" };
      headerRow.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF112C3E" },
      };
      headerRow.height = 20;

      const currencyFmt = '"$"#,##0.00;[Red]-"$"#,##0.00';
      ws.eachRow((row, rowNumber) => {
        row.eachCell((cell, colNumber) => {
          cell.border = {
            top: { style: "thin", color: { argb: "FF2A3F4F" } },
            left: { style: "thin", color: { argb: "FF2A3F4F" } },
            bottom: { style: "thin", color: { argb: "FF2A3F4F" } },
            right: { style: "thin", color: { argb: "FF2A3F4F" } },
          };
          cell.alignment = {
            vertical: "middle",
            horizontal: "left",
            wrapText: true,
          };
          const type = ALL_COLS[colNumber - 1]?.[2];
          if (rowNumber > 1 && type === "currency") cell.numFmt = currencyFmt;
          if (rowNumber > 1 && type === "int") cell.numFmt = "0";
        });
      });

      ws.columns.forEach((col) => {
        let max = String(col.header ?? "").length;
        col.eachCell({ includeEmpty: true }, (cell) => {
          const v = cell.value == null ? "" : String(cell.value);
          max = Math.max(max, v.length);
        });
        col.width = Math.min(45, Math.max(12, max + 2));
      });

      ws.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: ALL_COLS.length },
      };
      ws.views = [{ state: "frozen", ySplit: 1 }];

      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `inventario_${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Excel exportado");
    } catch (e) {
      console.error(e);
      toast.error("No se pudo exportar el Excel");
    }
  }

  // ===== UI =====
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
  const endDrag = () => (isDownRef.current = false);

  return (
    <div className="space-y-4 overflow-x-hidden max-w-full pb-24">
      {/* Controles */}
      <div className="flex flex-col md:flex-row gap-2 md:items-center md:justify-between min-w-0">
        <div className="flex flex-wrap gap-2 items-center min-w-0">
          <input
            value={qtext}
            onChange={(e) => setQtext(e.target.value)}
            placeholder="Buscar por nombre, código, categoría, proveedor o descripción…"
            title="Escribí para filtrar por texto en múltiples campos"
            className="w-full sm:w-72 md:w-80 rounded-lg bg-[#0C212D] border border-white/10 px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[#EE7203]/70"
          />

          <LabelPill label="Solo activos">
            <TogglePill checked={onlyActive} onChange={setOnlyActive} />
          </LabelPill>

          <LabelPill label="Solo con stock">
            <TogglePill checked={onlyWithStock} onChange={setOnlyWithStock} />
          </LabelPill>

          <LabelPill label="Stock bajo (≤)">
            <div className="flex items-center gap-1.5">
              <TogglePill checked={onlyLow} onChange={setOnlyLow} />
              <input
                type="number"
                min={0}
                value={lowThreshold}
                title="Umbral de alerta para stocks bajos"
                onChange={(e) =>
                  setLowThreshold(
                    Math.max(0, parseInt(e.target.value || "0", 10))
                  )
                }
                className="w-14 rounded-lg bg-[#0C212D] border border-white/10 px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[#EE7203]/70"
              />
            </div>
          </LabelPill>

          <LabelPill label="Ver">
            <select
              value={pageSize}
              title="Cantidad de filas por página"
              onChange={(e) => setPageSize(parseInt(e.target.value, 10))}
              className="rounded-lg bg-[#0C212D] border border-white/10 px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[#EE7203]/70"
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={0}>Todos</option>
            </select>
          </LabelPill>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <label
            title="Importá productos desde Excel/CSV"
            className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 cursor-pointer text-sm"
          >
            Importar (.xlsx)
            <input
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.csv,text/csv"
              onChange={handleImportExcel}
              className="hidden"
            />
          </label>

          <button
            onClick={handleExportXLSX}
            title="Exportar todo el inventario a Excel"
            className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-sm"
          >
            Exportar Excel
          </button>

          <button
            onClick={openCreate}
            title="Crear un nuevo producto"
            className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-[#EE7203] to-[#FF3816] text-sm font-medium shadow hover:opacity-95"
          >
            Nuevo
          </button>

          {/* Selector de columnas (a la derecha) */}
          <div className="relative">
            <button
              ref={colsBtnRef}
              onClick={() => setShowColsPanel((v) => !v)}
              className="px-3 py-1.5 rounded-lg text-sm bg-white/10 hover:bg-white/15"
              title="Configurar columnas"
            >
              Columnas
            </button>
            {showColsPanel && (
              <div
                id="inv-cols-panel"
                className="absolute right-0 mt-2 w-64 rounded-xl border border-white/10 bg-[#0C212D] shadow-xl p-3 z-20"
              >
                <p className="text-xs text-white/60 mb-2">
                  Mostrar/ocultar columnas
                </p>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  {[
                    ["nombre", "Nombre"],
                    ["codigo", "Código"],
                    ["tipo", "Tipo"],
                    ["proveedor", "Proveedor"],
                    ["costo", "Costo"],
                    ["ivaC", "IVA C."],
                    ["precio", "Precio"],
                    ["ivaV", "IVA V."],
                    ["stock1", "Stock PV1"],
                    ["stock2", "Stock PV2"],
                    ["vtas", "Vtas"],
                    ["cpras", "Cpras"],
                    ["activo", "Activo"],
                    ["acciones", "Acciones"],
                  ].map(([key, label]) => (
                    <label key={key} className="inline-flex items-center gap-2">
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

      {/* Loader/Progreso de import */}
      {imp.running && (
        <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm">
          <div className="flex items-center justify-between mb-2">
            <div className="font-medium">Importando: {imp.filename}</div>
            <div className="text-white/70">
              {imp.processed}/{imp.total} · Creados {imp.created} · Actualizados{" "}
              {imp.updated}
            </div>
          </div>
          <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-2 bg-gradient-to-r from-[#EE7203] to-[#FF3816] transition-all"
              style={{
                width:
                  imp.total > 0
                    ? `${Math.min(
                        100,
                        Math.round((imp.processed / imp.total) * 100)
                      )}%`
                    : "0%",
              }}
            />
          </div>
          {imp.error && (
            <div className="mt-2 text-red-300">Error: {imp.error}</div>
          )}
        </div>
      )}

      {/* ====== LISTA (mobile) ====== */}
      <div className="grid gap-2 md:hidden">
        {loading ? (
          <div className="p-4 text-center text-white/60">Cargando…</div>
        ) : filtered.length === 0 ? (
          <div className="p-4 text-center text-white/60">Sin resultados</div>
        ) : (
          pageItems.map((p) => (
            <article
              key={`${p.chunkDoc}_${p.id}`}
              className="rounded-xl border border-white/10 bg-white/5 p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex items-start gap-2">
                  <IconGhost
                    title="Editar producto"
                    ariaLabel="Editar"
                    onClick={() => openEdit(p)}
                  >
                    <FiEdit2 className="w-4 h-4" />
                  </IconGhost>
                  <div className="min-w-0">
                    <h4
                      className="font-semibold leading-tight break-words"
                      title={p.name || "-"}
                    >
                      {p.name || "-"}
                    </h4>
                    <p
                      className="text-xs text-white/60"
                      title={`Código: ${p.sku || "-"} • Tipo: ${
                        p.category || "-"
                      }`}
                    >
                      <span className="font-mono">{p.sku || "-"}</span> •{" "}
                      {p.category || "-"}
                    </p>
                  </div>
                </div>
                <span
                  title={
                    p.enabled !== false
                      ? "Este producto está activo"
                      : "Este producto está inactivo"
                  }
                  className={`shrink-0 inline-flex h-6 items-center rounded-md px-2 text-xs ${
                    p.enabled !== false
                      ? "bg-emerald-500/15 text-emerald-300"
                      : "bg-white/10 text-white/60"
                  }`}
                >
                  {p.enabled !== false ? "Activo" : "Inactivo"}
                </span>
              </div>

              <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                <Info label="Proveedor" value={p.provider || "-"} />
                <Info label="Precio" value={money(finalPriceContado(p))} />
                <Info label="Stock PV1" value={String(p.stockPv1 ?? 0)} />
                <Info label="Stock PV2" value={String(p.stockPv2 ?? 0)} />
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                <IconBtn
                  title="Eliminar producto"
                  onClick={() => handleDelete(p)}
                  icon={<FiTrash2 className="w-4 h-4" />}
                  label="Eliminar"
                  danger
                />
              </div>
            </article>
          ))
        )}
      </div>

      {/* ====== TABLA (md+) ====== */}
      <div className="hidden md:block rounded-xl border border-white/10">
        <div
          ref={tableScrollRef}
          className="max-w-full overflow-x-auto overscroll-x-contain select-none cursor-grab active:cursor-grabbing"
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseLeave={endDrag}
          onMouseUp={endDrag}
          style={{ WebkitOverflowScrolling: "touch" }}
          title="Arrastrá para desplazar horizontalmente"
        >
          <table className="w-full text-sm table-fixed">
            <thead className="bg-white/5 text-white/70">
              <tr>
                {cols.nombre && (
                  <Th className="w-[220px] lg:w-[280px] sticky left-0 z-20">
                    Nombre
                  </Th>
                )}
                {cols.codigo && <Th className="w-[120px]">Código</Th>}
                {cols.tipo && (
                  <Th className="w-[160px] hidden lg:table-cell">Tipo</Th>
                )}
                {cols.proveedor && (
                  <Th className="w-[200px] hidden xl:table-cell">Proveedor</Th>
                )}
                {cols.costo && (
                  <Th className="w-[110px] text-right whitespace-nowrap">
                    Costo
                  </Th>
                )}
                {cols.ivaC && (
                  <Th className="w-[90px] text-right whitespace-nowrap hidden lg:table-cell">
                    IVA C.
                  </Th>
                )}
                {cols.precio && (
                  <Th className="w-[110px] text-right whitespace-nowrap">
                    Precio
                  </Th>
                )}
                {cols.ivaV && (
                  <Th className="w-[90px] text-right whitespace-nowrap hidden lg:table-cell">
                    IVA V.
                  </Th>
                )}
                {cols.stock1 && (
                  <Th className="w-[100px] text-right whitespace-nowrap">
                    Stock PV1
                  </Th>
                )}
                {cols.stock2 && (
                  <Th className="w-[100px] text-right whitespace-nowrap">
                    Stock PV2
                  </Th>
                )}
                {cols.vtas && (
                  <Th className="w-[80px] text-center hidden xl:table-cell">
                    Vtas
                  </Th>
                )}
                {cols.cpras && (
                  <Th className="w-[80px] text-center hidden xl:table-cell">
                    Cpras
                  </Th>
                )}
                {cols.activo && (
                  <Th className="w-[90px] text-center">Activo</Th>
                )}
                {cols.acciones && (
                  <Th className="w-[140px] text-center">Acciones</Th>
                )}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={14} className="p-6 text-center text-white/60">
                    Cargando…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={14} className="p-6 text-center text-white/60">
                    Sin resultados
                  </td>
                </tr>
              ) : (
                pageItems.map((p) => (
                  <tr
                    key={`${p.chunkDoc}_${p.id}`}
                    className="border-t border-white/5"
                  >
                    {cols.nombre && (
                      <Td className="sticky left-0 z-10" stickyBg>
                        <div className="flex items-start gap-2 min-w-0">
                          <IconGhost
                            title="Editar producto"
                            ariaLabel="Editar"
                            onClick={() => openEdit(p)}
                          >
                            <FiEdit2 className="w-4 h-4" />
                          </IconGhost>
                          <span className="truncate" title={p.name || "-"}>
                            {p.name || "-"}
                          </span>
                        </div>
                      </Td>
                    )}
                    {cols.codigo && (
                      <Td
                        className="truncate"
                        title={fmtTitle("Código", p.sku)}
                      >
                        {p.sku || "-"}
                      </Td>
                    )}
                    {cols.tipo && (
                      <Td
                        className="truncate hidden lg:table-cell"
                        title={fmtTitle("Tipo de producto", p.category)}
                      >
                        {p.category || "-"}
                      </Td>
                    )}
                    {cols.proveedor && (
                      <Td
                        className="truncate hidden xl:table-cell"
                        title={fmtTitle("Proveedor", p.provider)}
                      >
                        {p.provider || "-"}
                      </Td>
                    )}
                    {cols.costo && (
                      <Td
                        className="text-right whitespace-nowrap"
                        title={fmtTitle("Costo", money(p.cost))}
                      >
                        {money(p.cost)}
                      </Td>
                    )}
                    {cols.ivaC && (
                      <Td
                        className="text-right hidden lg:table-cell"
                        title={fmtTitle("IVA Compras", p.ivaCompras ?? "-")}
                      >
                        {p.ivaCompras ?? "-"}
                      </Td>
                    )}
                    {cols.precio && (
                      <Td
                        className="text-right whitespace-nowrap"
                        title={fmtTitle(
                          "Precio (contado)",
                          money(finalPriceContado(p))
                        )}
                      >
                        {money(finalPriceContado(p))}
                      </Td>
                    )}
                    {cols.ivaV && (
                      <Td
                        className="text-right hidden lg:table-cell"
                        title={fmtTitle("IVA Ventas", p.ivaVentas ?? "-")}
                      >
                        {p.ivaVentas ?? "-"}
                      </Td>
                    )}
                    {cols.stock1 && (
                      <Td
                        className="text-right"
                        title={fmtTitle("Stock PV1", p.stockPv1 ?? 0)}
                      >
                        {p.stockPv1 ?? 0}
                      </Td>
                    )}
                    {cols.stock2 && (
                      <Td
                        className="text-right"
                        title={fmtTitle("Stock PV2", p.stockPv2 ?? 0)}
                      >
                        {p.stockPv2 ?? 0}
                      </Td>
                    )}
                    {cols.vtas && (
                      <Td
                        className="text-center hidden xl:table-cell"
                        title={
                          p.showInSales
                            ? "Se muestra en Ventas"
                            : "Oculto en Ventas"
                        }
                      >
                        <Dot ok={!!p.showInSales} />
                      </Td>
                    )}
                    {cols.cpras && (
                      <Td
                        className="text-center hidden xl:table-cell"
                        title={
                          p.showInPurchases
                            ? "Se muestra en Compras"
                            : "Oculto en Compras"
                        }
                      >
                        <Dot ok={!!p.showInPurchases} />
                      </Td>
                    )}
                    {cols.activo && (
                      <Td
                        className="text-center"
                        title={
                          p.enabled !== false
                            ? "Producto activo"
                            : "Producto inactivo"
                        }
                      >
                        <Dot ok={p.enabled !== false} />
                      </Td>
                    )}
                    {cols.acciones && (
                      <Td className="text-center">
                        <div className="flex items-center justify-center gap-1.5 flex-wrap">
                          <IconBtn
                            title="Eliminar producto"
                            onClick={() => handleDelete(p)}
                            icon={<FiTrash2 className="w-4 h-4" />}
                            label="Eliminar"
                            danger
                          />
                        </div>
                      </Td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Footer de paginación */}
      {!loading && filtered.length > 0 && (
        <div className="flex flex-col md:flex-row items-center justify-between gap-2 text-sm text-white/80">
          <div>
            Mostrando{" "}
            <span className="text-white">
              {total === 0 ? 0 : startIndex + 1}–{endIndex}
            </span>{" "}
            de <span className="text-white">{total}</span> productos
          </div>
          {pageSize !== 0 && (
            <div className="flex items-center gap-1 flex-wrap">
              <PageBtn onClick={() => setPage(1)} disabled={page <= 1}>
                « Primero
              </PageBtn>
              <PageBtn
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
              >
                ‹ Anterior
              </PageBtn>
              <span className="px-2">
                Página <span className="text-white">{page}</span> de{" "}
                <span className="text-white">{totalPages}</span>
              </span>
              <PageBtn
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
              >
                Siguiente ›
              </PageBtn>
              <PageBtn
                onClick={() => setPage(totalPages)}
                disabled={page >= totalPages}
              >
                Última »
              </PageBtn>
            </div>
          )}
        </div>
      )}

      {/* Modal Crear/Editar */}
      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
          <div
            className="w-full max-w-3xl rounded-xl bg-[#112C3E] border border-white/10 shadow-2xl max-h-[85vh] overflow-y-auto"
            role="dialog"
          >
            <div className="p-4 border-b border-white/10 flex items-center justify-between sticky top-0 bg-[#112C3E]/95 backdrop-blur">
              <h3 className="font-semibold text-base">
                {editing ? "Editar producto" : "Nuevo producto"}
              </h3>
              <button
                onClick={() => setOpen(false)}
                className="text-white/60 hover:text-white"
                aria-label="Cerrar"
                title="Cerrar"
              >
                ×
              </button>
            </div>

            <form
              onSubmit={handleSave}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const tag = (e.target?.tagName || "").toUpperCase();
                  if (tag === "INPUT") e.preventDefault();
                }
              }}
              className="p-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3"
            >
              <Field label="Nombre" required>
                <input
                  name="name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="inp"
                  placeholder="Aceite 5W30"
                  title="Nombre del producto (requerido)"
                />
              </Field>
              <Field label="Código">
                <input
                  ref={skuInputRef}
                  value={form.sku}
                  onChange={(e) =>
                    setForm({ ...form, sku: e.target.value.toUpperCase() })
                  }
                  className="inp"
                  placeholder="COD-001 o escaneá el código..."
                  title="Código o SKU del producto"
                />
              </Field>
              <Field label="Tipo de Producto">
                <CategorySelect
                  value={form.category}
                  onChange={(val) => setForm({ ...form, category: val })}
                  options={categoriesList}
                  placeholder="Seleccioná o creá un tipo"
                />
              </Field>

              <Field label="Proveedor">
                <ProviderSelect
                  value={form.provider}
                  onChange={(val) => setForm({ ...form, provider: val })}
                  options={providersList}
                  placeholder="Seleccioná o creá un proveedor"
                />
              </Field>
              <Field label="Descripción">
                <input
                  value={form.description}
                  onChange={(e) =>
                    setForm({ ...form, description: e.target.value })
                  }
                  className="inp"
                  placeholder="Detalle o presentación"
                  title="Descripción del producto"
                />
              </Field>
              <Field label="Costo (opcional)">
                <input
                  type="number"
                  step="0.01"
                  value={form.cost}
                  onChange={(e) => setForm({ ...form, cost: e.target.value })}
                  className="inp"
                  placeholder="0.00"
                  title="Costo de compra (opcional)"
                />
              </Field>

              <Field label="IVA Compras (%)">
                <input
                  type="number"
                  step="0.01"
                  value={form.ivaCompras}
                  onChange={(e) =>
                    setForm({ ...form, ivaCompras: e.target.value })
                  }
                  className="inp"
                  placeholder="21"
                  title="IVA aplicado en compras (%)"
                />
              </Field>

              <Field label="Precio de Venta (contado)" required>
                <input
                  type="number"
                  step="0.01"
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                  className="inp"
                  placeholder="0.00"
                  title="Precio de venta (contado)"
                />
              </Field>

              <Field label="IVA Ventas (%)">
                <input
                  type="number"
                  step="0.01"
                  value={form.ivaVentas}
                  onChange={(e) =>
                    setForm({ ...form, ivaVentas: e.target.value })
                  }
                  className="inp"
                  placeholder="21"
                  title="IVA aplicado en ventas (%)"
                />
              </Field>

              <Field label="Precio contado con descuento">
                <input
                  type="number"
                  step="0.01"
                  value={form.priceDiscount}
                  onChange={(e) =>
                    setForm({ ...form, priceDiscount: e.target.value })
                  }
                  className="inp"
                  placeholder="0.00"
                  title="Precio promocional (contado)"
                />
              </Field>

              {/* ====== ACTIVABLES ====== */}
              <Field label="Descuento activo">
                <div className="flex items-center gap-2">
                  <TogglePill
                    checked={!!form.discountActive}
                    disabled={toNum(form.priceDiscount) <= 0}
                    onChange={(v) => setForm({ ...form, discountActive: v })}
                  />
                  <span className="text-[11px] text-white/60">
                    {toNum(form.priceDiscount) > 0
                      ? form.discountActive
                        ? "Se aplicará en ventas"
                        : "Desactivado"
                      : "Ingresá precio con descuento para activarlo"}
                  </span>
                </div>
              </Field>

              <Field label="Mostrar en Ventas">
                <div className="flex items-center gap-2">
                  <TogglePill
                    checked={!!form.showInSales}
                    onChange={(v) => setForm({ ...form, showInSales: v })}
                  />
                  <span className="text-[11px] text-white/60">
                    {form.showInSales ? "Visible" : "Oculto"}
                  </span>
                </div>
              </Field>

              <Field label="Mostrar en Compras">
                <div className="flex items-center gap-2">
                  <TogglePill
                    checked={!!form.showInPurchases}
                    onChange={(v) => setForm({ ...form, showInPurchases: v })}
                  />
                  <span className="text-[11px] text-white/60">
                    {form.showInPurchases ? "Visible" : "Oculto"}
                  </span>
                </div>
              </Field>

              <Field label="Gravado (IVA)">
                <div className="flex items-center gap-2">
                  <TogglePill
                    checked={!!form.taxable}
                    onChange={(v) => setForm({ ...form, taxable: v })}
                  />
                  <span className="text-[11px] text-white/60">
                    {form.taxable ? "Aplica IVA" : "Exento"}
                  </span>
                </div>
              </Field>

              <Field label="Activo">
                <div className="flex items-center gap-2">
                  <TogglePill
                    checked={form.enabled !== false}
                    onChange={(v) => setForm({ ...form, enabled: v })}
                  />
                  <span className="text-[11px] text-white/60">
                    {form.enabled !== false ? "Activo" : "Inactivo"}
                  </span>
                </div>
              </Field>

              <Field label="Stock PV1">
                <input
                  type="number"
                  value={form.stockPv1}
                  onChange={(e) =>
                    setForm({ ...form, stockPv1: e.target.value })
                  }
                  className="inp"
                  placeholder="0"
                  title="Stock en Punto de Venta 1"
                />
              </Field>
              <Field label="Stock PV2">
                <input
                  type="number"
                  value={form.stockPv2}
                  onChange={(e) =>
                    setForm({ ...form, stockPv2: e.target.value })
                  }
                  className="inp"
                  placeholder="0"
                  title="Stock en Punto de Venta 2"
                />
              </Field>
              <Field label="Stock mínimo (alerta)">
                <input
                  type="number"
                  value={form.minStock}
                  onChange={(e) =>
                    setForm({ ...form, minStock: e.target.value })
                  }
                  className="inp"
                  placeholder="0"
                  title="Umbral de alerta por stock bajo"
                />
              </Field>

              <div className="md:col-span-3 flex items-center justify-end gap-1.5 pt-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-sm"
                  title="Cancelar y cerrar"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-[#EE7203] to-[#FF3816] text-sm font-medium"
                  title="Guardar cambios"
                >
                  Guardar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <style jsx global>{`
        .inp {
          width: 100%;
          border-radius: 0.5rem;
          background: #0c212d;
          border: 1px solid rgba(255, 255, 255, 0.1);
          padding: 0.4rem 0.6rem;
          outline: none;
          font-size: 0.9rem;
          min-width: 0;
        }
        .inp:focus {
          box-shadow: 0 0 0 2px rgba(238, 114, 3, 0.5);
        }
        html,
        body,
        #__next {
          max-width: 100%;
          overflow-x: hidden;
        }
        td > div,
        th,
        .break-words {
          word-break: break-word;
          overflow-wrap: anywhere;
        }
        td.sticky,
        th.sticky {
          backdrop-filter: blur(2px);
        }
        .dropdown-panel {
          max-height: 16rem;
          overflow-y: auto;
          overscroll-behavior: contain;
        }
        .dropdown-item {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
      `}</style>
    </div>
  );
}

/* ================= helpers UI ================= */
function Th({ children, className = "" }) {
  const isSticky = className.includes("sticky");
  return (
    <th
      className={[
        "px-2 py-2 text-left",
        isSticky
          ? "bg-white/5 backdrop-blur supports-[backdrop-filter]:bg-white/5"
          : "",
        className,
      ]
        .join(" ")
        .trim()}
    >
      {children}
    </th>
  );
}
function Td({ children, className = "", stickyBg = false }) {
  const isSticky = className.includes("sticky");
  const baseBg = stickyBg ? "bg-[#0E2533]" : "";
  return (
    <td
      className={[
        "px-2 py-2 align-top",
        isSticky ? "shadow-[1px_0_0_0_rgba(255,255,255,0.06)]" : "",
        baseBg,
        className,
      ]
        .join(" ")
        .trim()}
    >
      <div className="truncate">{children}</div>
    </td>
  );
}

function IconBtn({ onClick, icon, label, danger, title }) {
  return (
    <button
      onClick={onClick}
      title={title || label}
      className={[
        "group inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium",
        danger
          ? "bg-red-500/15 text-red-300 hover:bg-red-500/25 focus-visible:ring-red-400/50"
          : "bg-white/10 text-white hover:bg-white/15 focus-visible:ring-white/40",
        "outline-none focus-visible:ring-2 transition",
      ].join(" ")}
      aria-label={label}
    >
      <span className="grid place-items-center">{icon}</span>
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function IconGhost({ onClick, title, ariaLabel, children }) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={ariaLabel || title}
      className="shrink-0 grid place-items-center w-6 h-6 rounded-md text-white/80 hover:text-white hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/40 outline-none transition"
    >
      {children}
    </button>
  );
}

function PageBtn({ children, onClick, disabled }) {
  return (
    <button
      className="px-2 py-1 rounded-md bg-white/10 hover:bg-white/15 disabled:opacity-50 text-sm"
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
function Dot({ ok }) {
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${
        ok ? "bg-emerald-400" : "bg-white/30"
      }`}
    />
  );
}
function Field({ label, required, children }) {
  return (
    <label className="text-sm block">
      <span className="block mb-1 text-white/70">
        {label} {required && <span className="text-red-400">*</span>}
      </span>
      {children}
    </label>
  );
}
function LabelPill({ label, children }) {
  return (
    <div
      className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-2 py-1"
      title={label}
    >
      <span className="text-xs text-white/70">{label}</span>
      {children}
    </div>
  );
}
function Info({ label, value }) {
  return (
    <div
      className="bg-white/5 rounded-lg p-2 border border-white/10"
      title={`${label}: ${value}`}
    >
      <div className="text-[11px] text-white/60">{label}</div>
      <div className="text-sm truncate">{value}</div>
    </div>
  );
}

/* --- Toggle compacto --- */
function TogglePill({ checked, onChange, disabled = false }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-disabled={disabled}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`relative h-6 w-12 rounded-full transition ring-1 ${
        disabled
          ? "opacity-50 cursor-not-allowed ring-white/10 bg-white/5"
          : checked
          ? "bg-gradient-to-r from-[#EE7203] to-[#FF3816] ring-white/20"
          : "bg-white/10 hover:bg-white/15 ring-white/10"
      }`}
      title={checked ? "Activado" : "Desactivado"}
    >
      <span
        className={`absolute top-1 left-1 h-4 w-4 rounded-full bg-white transition-transform shadow ${
          checked ? "translate-x-6" : "translate-x-0"
        }`}
      />
    </button>
  );
}

/* ====== Selectores ====== */
function ProviderSelect({
  value,
  onChange,
  options = [],
  placeholder = "Proveedor...",
}) {
  return (
    <BaseSelect
      value={value}
      onChange={onChange}
      options={options}
      placeholder={placeholder}
      createLabel="+ Crear proveedor"
      clearLabel="Limpiar proveedor"
      useTitlePrefix="Usar proveedor: "
    />
  );
}
function CategorySelect({
  value,
  onChange,
  options = [],
  placeholder = "Tipo de producto...",
}) {
  return (
    <BaseSelect
      value={value}
      onChange={onChange}
      options={options}
      placeholder={placeholder}
      createLabel="+ Crear tipo"
      clearLabel="Limpiar tipo"
      useTitlePrefix="Usar tipo: "
    />
  );
}
function BaseSelect({
  value,
  onChange,
  options = [],
  placeholder,
  createLabel,
  clearLabel,
  useTitlePrefix,
}) {
  const [open, setOpen] = useState(false);
  const [modeCreate, setModeCreate] = useState(false);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");

  const filtered = useMemo(() => {
    const t = search.trim().toLowerCase();
    if (!t) return options;
    return options.filter((o) => o.toLowerCase().includes(t));
  }, [options, search]);

  function pick(val) {
    onChange(val);
    setOpen(false);
    setModeCreate(false);
    setSearch("");
    setDraft("");
  }
  function handleCreate() {
    const v = (draft || "").trim();
    if (!v) return;
    pick(v);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inp w-full flex items-center justify-between"
        title={`Seleccioná o creá — ${placeholder}`}
      >
        <span className={`truncate ${value ? "" : "text-white/50"}`}>
          {value || placeholder}
        </span>
        <svg
          className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`}
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path d="M5.5 7l4.5 4 4.5-4" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 inset-x-0 rounded-lg border border-white/10 bg-[#0E2533] shadow-xl dropdown-panel">
          <div className="p-2 border-b border-white/10">
            {!modeCreate ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setModeCreate(true);
                    setDraft("");
                    setSearch("");
                  }}
                  className="px-2 py-1 rounded-md bg-white/10 hover:bg-white/15 text-xs whitespace-nowrap"
                  title={createLabel}
                >
                  {createLabel}
                </button>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={`Buscar…`}
                  className="flex-1 inp !py-1.5 !text-sm"
                  title="Buscá por nombre"
                />
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Nuevo nombre…"
                  className="flex-1 inp !py-1.5 !text-sm"
                  title="Escribí el nuevo nombre"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreate();
                    if (e.key === "Escape") setModeCreate(false);
                  }}
                />
                <button
                  type="button"
                  onClick={handleCreate}
                  className="px-2.5 py-1.5 rounded-md bg-gradient-to-r from-[#EE7203] to-[#FF3816] text-xs font-medium"
                  title="Crear"
                >
                  Crear
                </button>
                <button
                  type="button"
                  onClick={() => setModeCreate(false)}
                  className="px-2 py-1 rounded-md bg-white/10 hover:bg-white/15 text-xs"
                  title="Cancelar"
                >
                  Cancelar
                </button>
              </div>
            )}
          </div>

          {!modeCreate && (
            <div className="py-1">
              {filtered.length === 0 ? (
                <div className="px-3 py-2 text-white/50 text-sm">
                  Sin resultados
                </div>
              ) : (
                filtered.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => pick(opt)}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-white/10 ${
                      value === opt ? "bg-white/5" : ""
                    } dropdown-item`}
                    title={`${useTitlePrefix}${opt}`}
                  >
                    {opt}
                  </button>
                ))
              )}
            </div>
          )}

          {!modeCreate && (
            <div className="p-2 border-t border-white/10 flex items-center justify-between">
              <button
                type="button"
                onClick={() => pick("")}
                className="text-xs text-white/70 hover:text-white"
                title={clearLabel}
              >
                {clearLabel}
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-xs bg-white/10 hover:bg-white/15 px-2 py-1 rounded-md"
                title="Cerrar selector"
              >
                Cerrar
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ================= helpers data ================= */
function blankProduct() {
  return {
    name: "",
    sku: "",
    category: "",
    provider: "",
    description: "",
    cost: "",
    ivaCompras: "",
    price: "",
    ivaVentas: "",
    stockPv1: 0,
    stockPv2: 0,
    minStock: 0,
    showInSales: true,
    showInPurchases: true,
    taxable: true,
    enabled: true,
    priceDiscount: "",
    discountActive: false,
  };
}
function normalizeForSave(f) {
  return {
    name: (f.name || "").trim(),
    sku: (f.sku || "").trim(),
    category: (f.category || "").trim(),
    provider: (f.provider || "").trim(),
    description: (f.description || "").trim(),
    cost: toNum(f.cost),
    ivaCompras: toNum(f.ivaCompras || 0),
    price: toNum(f.price),
    ivaVentas: toNum(f.ivaVentas || 0),
    stockPv1: toInt(f.stockPv1),
    stockPv2: toInt(f.stockPv2),
    minStock: toInt(f.minStock),
    showInSales: !!f.showInSales,
    showInPurchases: !!f.showInPurchases,
    taxable: !!f.taxable,
    enabled: f.enabled !== false,
    priceDiscount: toNum(f.priceDiscount || 0),
    discountActive: !!f.discountActive && toNum(f.priceDiscount) > 0,
  };
}
function validate(p) {
  if (!p.name) throw new Error("El nombre es obligatorio");
  if (p.price < 0) throw new Error("El precio de venta no puede ser negativo");
  if (p.discountActive && p.priceDiscount <= 0)
    throw new Error("Precio con descuento inválido");
  if (p.discountActive && p.priceDiscount >= p.price)
    throw new Error("El descuento debe ser menor al precio de venta");
}
function finalPriceContado(p) {
  return p.discountActive && p.priceDiscount > 0 ? p.priceDiscount : p.price;
}
function money(n) {
  if (typeof n !== "number" || isNaN(n) || n === 0)
    return n === 0 ? "$ 0,00" : "-";
  return n.toLocaleString("es-AR", { style: "currency", currency: "ARS" });
}
const toNum = (v) => {
  const n = parseFloat(String(v).replace(",", "."));
  if (isNaN(n)) return 0;
  return Math.round(n * 100) / 100;
};
const toInt = (v) => parseInt(v || 0, 10);
const toStr = (n) => (n === 0 || n ? String(n) : "");
const toStrInt = (n) => (n === 0 || n ? String(n) : "");
const pad6 = (v) => String(v).replace(/\D/g, "").padStart(6, "0");

// ====== aplanar docs de productos ======
function flattenProducts(docs) {
  const out = [];
  for (const d of docs) {
    for (const [k, v] of Object.entries(d.data)) {
      if (!k.startsWith("p_")) continue;
      if (v && typeof v === "object")
        out.push({ ...v, id: v.id, chunkDoc: v.chunkDoc || d.id });
    }
  }
  return out.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}

// ====== elegir doc con espacio (lectura local) ======
function pickChunkDoc(docs) {
  for (const d of docs) {
    const count = Object.keys(d.data).filter((k) => k.startsWith("p_")).length;
    if (count < CHUNK_LIMIT) return { id: d.id, isNew: false };
  }
  const next = String(docs.length + 1).padStart(3, "0");
  return { id: next, isNew: true };
}

/* ====== generar id único legible (ya no se usa para crear) ====== */
function generateId(existingItems) {
  const nums = existingItems
    .map((p) => parseInt(String(p.id).replace(/\D/g, ""), 10))
    .filter((n) => !isNaN(n));
  const next = nums.length ? Math.max(...nums) + 1 : 1;
  return String(next).padStart(6, "0");
}

/* ====== ID helpers para contador local ====== */
function parseIdNum(v) {
  const n = parseInt(String(v).replace(/\D/g, ""), 10);
  return isNaN(n) ? 0 : n;
}
function computeMaxId(items, docsSnap) {
  let max = 0;
  for (const it of items || []) {
    max = Math.max(max, parseIdNum(it?.id));
  }
  for (const d of docsSnap || []) {
    const data = d?.data || {};
    for (const k of Object.keys(data)) {
      if (!k.startsWith("p_")) continue;
      const v = data[k];
      const candidate = parseIdNum(v?.id || k.slice(2));
      max = Math.max(max, candidate);
    }
  }
  return max;
}

/* ===================== Helpers Excel/CSV ===================== */
function normHeader(h) {
  if (!h) return "";
  const s = String(h)
    .replace(/^\uFEFF/, "")
    .trim()
    .replace(/\s+/g, " ");
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function toBoolOpt(v) {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim().toLowerCase();
  if (s === "") return undefined;
  if (["si", "sí", "true", "1"].includes(s)) return true;
  if (["no", "false", "0"].includes(s)) return false;
  return undefined;
}

function toNumberFlexible(v) {
  if (v === null || v === undefined || v === "") return 0;
  const s = String(v).trim().replace(/\./g, "").replace(",", ".");
  const n = parseFloat(s);
  if (isNaN(n)) return 0;
  return Math.round(n * 100) / 100;
}
function toIntFlexible(v) {
  const s = String(v ?? "")
    .trim()
    .replace(/[^\d-]/g, "");
  const n = parseInt(s || "0", 10);
  return isNaN(n) ? 0 : n;
}
function safeStr(v) {
  return (v == null ? "" : String(v)).trim();
}

function mapRowToProductModel(row) {
  const get = (key) => row[key] ?? "";

  const id = safeStr(get("id"));
  const nombre = safeStr(get("nombre"));
  const tipoProducto = safeStr(get("tipo de producto"));
  const proveedor = safeStr(get("proveedor"));
  const codigo = safeStr(get("codigo"));
  const stock = get("stock");
  const costo = get("costo");
  const ivaC = get("iva compras");
  const precioVenta = get("precio de venta");
  const ivaV = get("iva ventas");
  const descripcion = safeStr(get("descripcion"));
  const activo = get("activo");
  const showSales = get("mostrar en ventas");
  const showPurchases = get("mostrar en compras");

  return {
    id: id || null,
    name: nombre,
    category: tipoProducto,
    provider: proveedor,
    sku: codigo,
    stockPv1: toIntFlexible(stock),
    stockPv2: 0,
    minStock: 0,
    cost: toNumberFlexible(costo),
    ivaCompras: toNumberFlexible(ivaC),
    price: toNumberFlexible(precioVenta),
    ivaVentas: toNumberFlexible(ivaV),
    description: descripcion,
    enabled: toBoolOpt(activo),
    showInSales: toBoolOpt(showSales),
    showInPurchases: toBoolOpt(showPurchases),
    priceDiscount: 0,
    discountActive: false,
    taxable: true,
  };
}

function fmtTitle(label, value) {
  const v = value == null || value === "" ? "-" : String(value);
  return `${label}: ${v}`;
}

function makeNextIdCounter(used) {
  const set = new Set(used);
  let seq = 1;
  return function next() {
    let id = pad6(seq++);
    while (set.has(id)) id = pad6(seq++);
    set.add(id);
    return id;
  };
}
function makeNextChunkName(existingIds = []) {
  const taken = new Set(existingIds);
  return function next() {
    let i = 1;
    while (true) {
      const id = String(i).padStart(3, "0");
      if (!taken.has(id)) {
        taken.add(id);
        return id;
      }
      i++;
    }
  };
}
