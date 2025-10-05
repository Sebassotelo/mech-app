// src/componentes/dashboard/inventario/Inventario.jsx
"use client";
import React, { useContext, useMemo, useState, useEffect } from "react";
import { toast } from "sonner";
import ContextGeneral from "@/servicios/contextGeneral";
import {
  doc,
  setDoc,
  updateDoc,
  serverTimestamp,
  deleteField,
} from "firebase/firestore";

const CHUNK_LIMIT = 200; // capacidad por documento

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

  // ===== Estado UI =====
  const [qtext, setQtext] = useState("");
  const [onlyActive, setOnlyActive] = useState(true);
  const [onlyWithStock, setOnlyWithStock] = useState(false);
  const [onlyLow, setOnlyLow] = useState(false);
  const [lowThreshold, setLowThreshold] = useState(3);

  // Modal Crear/Editar
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blankProduct());

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

  useEffect(() => {
    setPage(1);
  }, [
    qtext,
    onlyActive,
    onlyWithStock,
    onlyLow,
    lowThreshold,
    items,
    pageSize,
  ]);

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
          const pick = pickChunkDoc(docsSnap);
          const newId = generateId(items);
          const docRef = doc(firestore, "productos", pick.id);
          const dataToWrite = {
            ...payload,
            id: newId,
            chunkDoc: pick.id,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          };
          if (pick.isNew) await setDoc(docRef, {});
          await updateDoc(docRef, { [`p_${newId}`]: dataToWrite });
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

  // ===== Import =====
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

      setImp((s) => ({ ...s, total: mapped.length }));

      let created = 0;
      let updated = 0;
      let processed = 0;

      for (const r of mapped) {
        const payload = normalizeForSave({
          ...blankProduct(),
          name: r.name,
          sku: r.sku,
          category: r.category,
          provider: r.provider,
          price: r.price,
          cost: r.cost,
          stockPv1: r.stockPv1,
          stockPv2: r.stockPv2 ?? 0,
          minStock: r.minStock ?? 0,
          taxable: r.taxable ?? true,
          enabled: r.enabled,
          description: r.description,
          ivaCompras: r.ivaCompras,
          ivaVentas: r.ivaVentas,
          showInSales: r.showInSales,
          showInPurchases: r.showInPurchases,
          priceDiscount: r.priceDiscount ?? 0,
          discountActive: r.discountActive ?? false,
        });
        validate(payload);

        const desiredId = r.id ? pad6(r.id) : nextIdCounter();
        const existing = byId.get(desiredId);

        if (existing) {
          const docRef = doc(firestore, "productos", existing.chunkDoc);
          await updateDoc(docRef, {
            [`p_${existing.id}`]: {
              ...existing,
              ...payload,
              id: existing.id,
              chunkDoc: existing.chunkDoc,
              updatedAt: serverTimestamp(),
            },
          });
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
            const createRef = doc(firestore, "productos", targetDocId);
            await setDoc(createRef, {});
          }

          const docRef = doc(firestore, "productos", targetDocId);
          const dataToWrite = {
            ...payload,
            id: desiredId,
            chunkDoc: targetDocId,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          };
          await updateDoc(docRef, { [`p_${desiredId}`]: dataToWrite });

          byId.set(desiredId, dataToWrite);
          usedIds.add(desiredId);
          created++;
        }

        processed++;
        setImp((s) => ({ ...s, processed, created, updated }));
      }

      toast.success(
        `Importación OK — Creados: ${created} · Actualizados: ${updated}`
      );
    } catch (e) {
      console.error(e);
      setImp((s) => ({ ...s, error: e?.message || "Error al importar" }));
      toast.error(e?.message || "No se pudo importar el Excel");
    } finally {
      setTimeout(() => {
        setImp((s) => ({ ...s, running: false }));
      }, 500);
    }
  }

  // ===== Export CSV =====
  function handleExportCSV() {
    const headers = [
      "Id",
      "Nombre",
      "Tipo de Producto",
      "Proveedor",
      "Código",
      "Stock",
      "Costo",
      "IVA Compras",
      "Precio de Venta",
      "IVA Ventas",
      "Descripción",
      "Activo",
      "Mostrar en Ventas",
      "Mostrar en Compras",
    ];

    const rows = (filtered.length ? filtered : items).map((p) => [
      safeCSV(p.id),
      safeCSV(p.name),
      safeCSV(p.category),
      safeCSV(p.provider),
      safeCSV(p.sku),
      String(p.stockPv1 ?? 0),
      numOut(p.cost),
      numOut(p.ivaCompras),
      numOut(finalPriceContado(p)),
      numOut(p.ivaVentas),
      safeCSV(p.description),
      boolOut(p.enabled !== false),
      boolOut(!!p.showInSales),
      boolOut(!!p.showInPurchases),
    ]);

    const csv =
      headers.join(",") + "\n" + rows.map((r) => r.join(",")).join("\n");

    const blob = new Blob(["\uFEFF" + csv], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `productos_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ===== UI =====
  return (
    <div className="space-y-4 overflow-x-hidden max-w-full">
      {/* Controles */}
      <div className="flex flex-col md:flex-row gap-2 md:items-center md:justify-between min-w-0">
        <div className="flex flex-wrap gap-2 items-center min-w-0">
          <input
            value={qtext}
            onChange={(e) => setQtext(e.target.value)}
            placeholder="Buscar por nombre, código, categoría, proveedor o descripción…"
            className="w-full md:w-80 rounded-lg bg-[#0C212D] border border-white/10 px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[#EE7203]/70"
          />

          {/* Activables compactos */}
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
                onChange={(e) =>
                  setLowThreshold(
                    Math.max(0, parseInt(e.target.value || "0", 10))
                  )
                }
                className="w-14 rounded-lg bg-[#0C212D] border border-white/10 px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[#EE7203]/70"
              />
            </div>
          </LabelPill>

          {/* Page size selector */}
          <LabelPill label="Ver">
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
          </LabelPill>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {/* Import Excel */}
          <label className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 cursor-pointer text-sm">
            Importar (.xlsx)
            <input
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.csv,text/csv"
              onChange={handleImportExcel}
              className="hidden"
            />
          </label>

          {/* Export CSV */}
          <button
            onClick={handleExportCSV}
            className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-sm"
          >
            Exportar CSV
          </button>

          <button
            onClick={openCreate}
            className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-[#EE7203] to-[#FF3816] text-sm font-medium shadow hover:opacity-95"
          >
            Nuevo
          </button>
        </div>
      </div>

      {/* Loader/Progreso de import */}
      {imp.running && (
        <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm">
          <div className="flex items-center justify-between mb-2">
            <div className="font-medium">Importando: {imp.filename}</div>
            <div className="text-white/70">
              {imp.processed}/{imp.total} · Creados {imp.created}{" "}
              ·&nbsp;Actualizados {imp.updated}
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
                <div className="min-w-0">
                  <h4 className="font-semibold leading-tight break-words">
                    {p.name || "-"}
                  </h4>
                  <p className="text-xs text-white/60">
                    <span className="font-mono">{p.sku || "-"}</span> •{" "}
                    {p.category || "-"}
                  </p>
                </div>
                <span
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
                <Btn onClick={() => openEdit(p)}>Editar</Btn>
                <Btn danger onClick={() => handleDelete(p)}>
                  Eliminar
                </Btn>
              </div>
            </article>
          ))
        )}
      </div>

      {/* ====== TABLA (md+) ====== */}
      <div className="hidden md:block rounded-xl border border-white/10">
        <div className="max-w-full overflow-x-auto overscroll-x-contain">
          <table className="w-full text-sm md:table-fixed">
            <thead className="bg-white/5 text-white/70">
              <tr>
                <Th className="md:w-32">Código</Th>
                <Th className="md:w-64">Nombre</Th>
                <Th className="md:w-48 hidden lg:table-cell">Tipo</Th>
                <Th className="md:w-56 hidden xl:table-cell">Proveedor</Th>
                <Th className="md:w-24 text-right whitespace-nowrap">Costo</Th>
                <Th className="md:w-20 text-right whitespace-nowrap hidden lg:table-cell">
                  IVA C.
                </Th>
                <Th className="md:w-24 text-right whitespace-nowrap">Precio</Th>
                <Th className="md:w-20 text-right whitespace-nowrap hidden lg:table-cell">
                  IVA V.
                </Th>
                <Th className="md:w-24 text-right whitespace-nowrap">
                  Stock PV1
                </Th>
                <Th className="md:w-24 text-right whitespace-nowrap">
                  Stock PV2
                </Th>
                <Th className="md:w-24 text-center hidden xl:table-cell">
                  Vtas
                </Th>
                <Th className="md:w-24 text-center hidden xl:table-cell">
                  Cpras
                </Th>
                <Th className="md:w-20 text-center">Activo</Th>
                <Th className="md:w-32 text-center">Acciones</Th>
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
                    <Td className="truncate">{p.sku || "-"}</Td>
                    <Td className="truncate md:max-w-[240px] lg:max-w-none break-words">
                      {p.name}
                    </Td>
                    <Td className="truncate hidden lg:table-cell">
                      {p.category || "-"}
                    </Td>
                    <Td className="truncate hidden xl:table-cell">
                      {p.provider || "-"}
                    </Td>
                    <Td className="text-right whitespace-nowrap">
                      {money(p.cost)}
                    </Td>
                    <Td className="text-right hidden lg:table-cell">
                      {p.ivaCompras ?? "-"}
                    </Td>
                    <Td className="text-right whitespace-nowrap">
                      {money(finalPriceContado(p))}
                    </Td>
                    <Td className="text-right hidden lg:table-cell">
                      {p.ivaVentas ?? "-"}
                    </Td>
                    <Td className="text-right">{p.stockPv1 ?? 0}</Td>
                    <Td className="text-right">{p.stockPv2 ?? 0}</Td>
                    <Td className="text-center hidden xl:table-cell">
                      <Dot ok={!!p.showInSales} />
                    </Td>
                    <Td className="text-center hidden xl:table-cell">
                      <Dot ok={!!p.showInPurchases} />
                    </Td>
                    <Td className="text-center">
                      <Dot ok={p.enabled !== false} />
                    </Td>
                    <Td className="text-center">
                      <div className="flex items-center justify-center gap-1.5 flex-wrap">
                        <Btn onClick={() => openEdit(p)}>Editar</Btn>
                        <Btn danger onClick={() => handleDelete(p)}>
                          Eliminar
                        </Btn>
                      </div>
                    </Td>
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
          <div className="w-full max-w-3xl rounded-xl bg-[#112C3E] border border-white/10 shadow-2xl max-h-[85vh] overflow-y-auto">
            <div className="p-4 border-b border-white/10 flex items-center justify-between sticky top-0 bg-[#112C3E]/95 backdrop-blur">
              <h3 className="font-semibold text-base">
                {editing ? "Editar producto" : "Nuevo producto"}
              </h3>
              <button
                onClick={() => setOpen(false)}
                className="text-white/60 hover:text-white"
                aria-label="Cerrar"
              >
                ×
              </button>
            </div>

            <form
              onSubmit={handleSave}
              className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3"
            >
              <Field label="Nombre" required>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="inp"
                  placeholder="Aceite 5W30"
                />
              </Field>
              <Field label="Código">
                <input
                  value={form.sku}
                  onChange={(e) =>
                    setForm({ ...form, sku: e.target.value.toUpperCase() })
                  }
                  className="inp"
                  placeholder="COD-001"
                />
              </Field>
              <Field label="Tipo de Producto">
                <input
                  value={form.category}
                  onChange={(e) =>
                    setForm({ ...form, category: e.target.value })
                  }
                  className="inp"
                  placeholder="Lubricantes"
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
                />
              </Field>

              <div className="md:col-span-3 flex items-center justify-end gap-1.5 pt-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-sm"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-[#EE7203] to-[#FF3816] text-sm font-medium"
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
          min-width: 0; /* evita overflow en flex */
        }
        .inp:focus {
          box-shadow: 0 0 0 2px rgba(238, 114, 3, 0.5);
        }
        /* Evita overflow por palabras largas */
        td > div,
        th,
        .break-words {
          word-break: break-word;
          overflow-wrap: anywhere;
        }
      `}</style>
    </div>
  );
}

