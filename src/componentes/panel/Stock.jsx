"use client";
import React, { useContext, useMemo, useState } from "react";
import ContextGeneral from "@/servicios/contextGeneral";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { toast } from "sonner";

const PAGE_SIZES = [10, 25, 50, 100];

export default function Stock({ location = "pv1" }) {
  const ctx = useContext(ContextGeneral);
  const firestore = ctx?.firestore;

  // 🔐 Permisos
  const permisos = Array.isArray(ctx?.permisos) ? ctx.permisos : [];
  const isAdmin4 = permisos.includes(4);
  const canEdit = isAdmin4;

  // Productos desde Context (sin lecturas aquí)
  const itemsCtx = Array.isArray(ctx?.productos) ? ctx.productos : [];
  const docsSnap = Array.isArray(ctx?.productosDocs) ? ctx.productosDocs : [];
  const loading = ctx?.loader === true && itemsCtx.length === 0;

  const items = useMemo(() => {
    if (itemsCtx?.length) return itemsCtx;
    if (docsSnap?.length) return flattenProducts(docsSnap);
    return [];
  }, [itemsCtx, docsSnap]);

  const stockField = location === "pv2" ? "stockPv2" : "stockPv1";

  // UI state
  const [q, setQ] = useState("");
  const [onlyActive, setOnlyActive] = useState(true);
  const [onlyWithStock, setOnlyWithStock] = useState(false);
  const [onlyLow, setOnlyLow] = useState(false);
  const [lowThreshold, setLowThreshold] = useState(3);
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);
  const [drafts, setDrafts] = useState({}); // { [id]: { stockPv1?, stockPv2?, minStock? } }

  // Derivados
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    let arr = items.filter((p) => {
      const inTxt =
        !t ||
        p.name?.toLowerCase().includes(t) ||
        p.sku?.toLowerCase().includes(t) ||
        p.category?.toLowerCase().includes(t) ||
        p.provider?.toLowerCase?.().includes(t);
      const activeOk = !onlyActive || p.enabled !== false;
      const withStockOk =
        !onlyWithStock || Number.parseInt(p?.[stockField] ?? 0, 10) > 0;
      const lowOk =
        !onlyLow ||
        Number.parseInt(p?.[stockField] ?? 0, 10) <= Number(lowThreshold || 0);
      return inTxt && activeOk && withStockOk && lowOk;
    });
    // orden
    if (onlyLow) {
      arr.sort(
        (a, b) => Number(a?.[stockField] ?? 0) - Number(b?.[stockField] ?? 0)
      );
    } else {
      arr.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    }
    return arr;
  }, [items, q, onlyActive, onlyWithStock, onlyLow, lowThreshold, stockField]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageSafe = Math.min(page, totalPages);
  const slice = filtered.slice((pageSafe - 1) * pageSize, pageSafe * pageSize);

  function setDraft(id, field, value) {
    setDrafts((d) => ({
      ...d,
      [id]: { ...(d[id] || {}), [field]: value },
    }));
  }

  function hasDraft(id) {
    return drafts[id] && Object.keys(drafts[id]).length > 0;
  }

  async function saveRow(prod) {
    if (!canEdit) {
      toast.error("Solo el Admin General (nivel 4) puede modificar stock");
      return;
    }
    if (!firestore) return toast.error("Firestore no disponible");
    const d = drafts[prod.id];
    if (!d) return;
    const patch = {};
    const docRef = doc(firestore, "productos", prod.chunkDoc);

    function parseIntSafe(v) {
      const n = parseInt(String(v ?? "").replace(/[^\d-]/g, ""), 10);
      return Number.isFinite(n) ? n : 0;
    }

    if (d.stockPv1 != null)
      patch[`p_${prod.id}.stockPv1`] = parseIntSafe(d.stockPv1);
    if (d.stockPv2 != null)
      patch[`p_${prod.id}.stockPv2`] = parseIntSafe(d.stockPv2);
    if (d.minStock != null)
      patch[`p_${prod.id}.minStock`] = parseIntSafe(d.minStock);

    patch[`p_${prod.id}.updatedAt`] = serverTimestamp();

    try {
      await toast.promise(updateDoc(docRef, patch), {
        loading: "Guardando stock…",
        success: "Stock actualizado",
        error: "No se pudo actualizar el stock",
      });

      // Optimista en memoria del Context
      if (typeof ctx?.setProductos === "function") {
        ctx.setProductos((prev = []) =>
          prev.map((p) =>
            p.id === prod.id
              ? {
                  ...p,
                  stockPv1:
                    d.stockPv1 != null ? parseIntSafe(d.stockPv1) : p.stockPv1,
                  stockPv2:
                    d.stockPv2 != null ? parseIntSafe(d.stockPv2) : p.stockPv2,
                  minStock:
                    d.minStock != null ? parseIntSafe(d.minStock) : p.minStock,
                }
              : p
          )
        );
      }
      setDrafts((x) => {
        const { [prod.id]: _, ...rest } = x;
        return rest;
      });
    } catch (e) {
      console.error(e);
    }
  }

  function adjust(id, field, delta) {
    if (!canEdit) {
      toast.error("Solo el Admin General (nivel 4) puede modificar stock");
      return;
    }
    const current =
      drafts[id]?.[field] ?? items.find((p) => p.id === id)?.[field] ?? 0;
    const next = Math.max(0, parseInt(current, 10) + delta);
    setDraft(id, field, String(next));
  }

  return (
    <div className="space-y-4 overflow-x-hidden max-w-full">
      {/* Aviso permisos */}
      {!canEdit && (
        <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-white/80">
          Vista <b>solo lectura</b>. Solo el usuario con permiso{" "}
          <b>4 (Admin General)</b> puede editar stock y mínimos.
        </div>
      )}

      {/* Controles */}
      <div className="flex flex-col lg:flex-row gap-3 lg:items-center lg:justify-between min-w-0">
        <div className="flex flex-wrap gap-2 items-center min-w-0">
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            placeholder="Buscar por nombre, SKU, categoría o proveedor…"
            className="w-full md:w-80 rounded-xl bg-[#0C212D] border border-white/10 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#EE7203]/70"
          />

          <label className="inline-flex items-center gap-2 text-sm text-white/80">
            <input
              type="checkbox"
              checked={onlyActive}
              onChange={(e) => setOnlyActive(e.target.checked)}
              className="accent-[#EE7203]"
            />
            Solo activos
          </label>
          <label className="inline-flex items-center gap-2 text-sm text-white/80">
            <input
              type="checkbox"
              checked={onlyWithStock}
              onChange={(e) => setOnlyWithStock(e.target.checked)}
              className="accent-[#EE7203]"
            />
            Solo con stock ({location.toUpperCase()})
          </label>
          <label className="inline-flex items-center gap-2 text-sm text-white/80">
            <input
              type="checkbox"
              checked={onlyLow}
              onChange={(e) => setOnlyLow(e.target.checked)}
              className="accent-[#EE7203]"
            />
            Solo bajo stock (≤)
          </label>
          <input
            type="number"
            min={0}
            value={lowThreshold}
            onChange={(e) =>
              setLowThreshold(Math.max(0, parseInt(e.target.value || "0", 10)))
            }
            className="w-16 rounded-xl bg-[#0C212D] border border-white/10 px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-[#EE7203]/70"
          />
          <span className="text-xs text-white/60 ml-1">
            Sede: <b>{location.toUpperCase()}</b>
          </span>
        </div>

        {/* Paginación: tamaño */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-white/60">Por página</span>
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(parseInt(e.target.value, 10));
              setPage(1);
            }}
            className="rounded-xl bg-[#0C212D] border border-white/10 px-2 py-1.5 text-sm outline-none"
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* KPIs rápidos */}
      <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
        <Kpi title="SKUs totales" value={items.length} />
        <Kpi
          title={`Stock bajo (${location.toUpperCase()})`}
          value={
            items.filter(
              (p) =>
                Number.parseInt(p?.[stockField] ?? 0, 10) <=
                Number(lowThreshold || 0)
            ).length
          }
          tone="warn"
        />
        <Kpi title="Filtrados" value={filtered.length} />
      </div>

      {/* ===== LISTA (mobile) ===== */}
      <div className="grid gap-2 md:hidden">
        {loading ? (
          <div className="p-4 text-center text-white/60">Cargando…</div>
        ) : slice.length === 0 ? (
          <div className="p-4 text-center text-white/60">Sin resultados</div>
        ) : (
          slice.map((p) => {
            const s1 = Number.parseInt(p?.stockPv1 ?? 0, 10);
            const s2 = Number.parseInt(p?.stockPv2 ?? 0, 10);
            const minS = Number.parseInt(p?.minStock ?? 0, 10);
            const isLow =
              Number.parseInt(p?.[stockField] ?? 0, 10) <=
              Number(lowThreshold || 0);
            return (
              <article
                key={`${p.chunkDoc}_${p.id}`}
                className={`rounded-xl border border-white/10 bg-white/5 p-3 ${
                  isLow ? "ring-1 ring-[#FF3816]/40" : ""
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h4 className="font-semibold leading-tight break-words">
                      {p.name || "-"}
                    </h4>
                    <p className="text-xs text-white/60 break-words">
                      <span className="font-mono">{p.sku || "-"}</span> •{" "}
                      {p.category || "-"}
                    </p>
                    <p className="text-xs text-white/60 break-words">
                      {p.provider || "-"}
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

                <div className="mt-3 grid grid-cols-3 gap-2">
                  {/* PV1 */}
                  <div className="bg-white/5 rounded-lg p-2 border border-white/10">
                    <div className="text-[11px] text-white/60">PV1</div>
                    <div className="mt-1 flex items-center gap-1">
                      <Btn
                        sm
                        onClick={() => adjust(p.id, "stockPv1", -1)}
                        disabled={!canEdit}
                      >
                        -
                      </Btn>
                      <input
                        value={
                          drafts[p.id]?.stockPv1 != null
                            ? drafts[p.id].stockPv1
                            : String(s1)
                        }
                        onChange={(e) =>
                          canEdit && setDraft(p.id, "stockPv1", e.target.value)
                        }
                        className="inp text-right w-full disabled:opacity-60"
                        type="number"
                        min={0}
                        disabled={!canEdit}
                        readOnly={!canEdit}
                      />
                      <Btn
                        sm
                        onClick={() => adjust(p.id, "stockPv1", +1)}
                        disabled={!canEdit}
                      >
                        +
                      </Btn>
                    </div>
                  </div>

                  {/* PV2 */}
                  <div className="bg-white/5 rounded-lg p-2 border border-white/10">
                    <div className="text-[11px] text-white/60">PV2</div>
                    <div className="mt-1 flex items-center gap-1">
                      <Btn
                        sm
                        onClick={() => adjust(p.id, "stockPv2", -1)}
                        disabled={!canEdit}
                      >
                        -
                      </Btn>
                      <input
                        value={
                          drafts[p.id]?.stockPv2 != null
                            ? drafts[p.id].stockPv2
                            : String(s2)
                        }
                        onChange={(e) =>
                          canEdit && setDraft(p.id, "stockPv2", e.target.value)
                        }
                        className="inp text-right w-full disabled:opacity-60"
                        type="number"
                        min={0}
                        disabled={!canEdit}
                        readOnly={!canEdit}
                      />
                      <Btn
                        sm
                        onClick={() => adjust(p.id, "stockPv2", +1)}
                        disabled={!canEdit}
                      >
                        +
                      </Btn>
                    </div>
                  </div>

                  {/* Min */}
                  <div className="bg-white/5 rounded-lg p-2 border border-white/10">
                    <div className="text-[11px] text-white/60">Mín.</div>
                    <input
                      value={
                        drafts[p.id]?.minStock != null
                          ? drafts[p.id].minStock
                          : String(minS)
                      }
                      onChange={(e) =>
                        canEdit && setDraft(p.id, "minStock", e.target.value)
                      }
                      className="inp text-right w-full mt-1 disabled:opacity-60"
                      type="number"
                      min={0}
                      disabled={!canEdit}
                      readOnly={!canEdit}
                    />
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  <Btn
                    onClick={() => saveRow(p)}
                    disabled={!canEdit || !hasDraft(p.id)}
                  >
                    Guardar
                  </Btn>
                </div>
              </article>
            );
          })
        )}
      </div>

      {/* ===== TABLA (md+) ===== */}
      <div className="hidden md:block rounded-2xl border border-white/10">
        <div className="max-w-full overflow-x-auto overscroll-x-contain">
          <table className="w-full text-sm md:table-fixed">
            <thead className="bg-white/5 text-white/70">
              <tr>
                <Th>SKU</Th>
                <Th className="md:w-[28%]">Nombre</Th>
                <Th className="hidden lg:table-cell">Tipo</Th>
                <Th className="hidden xl:table-cell">Proveedor</Th>
                <Th className="text-right">PV1</Th>
                <Th className="text-right">PV2</Th>
                <Th className="text-right">Mín.</Th>
                <Th className="w-36 text-center">Acciones</Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="p-6 text-center text-white/60">
                    Cargando…
                  </td>
                </tr>
              ) : slice.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-6 text-center text-white/60">
                    Sin resultados
                  </td>
                </tr>
              ) : (
                slice.map((p) => {
                  const s1 = Number.parseInt(p?.stockPv1 ?? 0, 10);
                  const s2 = Number.parseInt(p?.stockPv2 ?? 0, 10);
                  const minS = Number.parseInt(p?.minStock ?? 0, 10);
                  const isLow =
                    Number.parseInt(p?.[stockField] ?? 0, 10) <=
                    Number(lowThreshold || 0);
                  return (
                    <tr
                      key={`${p.chunkDoc}_${p.id}`}
                      className={`border-t border-white/5 ${
                        isLow ? "bg-[#FF3816]/5" : ""
                      }`}
                    >
                      <Td className="truncate">{p.sku || "-"}</Td>
                      <Td className="truncate md:max-w-[340px] lg:max-w-none break-words font-medium">
                        {p.name}
                      </Td>
                      <Td className="truncate hidden lg:table-cell">
                        {p.category || "-"}
                      </Td>
                      <Td className="truncate hidden xl:table-cell">
                        {p.provider || "-"}
                      </Td>

                      {/* PV1 */}
                      <Td className="text-right">
                        <div className="inline-flex items-center gap-1">
                          <Btn
                            sm
                            onClick={() => adjust(p.id, "stockPv1", -1)}
                            disabled={!canEdit}
                          >
                            -
                          </Btn>
                          <input
                            value={
                              drafts[p.id]?.stockPv1 != null
                                ? drafts[p.id].stockPv1
                                : String(s1)
                            }
                            onChange={(e) =>
                              canEdit &&
                              setDraft(p.id, "stockPv1", e.target.value)
                            }
                            className="w-16 inp text-right disabled:opacity-60"
                            type="number"
                            min={0}
                            disabled={!canEdit}
                            readOnly={!canEdit}
                          />
                          <Btn
                            sm
                            onClick={() => adjust(p.id, "stockPv1", +1)}
                            disabled={!canEdit}
                          >
                            +
                          </Btn>
                        </div>
                      </Td>

                      {/* PV2 */}
                      <Td className="text-right">
                        <div className="inline-flex items-center gap-1">
                          <Btn
                            sm
                            onClick={() => adjust(p.id, "stockPv2", -1)}
                            disabled={!canEdit}
                          >
                            -
                          </Btn>
                          <input
                            value={
                              drafts[p.id]?.stockPv2 != null
                                ? drafts[p.id].stockPv2
                                : String(s2)
                            }
                            onChange={(e) =>
                              canEdit &&
                              setDraft(p.id, "stockPv2", e.target.value)
                            }
                            className="w-16 inp text-right disabled:opacity-60"
                            type="number"
                            min={0}
                            disabled={!canEdit}
                            readOnly={!canEdit}
                          />
                          <Btn
                            sm
                            onClick={() => adjust(p.id, "stockPv2", +1)}
                            disabled={!canEdit}
                          >
                            +
                          </Btn>
                        </div>
                      </Td>

                      {/* Min */}
                      <Td className="text-right">
                        <input
                          value={
                            drafts[p.id]?.minStock != null
                              ? drafts[p.id].minStock
                              : String(minS)
                          }
                          onChange={(e) =>
                            canEdit &&
                            setDraft(p.id, "minStock", e.target.value)
                          }
                          className="w-16 inp text-right disabled:opacity-60"
                          type="number"
                          min={0}
                          disabled={!canEdit}
                          readOnly={!canEdit}
                        />
                      </Td>

                      <Td className="text-center">
                        <div className="flex items-center justify-center gap-2 flex-wrap">
                          <Btn
                            onClick={() => saveRow(p)}
                            disabled={!canEdit || !hasDraft(p.id)}
                          >
                            Guardar
                          </Btn>
                        </div>
                      </Td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Paginación: controles */}
      <div className="flex flex-col md:flex-row items-center justify-between gap-2 text-sm">
        <span className="text-white/60">
          Página {pageSafe} de {totalPages} • {filtered.length} ítems
        </span>
        <div className="flex items-center gap-2 flex-wrap">
          <Btn onClick={() => setPage(1)} disabled={pageSafe === 1}>
            «
          </Btn>
          <Btn
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={pageSafe === 1}
          >
            ‹
          </Btn>
          <span className="px-2">{pageSafe}</span>
          <Btn
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={pageSafe === totalPages}
          >
            ›
          </Btn>
          <Btn
            onClick={() => setPage(totalPages)}
            disabled={pageSafe === totalPages}
          >
            »
          </Btn>
        </div>
      </div>

      <style jsx global>{`
        .inp {
          background: #0c212d;
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 0.75rem;
          padding: 0.4rem 0.6rem;
          outline: none;
          min-width: 0;
        }
        .inp:focus {
          box-shadow: 0 0 0 2px rgba(238, 114, 3, 0.6);
        }
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

/* =========== UI helpers =========== */
function Th({ children, className = "" }) {
  return <th className={`px-3 py-2 text-left ${className}`}>{children}</th>;
}
function Td({ children, className = "" }) {
  return <td className={`px-3 py-2 align-top ${className}`}>{children}</td>;
}
function Btn({ children, onClick, disabled, sm }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`${
        sm ? "px-2 py-1 text-xs" : "px-2.5 py-1.5 text-xs"
      } rounded-lg ${
        disabled
          ? "bg-white/5 text-white/40 cursor-not-allowed"
          : "bg-white/10 hover:bg-white/15"
      }`}
    >
      {children}
    </button>
  );
}
function Kpi({ title, value, tone }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#112C3E]/80 p-4 shadow">
      <div className="flex items-center justify-between">
        <h4 className="text-sm text-white/70">{title}</h4>
        <span
          className={`inline-block h-2.5 w-2.5 rounded-full ${
            tone === "warn" ? "bg-[#FF3816]" : "bg-[#EE7203]"
          }`}
        />
      </div>
      <div className="text-2xl font-semibold mt-1">{String(value)}</div>
    </div>
  );
}

/* =========== data helpers (sin lecturas remotas) =========== */
function flattenProducts(docs) {
  const out = [];
  for (const d of docs) {
    for (const [k, v] of Object.entries(d.data || {})) {
      if (!k.startsWith("p_")) continue;
      if (v && typeof v === "object")
        out.push({ ...v, id: v.id, chunkDoc: v.chunkDoc || d.id });
    }
  }
  return out.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}
