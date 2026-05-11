import { useContext, useMemo, useState } from "react";
import ContextGeneral from "@/servicios/contextGeneral";
import useDismissibleModal from "@/hooks/useDismissibleModal";
import { arrayUnion, doc, updateDoc } from "firebase/firestore";
import { toast } from "sonner";

export default function MecanicosTaller() {
  const ctx = useContext(ContextGeneral);
  const emailLogueado = ctx.user?.email;
  const nombreLogueado = ctx.user?.displayName || emailLogueado?.split("@")[0];

  const misTrabajos = useMemo(() => {
    return (Array.isArray(ctx.trabajosTaller) ? ctx.trabajosTaller : [])
      .filter(
        (trabajo) =>
          (Array.isArray(trabajo.mecanicosIds) &&
            trabajo.mecanicosIds.includes(emailLogueado)) ||
          trabajo.mecanicoId === emailLogueado,
      )
      .sort((a, b) => {
        const byStatus = statusWeight(a.estado) - statusWeight(b.estado);
        if (byStatus !== 0) return byStatus;
        return getTimestampMs(b.createdAt) - getTimestampMs(a.createdAt);
      });
  }, [ctx.trabajosTaller, emailLogueado]);

  const [selectedTrabajo, setSelectedTrabajo] = useState(null);
  const [nuevoComentario, setNuevoComentario] = useState("");
  const [guardandoMsg, setGuardandoMsg] = useState(false);
  const trabajoModal = useDismissibleModal(
    !!selectedTrabajo,
    () => setSelectedTrabajo(null),
  );

  const resumen = useMemo(() => {
    const pendientes = misTrabajos.filter((trabajo) => trabajo.estado !== "Terminado");
    const tareas = pendientes.flatMap((trabajo) =>
      Array.isArray(trabajo.tareas)
        ? trabajo.tareas.filter((tarea) => !tarea.completada)
        : [],
    );

    return {
      total: misTrabajos.length,
      pendientes: pendientes.length,
      terminados: misTrabajos.filter((trabajo) => trabajo.estado === "Terminado")
        .length,
      tareasPendientes: tareas.length,
    };
  }, [misTrabajos]);

  async function cambiarEstadoGeneral(id, chunkDoc, nuevoEstado, event) {
    if (event) event.stopPropagation();

    try {
      const ref = doc(ctx.firestore, "trabajosTaller", chunkDoc);
      const updatePayload = {
        [`t_${id}.estado`]: nuevoEstado,
      };

      if (nuevoEstado === "Terminado") {
        const mensajeFinal = window.prompt(
          "Trabajo terminado. ¿Querés dejar un reporte final para el admin o para el cliente? (Opcional)",
        );
        if (mensajeFinal && mensajeFinal.trim()) {
          updatePayload[`t_${id}.comentarios`] = arrayUnion({
            texto: `[REPORTE FINAL] ${mensajeFinal.trim()}`,
            fecha: new Date(),
            autor: nombreLogueado,
          });
        }
      }

      await updateDoc(ref, updatePayload);
      toast.success(`Estado actualizado a ${nuevoEstado}`);

      if (selectedTrabajo?.id === id) {
        setSelectedTrabajo((prev) => ({ ...prev, estado: nuevoEstado }));
      }
    } catch (error) {
      console.error(error);
      toast.error("No se pudo actualizar el estado");
    }
  }

  async function toggleTareaCompletada(trabajo, indexTarea) {
    try {
      const ref = doc(ctx.firestore, "trabajosTaller", trabajo.chunkDoc);
      const nuevasTareas = [...(trabajo.tareas || [])];
      const tareaActual = nuevasTareas[indexTarea];
      const completada = !tareaActual.completada;

      nuevasTareas[indexTarea] = {
        ...tareaActual,
        completada,
        fechaCompletada: completada ? new Date() : null,
        completadaPor: completada ? nombreLogueado : null,
      };

      await updateDoc(ref, {
        [`t_${trabajo.id}.tareas`]: nuevasTareas,
      });

      if (selectedTrabajo?.id === trabajo.id) {
        setSelectedTrabajo((prev) => ({ ...prev, tareas: nuevasTareas }));
      }

      toast.success(completada ? "Tarea completada" : "Tarea desmarcada");
    } catch (error) {
      console.error(error);
      toast.error("No se pudo actualizar la tarea");
    }
  }

  async function agregarComentario(event) {
    event.preventDefault();
    if (!nuevoComentario.trim() || !selectedTrabajo) return;

    setGuardandoMsg(true);
    try {
      const ref = doc(
        ctx.firestore,
        "trabajosTaller",
        selectedTrabajo.chunkDoc,
      );

      const commentObj = {
        texto: nuevoComentario.trim(),
        fecha: new Date(),
        autor: nombreLogueado,
      };

      await updateDoc(ref, {
        [`t_${selectedTrabajo.id}.comentarios`]: arrayUnion(commentObj),
      });

      setNuevoComentario("");
      setSelectedTrabajo((prev) => ({
        ...prev,
        comentarios: [...(prev.comentarios || []), commentObj],
      }));
      toast.success("Comentario agregado");
    } catch (error) {
      console.error(error);
      toast.error("Error al enviar comentario");
    } finally {
      setGuardandoMsg(false);
    }
  }

  if (!emailLogueado) return <p>Cargando perfil...</p>;

  return (
    <div className="max-w-6xl mx-auto animate-in fade-in duration-200 space-y-6">
      <div className="rounded-3xl border border-emerald-500/30 bg-emerald-500/10 p-5 shadow-lg">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h3 className="text-xl font-bold tracking-tight text-emerald-400">
              Panel de mecánico: {nombreLogueado}
            </h3>
            <p className="mt-1 text-sm text-emerald-100/70">
              Acá ves tus órdenes asignadas, el detalle operativo y el checklist
              de lo que tenés que hacer.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="Asignadas" value={resumen.total} />
            <StatCard label="Pendientes" value={resumen.pendientes} />
            <StatCard label="Terminadas" value={resumen.terminados} />
            <StatCard label="Tareas" value={resumen.tareasPendientes} />
          </div>
        </div>
      </div>

      {misTrabajos.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-white/5 py-14 text-center opacity-60">
          <span className="block text-4xl mb-3">🛠️</span>
          <p className="text-sm italic">
            No tenés trabajos asignados por el momento.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {misTrabajos.map((trabajo) => {
            const tareasTotales = Array.isArray(trabajo.tareas)
              ? trabajo.tareas.length
              : 0;
            const tareasCompletadas = Array.isArray(trabajo.tareas)
              ? trabajo.tareas.filter((tarea) => tarea.completada).length
              : 0;
            const tareasPendientes = Math.max(0, tareasTotales - tareasCompletadas);
            const progreso =
              tareasTotales > 0
                ? Math.round((tareasCompletadas / tareasTotales) * 100)
                : 0;
            const presupuestoItems = Array.isArray(trabajo.sourceBudgetItems)
              ? trabajo.sourceBudgetItems
              : [];

            return (
              <button
                key={trabajo.id}
                type="button"
                onClick={() => setSelectedTrabajo(trabajo)}
                className="text-left rounded-3xl border border-white/10 bg-[#112C3E] p-5 shadow-lg transition hover:border-emerald-500/30 hover:-translate-y-0.5"
              >
                <div className="flex flex-col gap-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <span
                          className={`inline-flex px-2.5 py-1 text-[10px] font-bold tracking-widest uppercase rounded-md border ${statusClasses(trabajo.estado)}`}
                        >
                          {trabajo.estado}
                        </span>
                        <span className="px-2 py-0.5 text-xs font-mono rounded bg-black/20 text-white/40">
                          #{String(trabajo.id || "").slice(-6)}
                        </span>
                        {presupuestoItems.length > 0 && (
                          <span className="inline-flex px-2.5 py-1 text-[10px] font-semibold tracking-widest uppercase rounded-md border border-sky-400/30 bg-sky-400/10 text-sky-300">
                            Presupuesto vinculado
                          </span>
                        )}
                      </div>

                      <h4 className="text-lg font-semibold leading-tight text-white">
                        {trabajo.tituloOrden || trabajo.descripcion}
                      </h4>
                      {trabajo.tituloOrden && (
                        <p className="mt-1 text-sm leading-relaxed text-white/65">
                          {trabajo.descripcion}
                        </p>
                      )}
                    </div>

                    <select
                      value={trabajo.estado}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) =>
                        cambiarEstadoGeneral(
                          trabajo.id,
                          trabajo.chunkDoc,
                          event.target.value,
                          event,
                        )
                      }
                      className="bg-[#0C212D] text-sm font-medium text-white/90 border border-white/10 rounded-xl p-2.5 focus:outline-none focus:border-emerald-400 transition cursor-pointer"
                    >
                      <option value="Sin comenzar">Sin comenzar</option>
                      <option value="En proceso">En proceso</option>
                      <option value="Terminado">Terminado</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-1 gap-3 text-sm text-white/65 sm:grid-cols-2">
                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-white/35">
                        Cliente
                      </p>
                      <p className="mt-1 font-medium text-white/85">
                        {trabajo.clienteNombre || "-"}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-white/35">
                        Vehículo
                      </p>
                      <p className="mt-1 font-medium text-white/85">
                        {trabajo.vehiculo || "-"}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                    <MiniCard label="Pendientes" value={tareasPendientes} />
                    <MiniCard label="Hechas" value={tareasCompletadas} />
                    <MiniCard label="Total tareas" value={tareasTotales} />
                    <MiniCard
                      label="Materiales"
                      value={presupuestoItems.length}
                      accent="text-sky-300"
                    />
                  </div>

                  {tareasTotales > 0 && (
                    <div>
                      <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-widest text-white/40 mb-1.5">
                        <span>Avance</span>
                        <span>{progreso}%</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-white/10">
                        <div
                          className="h-full transition-all duration-300 bg-emerald-400"
                          style={{ width: `${progreso}%` }}
                        />
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-3 border-t border-white/5 text-sm">
                    <p className="text-white/45">
                      Comentarios: {trabajo.comentarios?.length || 0}
                    </p>
                    <span className="font-semibold text-emerald-300">
                      Ver detalle operativo
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {selectedTrabajo && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md"
          onMouseDown={trabajoModal.handleBackdropMouseDown}
        >
          <div
            ref={trabajoModal.modalRef}
            className="bg-[#0C212D] border border-white/10 rounded-3xl w-full max-w-6xl max-h-[92vh] flex flex-col shadow-2xl animate-in fade-in zoom-in-95 duration-200"
          >
            <div className="shrink-0 p-6 border-b border-white/10 bg-[#112C3E] rounded-t-3xl">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <h3 className="text-xl font-bold tracking-tight text-white">
                    {selectedTrabajo.tituloOrden || "Orden de trabajo"}
                  </h3>
                  <p className="mt-1 text-sm text-white/55">
                    {selectedTrabajo.clienteNombre} · {selectedTrabajo.vehiculo}
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <select
                    value={selectedTrabajo.estado}
                    onChange={(event) =>
                      cambiarEstadoGeneral(
                        selectedTrabajo.id,
                        selectedTrabajo.chunkDoc,
                        event.target.value,
                      )
                    }
                    className="bg-white/5 text-sm font-medium text-white/90 border border-white/10 rounded-xl p-2.5 focus:outline-none focus:border-emerald-400 transition cursor-pointer"
                  >
                    <option className="bg-[#0C212D]" value="Sin comenzar">
                      Sin comenzar
                    </option>
                    <option className="bg-[#0C212D]" value="En proceso">
                      En proceso
                    </option>
                    <option className="bg-[#0C212D]" value="Terminado">
                      Terminado
                    </option>
                  </select>
                  <button
                    onClick={() => setSelectedTrabajo(null)}
                    className="p-2 transition rounded-xl text-white/50 hover:text-white hover:bg-white/10"
                  >
                    ×
                  </button>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 gap-6 xl:grid-cols-12">
              <div className="space-y-6 xl:col-span-7">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
                  <SummaryInfo label="Estado" value={selectedTrabajo.estado} />
                  <SummaryInfo
                    label="Pendientes"
                    value={countPendingTasks(selectedTrabajo)}
                  />
                  <SummaryInfo
                    label="Completadas"
                    value={countCompletedTasks(selectedTrabajo)}
                  />
                  <SummaryInfo
                    label="Materiales"
                    value={(selectedTrabajo.sourceBudgetItems || []).length}
                  />
                </div>

                <div className="rounded-2xl border border-white/5 bg-[#112C3E] p-5">
                  <p className="text-[10px] uppercase tracking-widest text-emerald-400 font-bold mb-2">
                    Qué hay que hacer
                  </p>
                  <p className="text-white text-sm leading-relaxed whitespace-pre-line">
                    {selectedTrabajo.descripcion || "Sin descripción."}
                  </p>
                </div>

                <div className="rounded-2xl border border-white/5 bg-[#112C3E] p-5">
                  <div className="flex items-center justify-between gap-4 mb-4 pb-3 border-b border-white/10">
                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-emerald-400 font-bold">
                        Checklist operativo
                      </p>
                      <p className="mt-1 text-sm text-white/50">
                        Marcá lo que ya está hecho. Esto impacta en el avance de la
                        orden.
                      </p>
                    </div>
                    <span className="text-sm font-semibold text-white/60">
                      {countCompletedTasks(selectedTrabajo)} /{" "}
                      {(selectedTrabajo.tareas || []).length || 0}
                    </span>
                  </div>

                  {!(selectedTrabajo.tareas || []).length ? (
                    <p className="text-sm italic text-white/40">
                      Esta orden todavía no tiene tareas específicas.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {(selectedTrabajo.tareas || []).map((tarea, index) => (
                        <label
                          key={`${tarea.descripcion}_${index}`}
                          className={`flex gap-3 rounded-xl border p-3 cursor-pointer transition ${
                            tarea.completada
                              ? "bg-emerald-500/10 border-emerald-500/20"
                              : "bg-[#0C212D] border-white/5"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={!!tarea.completada}
                            onChange={() =>
                              toggleTareaCompletada(selectedTrabajo, index)
                            }
                            className="mt-1 w-5 h-5 rounded accent-emerald-500"
                          />
                          <div className="min-w-0">
                            <p
                              className={`text-sm leading-snug ${
                                tarea.completada
                                  ? "text-white/45 line-through"
                                  : "text-white/90"
                              }`}
                            >
                              {tarea.descripcion}
                            </p>
                            {tarea.completada && tarea.fechaCompletada && (
                              <p className="mt-1 text-[11px] font-medium text-emerald-300/80">
                                Hecho por {tarea.completadaPor || "sin dato"} ·{" "}
                                {timestampDateTime(tarea.fechaCompletada)}
                              </p>
                            )}
                          </div>
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                {(selectedTrabajo.sourceBudgetItems || []).length > 0 && (
                  <div className="rounded-2xl border border-white/5 bg-[#112C3E] p-5">
                    <div className="flex items-center justify-between gap-4 mb-4 pb-3 border-b border-white/10">
                      <div>
                        <p className="text-[10px] uppercase tracking-widest text-sky-300 font-bold">
                          Presupuesto relacionado
                        </p>
                        <p className="mt-1 text-sm text-white/50">
                          Productos y servicios incluidos en la cotización original.
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold text-sky-300">
                          {money(selectedTrabajo.sourceBudgetTotal || 0)}
                        </p>
                        <p className="text-[11px] text-white/35">
                          Presupuesto #{String(selectedTrabajo.sourceBudgetId || "").slice(-6)}
                        </p>
                      </div>
                    </div>

                    <div className="space-y-3">
                      {(selectedTrabajo.sourceBudgetItems || []).map((item) => (
                        <div
                          key={item.lineId || `${item.desc}_${item.cantidad}`}
                          className="flex flex-col gap-2 rounded-xl border border-white/10 bg-[#0C212D] p-3 md:flex-row md:items-center md:justify-between"
                        >
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className={`inline-flex px-2 py-1 text-[10px] font-semibold tracking-widest uppercase rounded-md border ${
                                  item.kind === "producto"
                                    ? "border-sky-400/30 bg-sky-400/10 text-sky-300"
                                    : "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                                }`}
                              >
                                {item.kind === "producto" ? "Producto" : "Servicio"}
                              </span>
                              <p className="font-semibold text-white">
                                {item.desc}
                              </p>
                            </div>
                            {(item.sku || item.category) && (
                              <p className="text-[11px] mt-1 text-white/40">
                                {[item.sku, item.category]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </p>
                            )}
                          </div>
                          <div className="text-sm text-white/65 md:text-right">
                            <p>Cantidad: {item.cantidad}</p>
                            <p>Subtotal: {money((item.cantidad || 0) * (item.precioUnitario || 0))}</p>
                          </div>
                        </div>
                      ))}
                    </div>

                    {selectedTrabajo.sourceBudgetNotes && (
                      <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-4">
                        <p className="text-[10px] uppercase tracking-widest text-white/45 font-semibold mb-2">
                          Notas del presupuesto
                        </p>
                        <p className="text-sm whitespace-pre-line text-white/75">
                          {selectedTrabajo.sourceBudgetNotes}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="xl:col-span-5 rounded-2xl border border-white/5 bg-[#112C3E] p-5 flex flex-col min-h-[28rem]">
                <h4 className="text-xs uppercase tracking-widest text-white/50 font-bold mb-4 pb-3 border-b border-white/10">
                  Comentarios y bitácora
                </h4>

                <div className="space-y-3 flex-1 overflow-y-auto pr-1 mb-4">
                  {!(selectedTrabajo.comentarios || []).length ? (
                    <div className="h-full flex flex-col items-center justify-center opacity-40">
                      <span className="text-3xl mb-2">💬</span>
                      <p className="text-sm italic">Sin comentarios todavía.</p>
                    </div>
                  ) : (
                    (selectedTrabajo.comentarios || []).map((msg, index) => {
                      const soyYo = msg.autor === nombreLogueado;
                      return (
                        <div
                          key={`${msg.texto}_${index}`}
                          className={`p-3 rounded-xl max-w-[95%] ${
                            soyYo
                              ? "bg-emerald-500/20 border border-emerald-500/30 ml-auto rounded-tr-sm"
                              : "bg-[#0C212D] border border-white/10 mr-auto rounded-tl-sm"
                          }`}
                        >
                          <div className="flex justify-between items-end gap-4 mb-1">
                            <span className="text-[10px] font-bold uppercase text-white/50">
                              {msg.autor}
                            </span>
                            <span className="text-[10px] text-white/30">
                              {timestampDateTime(msg.fecha)}
                            </span>
                          </div>
                          <p className="text-sm leading-snug break-words text-white/90">
                            {msg.texto}
                          </p>
                        </div>
                      );
                    })
                  )}
                </div>

                <form onSubmit={agregarComentario} className="flex gap-2">
                  <input
                    type="text"
                    value={nuevoComentario}
                    onChange={(event) => setNuevoComentario(event.target.value)}
                    placeholder="Escribí un comentario para dejar registro..."
                    className="flex-1 rounded-xl border border-white/10 bg-[#0C212D] p-3 text-sm text-white focus:outline-none focus:border-emerald-400 transition"
                  />
                  <button
                    type="submit"
                    disabled={guardandoMsg || !nuevoComentario.trim()}
                    className="px-5 font-semibold text-white transition rounded-xl shadow-lg bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50"
                  >
                    Enviar
                  </button>
                </form>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function countPendingTasks(trabajo) {
  return Array.isArray(trabajo?.tareas)
    ? trabajo.tareas.filter((tarea) => !tarea.completada).length
    : 0;
}

function countCompletedTasks(trabajo) {
  return Array.isArray(trabajo?.tareas)
    ? trabajo.tareas.filter((tarea) => tarea.completada).length
    : 0;
}

function statusWeight(status) {
  switch (status) {
    case "En proceso":
      return 0;
    case "Sin comenzar":
      return 1;
    case "Terminado":
      return 2;
    default:
      return 3;
  }
}

function statusClasses(status) {
  switch (status) {
    case "En proceso":
      return "bg-emerald-500/10 border-emerald-500/30 text-emerald-300";
    case "Terminado":
      return "bg-sky-500/10 border-sky-500/30 text-sky-300";
    default:
      return "bg-white/5 border-white/10 text-white/70";
  }
}

function money(value) {
  return Number(value || 0).toLocaleString("es-AR", {
    style: "currency",
    currency: "ARS",
  });
}

function timestampDateTime(value) {
  if (!value) return "Reciente";
  if (typeof value?.toDate === "function") {
    return value.toDate().toLocaleString("es-AR");
  }
  if (typeof value?.seconds === "number") {
    return new Date(value.seconds * 1000).toLocaleString("es-AR");
  }
  return new Date(value).toLocaleString("es-AR");
}

function getTimestampMs(value) {
  if (!value) return 0;
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  if (typeof value?.seconds === "number") return value.seconds * 1000;
  return new Date(value).getTime();
}

function StatCard({ label, value }) {
  return (
    <div className="rounded-2xl border border-emerald-400/15 bg-black/10 px-4 py-3 text-right">
      <p className="text-[10px] uppercase tracking-widest text-emerald-100/45">
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold text-emerald-300">{value}</p>
    </div>
  );
}

function MiniCard({ label, value, accent = "text-white/85" }) {
  return (
    <div className="rounded-xl border border-white/10 bg-[#0C212D] px-3 py-2">
      <p className="text-[10px] uppercase tracking-widest text-white/35">
        {label}
      </p>
      <p className={`mt-1 text-sm font-semibold ${accent}`}>{value}</p>
    </div>
  );
}

function SummaryInfo({ label, value }) {
  return (
    <div className="rounded-2xl border border-white/5 bg-[#112C3E] p-4">
      <p className="text-[10px] uppercase tracking-widest text-emerald-400 font-bold">
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold text-white">{value}</p>
    </div>
  );
}