/* ================= helpers UI ================= */
function Th({ children, className = "" }) {
  return <th className={`px-2.5 py-2 text-left ${className}`}>{children}</th>;
}
function Td({ children, className = "" }) {
  return (
    <td className={`px-2.5 py-2 align-top ${className}`}>
      <div className="truncate">{children}</div>
    </td>
  );
}
function Btn({ children, onClick, danger }) {
  return (
    <button
      onClick={onClick}
      className={`px-2 py-1 rounded-md text-xs ${
        danger
          ? "bg-red-500/20 text-red-300 hover:bg-red-500/30"
          : "bg-white/10 hover:bg-white/15"
      }`}
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
    <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-2 py-1">
      <span className="text-xs text-white/70">{label}</span>
      {children}
    </div>
  );
}
function Info({ label, value }) {
  return (
    <div className="bg-white/5 rounded-lg p-2 border border-white/10">
      <div className="text-[11px] text-white/60">{label}</div>
      <div className="text-sm">{value}</div>
    </div>
  );
}

/* --- Toggle más compacto --- */
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
      title={checked ? "ON" : "OFF"}
    >
      <span
        className={`absolute top-1 left-1 h-4 w-4 rounded-full bg-white transition-transform shadow ${
          checked ? "translate-x-6" : "translate-x-0"
        }`}
      />
    </button>
  );
}

