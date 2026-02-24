import { useState, useContext } from "react";
import ContextGeneral from "@/servicios/contextGeneral";
import { doc, updateDoc, arrayUnion } from "firebase/firestore";
import { toast } from "sonner";

export default function MecanicosTaller() {
  const ctx = useContext(ContextGeneral);
  const emailLogueado = ctx.user?.email;
  const nombreLogueado = ctx.user?.displayName || emailLogueado?.split("@")[0];

  // Filtramos los trabajos donde este mecánico esté incluido en el array de asignados
  const misTrabajos = (ctx.trabajosTaller || []).filter(
    (t) =>
      (t.mecanicosIds && t.mecanicosIds.includes(emailLogueado)) ||
      t.mecanicoId === emailLogueado,
  );

  const [selectedTrabajo, setSelectedTrabajo] = useState(null);
  const [nuevoComentario, setNewComentario] = useState("");
  const [guardandoMsg, setGuardandoMsg] = useState(false);

  const cambiarEstadoGeneral = async (id, chunkDoc, nuevoEstado, e) => {
    // Evita que el click en el select abra el modal si estamos en la vista de tarjetas
    if (e) e.stopPropagation();

    try {
      const ref = doc(ctx.firestore, "trabajosTaller", chunkDoc);

      let updatePayload = {
        [`t_${id}.estado`]: nuevoEstado,
      };

      // Si lo pasa a terminado, podemos sugerirle dejar un comentario final
      if (nuevoEstado === "Terminado") {
        const mensajeFinal = window.prompt(
          "Trabajo terminado. ¿Querés dejar un reporte final para el admin/cliente? (Opcional)",
        );
        if (mensajeFinal && mensajeFinal.trim()) {
          const commentObj = {
            texto: `[REPORTE FINAL]: ${mensajeFinal.trim()}`,
            fecha: new Date(),
            autor: nombreLogueado,
          };
          updatePayload[`t_${id}.comentarios`] = arrayUnion(commentObj);
        }
      }

      await updateDoc(ref, updatePayload);
      toast.success(`Estado actualizado a ${nuevoEstado}`);

      // Si el modal está abierto, actualizamos el estado local para reflejar el cambio
      if (selectedTrabajo && selectedTrabajo.id === id) {
        setSelectedTrabajo((prev) => ({ ...prev, estado: nuevoEstado }));
      }
    } catch (error) {
      console.error(error);
      toast.error("No se pudo actualizar el estado");
    }
  };

  const toggleTareaCompletada = async (trabajo, indexTarea) => {
    try {
      const ref = doc(ctx.firestore, "trabajosTaller", trabajo.chunkDoc);

      const nuevasTareas = [...(trabajo.tareas || [])];
      const tareaActual = nuevasTareas[indexTarea];

      const nuevoEstadoCompletada = !tareaActual.completada;

      nuevasTareas[indexTarea] = {
        ...tareaActual,
        completada: nuevoEstadoCompletada,
        fechaCompletada: nuevoEstadoCompletada ? new Date() : null,
        completadaPor: nuevoEstadoCompletada ? nombreLogueado : null,
      };

      await updateDoc(ref, {
        [`t_${trabajo.id}.tareas`]: nuevasTareas,
      });

      if (selectedTrabajo && selectedTrabajo.id === trabajo.id) {
        setSelectedTrabajo({ ...selectedTrabajo, tareas: nuevasTareas });
      }

      toast.success(
        nuevoEstadoCompletada ? "Tarea completada" : "Tarea desmarcada",
      );
    } catch (error) {
      console.error("Error al actualizar tarea:", error);
      toast.error("No se pudo actualizar la tarea");
    }
  };

  const agregarComentario = async (e) => {
    e.preventDefault();
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

      toast.success("Comentario agregado");
      setNewComentario("");
      setSelectedTrabajo((prev) => ({
        ...prev,
        comentarios: [...(prev.comentarios || []), commentObj],
      }));
    } catch (error) {
      console.error(error);
      toast.error("Error al enviar comentario");
    } finally {
      setGuardandoMsg(false);
    }
  };

  const renderNombresMecanicos = (t) => {
    if (t.mecanicosInfo && t.mecanicosInfo.length > 0) {
      return t.mecanicosInfo.map((m) => m.nombre).join(", ");
    }
    return t.mecanico || "Sin asignar";
  };

  if (!emailLogueado) return <p>Cargando perfil...</p>;

  return (
    <div className="max-w-4xl mx-auto animate-in fade-in duration-200">
      <div className="bg-emerald-500/10 border border-emerald-500/30 p-5 rounded-2xl mb-8 flex items-center justify-between">
        <div>
          <h3 className="text-emerald-400 font-bold text-xl tracking-tight">
            Panel de Mecánico: {nombreLogueado}
          </h3>
          <p className="text-sm text-emerald-100/70 mt-1">
            Tus órdenes de trabajo asignadas.
          </p>
        </div>
        <div className="text-right hidden sm:block">
          <span className="text-3xl font-bold text-emerald-400">
            {misTrabajos.length}
          </span>
          <p className="text-[10px] uppercase tracking-widest font-semibold text-emerald-400/50">
            Asignadas
          </p>
        </div>
      </div>

      <div className="space-y-4">
        {misTrabajos.length === 0 ? (
          <div className="text-center py-12 border border-white/5 rounded-2xl bg-white/5 opacity-60">
            <span className="text-4xl mb-3 block">☕</span>
            <p className="text-sm italic">
              No tenés trabajos asignados por el momento.
            </p>
          </div>
        ) : (
          misTrabajos.map((t) => {
            const tareasTotales = t.tareas?.length || 0;
            const tareasCompletadas =
              t.tareas?.filter((tarea) => tarea.completada).length || 0;
            const progreso =
              tareasTotales > 0
                ? Math.round((tareasCompletadas / tareasTotales) * 100)
                : 0;

            return (
              <div
                key={t.id}
                className="bg-[#112C3E] border border-white/10 rounded-2xl p-5 flex flex-col sm:flex-row gap-5 justify-between items-start sm:items-center shadow-lg transition hover:border-emerald-500/30 group"
              >
                <div className="flex-1 min-w-0 w-full">
                  <div className="flex items-center gap-3 mb-2">
                    <span
                      className={`text-[10px] uppercase tracking-widest font-bold px-2.5 py-1 rounded-md border ${
                        t.estado === "Sin comenzar"
                          ? "bg-white/5 border-white/10 text-white/70"
                          : t.estado === "En proceso"
                            ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                            : "bg-sky-500/10 border-sky-500/20 text-sky-400"
                      }`}
                    >
                      {t.estado}
                    </span>
                    <span className="text-xs text-white/40 bg-black/20 px-2 py-0.5 rounded font-mono">
                      ID: {t.id.slice(-6)}
                    </span>
                  </div>
                  <h4 className="font-semibold text-white text-lg leading-tight mb-2 truncate">
                    {t.descripcion}
                  </h4>
                  <div className="flex flex-wrap items-center gap-4 text-sm text-white/60 mb-3">
                    <span>👤 {t.clienteNombre}</span>
                    <span>🚗 {t.vehiculo}</span>
                    <span className="truncate">
                      👥 {renderNombresMecanicos(t)}
                    </span>
                  </div>

                  {tareasTotales > 0 && (
                    <div className="flex items-center gap-3 w-full max-w-xs">
                      <span className="text-[10px] font-semibold text-white/50 w-8">
                        {progreso}%
                      </span>
                      <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-emerald-400 transition-all duration-300"
                          style={{ width: `${progreso}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-white/40 whitespace-nowrap">
                        {tareasCompletadas} de {tareasTotales}
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex flex-col sm:items-end gap-3 w-full sm:w-auto">
                  <select
                    value={t.estado}
                    onChange={(e) =>
                      cambiarEstadoGeneral(t.id, t.chunkDoc, e.target.value, e)
                    }
                    className="bg-[#0C212D] text-sm font-medium text-white/90 border border-white/10 rounded-xl p-2.5 focus:outline-none focus:border-emerald-400 transition cursor-pointer w-full sm:w-auto"
                  >
                    <option value="Sin comenzar">⏳ Sin comenzar</option>
                    <option value="En proceso">🔧 En proceso</option>
                    <option value="Terminado">✅ Terminado</option>
                  </select>

                  <button
                    onClick={() => setSelectedTrabajo(t)}
                    className="text-xs font-semibold text-emerald-400 hover:text-emerald-300 bg-emerald-400/10 hover:bg-emerald-400/20 px-4 py-2 rounded-xl transition w-full sm:w-auto"
                  >
                    Ver Detalles / Subtareas
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {selectedTrabajo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
          <div className="bg-[#0C212D] border border-white/10 rounded-3xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between p-6 border-b border-white/10 bg-[#112C3E] rounded-t-3xl shrink-0">
              <div>
                <h3 className="text-xl font-bold text-white tracking-tight">
                  Orden de Trabajo
                </h3>
                <p className="text-sm text-white/50 mt-1">
                  {selectedTrabajo.vehiculo}
                </p>
              </div>
              <div className="flex items-center gap-4">
                <select
                  value={selectedTrabajo.estado}
                  onChange={(e) =>
                    cambiarEstadoGeneral(
                      selectedTrabajo.id,
                      selectedTrabajo.chunkDoc,
                      e.target.value,
                    )
                  }
                  className="bg-white/5 text-sm font-medium text-white/90 border border-white/10 rounded-xl p-2 focus:outline-none focus:border-emerald-400 transition cursor-pointer hidden sm:block"
                >
                  <option className="bg-[#0C212D]" value="Sin comenzar">
                    ⏳ Sin comenzar
                  </option>
                  <option className="bg-[#0C212D]" value="En proceso">
                    🔧 En proceso
                  </option>
                  <option className="bg-[#0C212D]" value="Terminado">
                    ✅ Terminado
                  </option>
                </select>
                <button
                  onClick={() => setSelectedTrabajo(null)}
                  className="text-white/50 hover:text-white transition bg-white/5 hover:bg-white/10 p-2 rounded-xl"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="p-6 overflow-y-auto flex-1 flex flex-col md:flex-row gap-6">
              <div className="md:w-1/2 flex flex-col gap-4">
                <div className="bg-[#112C3E] border border-white/5 p-4 rounded-2xl">
                  <p className="text-[10px] uppercase tracking-widest text-emerald-400 font-bold mb-1">
                    Descripción General
                  </p>
                  <p className="text-white text-sm leading-relaxed">
                    {selectedTrabajo.descripcion}
                  </p>
                </div>

                <div className="bg-[#112C3E] border border-white/5 p-4 rounded-2xl flex-1">
                  <p className="text-[10px] uppercase tracking-widest text-emerald-400 font-bold mb-3 border-b border-white/5 pb-2">
                    Checklist de Tareas
                  </p>

                  {!selectedTrabajo.tareas ||
                  selectedTrabajo.tareas.length === 0 ? (
                    <p className="text-xs text-white/40 italic">
                      No hay tareas específicas asignadas.
                    </p>
                  ) : (
                    <div className="space-y-2 mt-2">
                      {selectedTrabajo.tareas.map((tarea, idx) => (
                        <div
                          key={idx}
                          className={`flex items-start gap-3 p-3 rounded-xl border ${tarea.completada ? "bg-emerald-500/10 border-emerald-500/20" : "bg-[#0C212D] border-white/5"} transition`}
                        >
                          <input
                            type="checkbox"
                            checked={tarea.completada}
                            onChange={() =>
                              toggleTareaCompletada(selectedTrabajo, idx)
                            }
                            className="mt-0.5 w-5 h-5 rounded border-gray-300 text-emerald-500 focus:ring-emerald-500 cursor-pointer accent-emerald-500"
                          />
                          <div className="flex-1 min-w-0">
                            <p
                              className={`text-sm leading-snug ${tarea.completada ? "text-white/40 line-through" : "text-white/90"}`}
                            >
                              {tarea.descripcion}
                            </p>
                            {tarea.completada && tarea.fechaCompletada && (
                              <p className="text-[9px] text-emerald-400/70 mt-1 font-medium bg-emerald-400/10 inline-block px-1.5 py-0.5 rounded">
                                ✓ Hecho por {tarea.completadaPor} a las{" "}
                                {tarea.fechaCompletada?.toDate
                                  ? tarea.fechaCompletada
                                      .toDate()
                                      .toLocaleString()
                                  : new Date(
                                      tarea.fechaCompletada,
                                    ).toLocaleString()}
                              </p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="md:w-1/2 flex flex-col h-full min-h-[300px] border-t md:border-t-0 md:border-l border-white/10 pt-4 md:pt-0 md:pl-6">
                <h4 className="text-xs uppercase tracking-widest text-white/50 font-bold mb-4 shrink-0">
                  Comentarios / Bitácora
                </h4>
                <div className="space-y-3 flex-1 overflow-y-auto mb-4 pr-1">
                  {!selectedTrabajo.comentarios ||
                  selectedTrabajo.comentarios.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center opacity-40">
                      <span className="text-3xl mb-2">💬</span>
                      <p className="text-sm italic">Sin comentarios.</p>
                    </div>
                  ) : (
                    selectedTrabajo.comentarios.map((msg, i) => {
                      const soyYo = msg.autor === nombreLogueado;
                      return (
                        <div
                          key={i}
                          className={`p-3 rounded-xl max-w-[90%] ${soyYo ? "bg-emerald-500/20 border border-emerald-500/30 ml-auto rounded-tr-sm" : "bg-[#112C3E] border border-white/10 mr-auto rounded-tl-sm"}`}
                        >
                          <div className="flex justify-between items-end mb-1 gap-4">
                            <span className="text-[10px] font-bold text-white/50 uppercase">
                              {msg.autor}
                            </span>
                            <span className="text-[9px] text-white/30">
                              {msg.fecha?.toDate
                                ? msg.fecha.toDate().toLocaleString()
                                : "Reciente"}
                            </span>
                          </div>
                          <p className="text-sm text-white/90 leading-snug break-words">
                            {msg.texto}
                          </p>
                        </div>
                      );
                    })
                  )}
                </div>

                <form
                  onSubmit={agregarComentario}
                  className="shrink-0 flex gap-2"
                >
                  <input
                    type="text"
                    value={nuevoComentario}
                    onChange={(e) => setNewComentario(e.target.value)}
                    placeholder="Escribir mensaje..."
                    className="flex-1 bg-[#112C3E] border border-white/10 text-white rounded-xl p-3 text-sm focus:outline-none focus:border-emerald-400 transition"
                  />
                  <button
                    disabled={guardandoMsg || !nuevoComentario.trim()}
                    type="submit"
                    className="bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white font-semibold px-5 rounded-xl transition shadow-lg"
                  >
                    ➤
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