/* ====== Selector de Proveedor ====== */
function ProviderSelect({
  value,
  onChange,
  options = [],
  placeholder = "Proveedor...",
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
        <div className="absolute z-50 mt-1 w-[min(92vw,32rem)] rounded-lg border border-white/10 bg-[#0E2533] shadow-xl">
          {/* Header */}
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
                  className="px-2 py-1 rounded-md bg-white/10 hover:bg-white/15 text-xs"
                >
                  + Crear proveedor
                </button>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar proveedor…"
                  className="flex-1 inp !py-1.5 !text-sm"
                />
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Nombre del nuevo proveedor"
                  className="flex-1 inp !py-1.5 !text-sm"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreate();
                    if (e.key === "Escape") setModeCreate(false);
                  }}
                />
                <button
                  type="button"
                  onClick={handleCreate}
                  className="px-2.5 py-1.5 rounded-md bg-gradient-to-r from-[#EE7203] to-[#FF3816] text-xs font-medium"
                >
                  Crear
                </button>
                <button
                  type="button"
                  onClick={() => setModeCreate(false)}
                  className="px-2 py-1 rounded-md bg-white/10 hover:bg-white/15 text-xs"
                >
                  Cancelar
                </button>
              </div>
            )}
          </div>

          {/* Lista */}
          {!modeCreate && (
            <div className="max-h-56 overflow-auto py-1">
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
                    }`}
                  >
                    {opt}
                  </button>
                ))
              )}
            </div>
          )}

          {/* Footer */}
          {!modeCreate && (
            <div className="p-2 border-t border-white/10 flex items-center justify-between">
              <button
                type="button"
                onClick={() => pick("")}
                className="text-xs text-white/70 hover:text-white"
              >
                Limpiar proveedor
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-xs bg-white/10 hover:bg-white/15 px-2 py-1 rounded-md"
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

const safeCSV = (s) => {
  const str = s == null ? "" : String(s);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
};
const numOut = (n) =>
  typeof n === "number" ? String(n).replace(".", ",") : "";
const boolOut = (b) => (b ? "SI" : "NO");

/* ====== aplanar docs de productos ====== */
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

/* ====== elegir doc con espacio ====== */
function pickChunkDoc(docs) {
  for (const d of docs) {
    const count = Object.keys(d.data).filter((k) => k.startsWith("p_")).length;
    if (count < CHUNK_LIMIT) return { id: d.id, isNew: false };
  }
  const next = String(docs.length + 1).padStart(3, "0");
  return { id: next, isNew: true };
}

/* ====== generar id único legible ====== */
function generateId(existingItems) {
  const nums = existingItems
    .map((p) => parseInt(String(p.id).replace(/\D/g, ""), 10))
    .filter((n) => !isNaN(n));
  const next = nums.length ? Math.max(...nums) + 1 : 1;
  return String(next).padStart(6, "0");
}

/* ====== helpers para import ====== */
function makeNextIdCounter(usedIds) {
  let current = 1;
  for (const id of usedIds) {
    const n = parseInt(String(id).replace(/\D/g, ""), 10);
    if (!isNaN(n) && n >= current) current = n + 1;
  }
  return () => {
    while (usedIds.has(pad6(current))) current++;
    const id = pad6(current);
    usedIds.add(id);
    current++;
    return id;
  };
}
function makeNextChunkName(existingIds) {
  let max = 0;
  for (const id of existingIds) {
    const n = parseInt(id, 10);
    if (!isNaN(n) && n > max) max = n;
  }
  return () => {
    max = max + 1;
    return String(max).padStart(3, "0");
  };
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
function toBool(v) {
  if (v === null || v === undefined) return false;
  const s = String(v).trim().toLowerCase();
  if (["si", "sí", "true", "1"].includes(s)) return true;
  if (["no", "false", "0"].includes(s)) return false;
  return false;
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

/* Mapea fila Excel a modelo de producto */
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
    enabled: toBool(activo),
    showInSales: toBool(showSales),
    showInPurchases: toBool(showPurchases),
    priceDiscount: 0,
    discountActive: false,
    taxable: true,
  };
}
