import { useState, useContext, useRef, useEffect } from "react";
import ContextGeneral from "@/servicios/contextGeneral";
import {
  collection,
  doc,
  setDoc,
  updateDoc,
  deleteField,
  getDocs,
  arrayUnion,
} from "firebase/firestore";
import { toast } from "sonner";

export default function TrabajosTaller() {
  const ctx = useContext(ContextGeneral);

  // Control de Modales
  const [showModalForm, setShowModalForm] = useState(false);
  const [selectedTrabajoDetail, setSelectedTrabajoDetail] = useState(null);

  const [guardando, setGuardando] = useState(false);
  const [guardandoMsg, setGuardandoMsg] = useState(false);
  const [nuevoComentario, setNewComentario] = useState("");

  // Buscador de clientes
  const [busquedaCliente, setBusquedaCliente] = useState("");
  const [mostrarDropdown, setMostrarDropdown] = useState(false);
  const dropdownRef = useRef(null);
  const [clienteSeleccionadoTemp, setClienteSeleccionadoTemp] = useState(null);

  // Estado del formulario
  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState({
    id: null,
    chunkDoc: null,
    clienteId: "",
    vehiculoString: "",
    vehiculoIndex: "",
    descripcion: "",
    mecanicosIds: [], // Array para múltiples mecánicos
    estado: "Sin comenzar",
    tareas: [],
    historialAsignaciones: [],
  });

  const trabajos = ctx.trabajosTaller || [];
  const clientes = ctx.clientesTaller || [];
  const usuariosTaller = (ctx.usuariosApp || []).filter(
    (u) =>
      Array.isArray(u.permisos) && u.permisos.includes(3) && u.activo !== false,
  );

  const trabajosSinComenzar = trabajos.filter(
    (t) => t.estado === "Sin comenzar",
  );
  const trabajosEnProceso = trabajos.filter((t) => t.estado === "En proceso");
  const trabajosTerminados = trabajos.filter((t) => t.estado === "Terminado");

  const clientesFiltrados = clientes.filter(
    (c) =>
      c.nombre.toLowerCase().includes(busquedaCliente.toLowerCase()) ||
      (c.vehiculos &&
        c.vehiculos.some((v) =>
          v.patente.toLowerCase().includes(busquedaCliente.toLowerCase()),
        )) ||
      (c.patente || "").toLowerCase().includes(busquedaCliente.toLowerCase()),
  );

  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setMostrarDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // --- Lógica Subtareas en Formulario ---
  const [nuevaTareaDesc, setNuevaTareaDesc] = useState("");

  const agregarTareaForm = () => {
    if (!nuevaTareaDesc.trim()) return;
    setForm((prev) => ({
      ...prev,
      tareas: [
        ...prev.tareas,
        {
          descripcion: nuevaTareaDesc.trim(),
          completada: false,
          fechaCompletada: null,
          completadaPor: null,
        },
      ],
    }));
    setNuevaTareaDesc("");
  };

  const eliminarTareaForm = (index) => {
    setForm((prev) => ({
      ...prev,
      tareas: prev.tareas.filter((_, i) => i !== index),
    }));
  };

  // --- Lógica Selección Mecánicos ---
  const toggleMecanico = (email) => {
    setForm((prev) => {
      if (prev.mecanicosIds.includes(email)) {
        return {
          ...prev,
          mecanicosIds: prev.mecanicosIds.filter((e) => e !== email),
        };
      }
      return { ...prev, mecanicosIds: [...prev.mecanicosIds, email] };
    });
  };

  // --- Acciones Principales ---

  const abrirCrear = () => {
    setIsEditing(false);
    setForm({
      clienteId: "",
      vehiculoIndex: "",
      vehiculoString: "",
      descripcion: "",
      mecanicosIds: [],
      estado: "Sin comenzar",
      tareas: [],
      id: null,
      chunkDoc: null,
      historialAsignaciones: [],
    });
    setBusquedaCliente("");
    setClienteSeleccionadoTemp(null);
    setNuevaTareaDesc("");
    setShowModalForm(true);
    setSelectedTrabajoDetail(null);
  };

  const abrirEditar = (trabajo) => {
    setIsEditing(true);

    // Convertir el mecánico único viejo a array si existe
    let ids = [];
    if (trabajo.mecanicosIds) ids = [...trabajo.mecanicosIds];
    else if (trabajo.mecanicoId) ids = [trabajo.mecanicoId];

    setForm({
      id: trabajo.id,
      chunkDoc: trabajo.chunkDoc,
      clienteId: trabajo.clienteId,
      vehiculoIndex: "",
      vehiculoString: trabajo.vehiculo,
      descripcion: trabajo.descripcion,
      mecanicosIds: ids,
      estado: trabajo.estado,
      tareas: trabajo.tareas ? [...trabajo.tareas] : [],
      historialAsignaciones: trabajo.historialAsignaciones || [],
    });
    setBusquedaCliente(trabajo.clienteNombre);

    const c = clientes.find((cli) => cli.id === trabajo.clienteId);
    if (c) setClienteSeleccionadoTemp(c);

    setNuevaTareaDesc("");
    setShowModalForm(true);
    setSelectedTrabajoDetail(null);
  };

  const cerrarModalForm = () => {
    if (isEditing && window.confirm("¿Cerrar sin guardar los cambios?")) {
      setShowModalForm(false);
    } else if (!isEditing) {
      setShowModalForm(false);
    }
  };

  const guardarTrabajo = async (e) => {
    e.preventDefault();
    if (!form.clienteId || !form.descripcion) {
      toast.error("Seleccioná un cliente y agregá una descripción");
      return;
    }
    if (
      (!isEditing || form.vehiculoIndex !== "") &&
      form.vehiculoIndex === "" &&
      !form.vehiculoString
    ) {
      toast.error("Seleccioná un vehículo");
      return;
    }

    setGuardando(true);
    try {
      const id = isEditing ? form.id : Date.now().toString();
      const key = `t_${id}`;
      let chunkDocId = form.chunkDoc;

      if (!chunkDocId) {
        const snap = await getDocs(collection(ctx.firestore, "trabajosTaller"));
        for (const docSnap of snap.docs) {
          const data = docSnap.data();
          const keysCount = Object.keys(data).filter((k) =>
            k.startsWith("t_"),
          ).length;
          if (keysCount < 100) {
            chunkDocId = docSnap.id;
            break;
          }
        }
        if (!chunkDocId) {
          chunkDocId = doc(collection(ctx.firestore, "trabajosTaller")).id;
        }
      }

      let vString = form.vehiculoString;
      if (form.vehiculoIndex !== "") {
        if (
          clienteSeleccionadoTemp.vehiculos &&
          clienteSeleccionadoTemp.vehiculos.length > 0
        ) {
          const v =
            clienteSeleccionadoTemp.vehiculos[parseInt(form.vehiculoIndex)];
          vString = `${v.marcaModelo || "Sin modelo"} (${v.patente})`;
        } else if (clienteSeleccionadoTemp.patente) {
          vString = `${clienteSeleccionadoTemp.marcaModelo || "Sin modelo"} (${clienteSeleccionadoTemp.patente})`;
        }
      }

      const clienteNombre = clienteSeleccionadoTemp
        ? clienteSeleccionadoTemp.nombre
        : busquedaCliente;

      // Obtener info de mecanicos
      const mecanicosInfo = usuariosTaller
        .filter((u) => form.mecanicosIds.includes(u.email))
        .map((u) => ({
          email: u.email,
          nombre: u.displayName || u.email.split("@")[0],
        }));

      // Chequear si cambiaron los mecánicos para armar historial
      let historial = [...form.historialAsignaciones];
      const stringMecsAnterior =
        isEditing && form.historialAsignaciones.length > 0
          ? form.historialAsignaciones[
              form.historialAsignaciones.length - 1
            ].mecanicos
              .map((m) => m.email)
              .sort()
              .join(",")
          : "";
      const stringMecsActual = mecanicosInfo
        .map((m) => m.email)
        .sort()
        .join(",");

      if (!isEditing || stringMecsAnterior !== stringMecsActual) {
        historial.push({
          fecha: new Date(),
          asignadoPor:
            ctx.user?.displayName || ctx.user?.email?.split("@")[0] || "Admin",
          mecanicos: mecanicosInfo,
        });
      }

      const ref = doc(ctx.firestore, "trabajosTaller", chunkDocId);

      const payload = {
        id,
        chunkDoc: chunkDocId,
        clienteId: form.clienteId,
        clienteNombre: clienteNombre,
        vehiculo: vString,
        descripcion: form.descripcion,
        mecanicosIds: form.mecanicosIds,
        mecanicosInfo: mecanicosInfo,
        estado: form.estado,
        tareas: form.tareas,
        historialAsignaciones: historial,
      };

      if (!isEditing) {
        payload.comentarios = [];
        payload.createdAt = new Date();
      }

      await setDoc(ref, { [key]: payload }, { merge: true });

      toast.success(isEditing ? "Orden actualizada" : "Orden creada");
      setShowModalForm(false);

      // Actualiza el modal de detalles si quedó por debajo
      if (isEditing && selectedTrabajoDetail) {
        setSelectedTrabajoDetail({ ...selectedTrabajoDetail, ...payload });
      }
    } catch (error) {
      console.error(error);
      toast.error("Error al guardar la orden");
    } finally {
      setGuardando(false);
    }
  };

  const cambiarEstadoRapido = async (id, chunkDoc, nuevoEstado) => {
    try {
      const ref = doc(ctx.firestore, "trabajosTaller", chunkDoc);
      await updateDoc(ref, { [`t_${id}.estado`]: nuevoEstado });
      toast.success(`Movido a ${nuevoEstado}`);

      // Actualizar detalle si está abierto
      if (selectedTrabajoDetail && selectedTrabajoDetail.id === id) {
        setSelectedTrabajoDetail({
          ...selectedTrabajoDetail,
          estado: nuevoEstado,
        });
      }
    } catch (error) {
      console.error(error);
      toast.error("No se pudo actualizar el estado");
    }
  };

  const eliminarTrabajo = async (id, chunkDoc) => {
    if (!window.confirm("¿Eliminar esta orden de trabajo permanentemente?"))
      return;
    try {
      const ref = doc(ctx.firestore, "trabajosTaller", chunkDoc);
      await updateDoc(ref, { [`t_${id}`]: deleteField() });
      toast.success("Orden eliminada");
      setSelectedTrabajoDetail(null);
    } catch (error) {
      console.error(error);
      toast.error("Error al eliminar");
    }
  };

  const agregarComentario = async (e) => {
    e.preventDefault();
    if (!nuevoComentario.trim() || !selectedTrabajoDetail) return;

    setGuardandoMsg(true);
    try {
      const ref = doc(
        ctx.firestore,
        "trabajosTaller",
        selectedTrabajoDetail.chunkDoc,
      );
      const commentObj = {
        texto: nuevoComentario.trim(),
        fecha: new Date(),
        autor:
          ctx.user?.displayName || ctx.user?.email?.split("@")[0] || "Admin",
      };

      await updateDoc(ref, {
        [`t_${selectedTrabajoDetail.id}.comentarios`]: arrayUnion(commentObj),
      });

      setNewComentario("");
      setSelectedTrabajoDetail((prev) => ({
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

  const renderColumna = (titulo, colorClass, borderClass, arrayTrabajos) => (
    <div className="bg-[#112C3E] rounded-2xl p-5 border border-white/10 flex flex-col h-[70vh] shadow-xl">
      <div className="flex items-center justify-between mb-4 border-b border-white/10 pb-3">
        <h4
          className={`text-sm uppercase tracking-widest font-bold ${colorClass}`}
        >
          {titulo}
        </h4>
        <span className="bg-white/5 px-2.5 py-1 rounded-lg text-xs font-semibold text-white/70">
          {arrayTrabajos.length}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto space-y-4 pr-1 -mr-1">
        {arrayTrabajos.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full opacity-40">
            <span className="text-3xl mb-2">📋</span>
            <p className="text-sm italic">Vacío</p>
          </div>
        ) : (
          arrayTrabajos.map((t) => {
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
                onClick={() => setSelectedTrabajoDetail(t)}
                className={`bg-[#0C212D] p-4 rounded-xl relative group transition hover:-translate-y-1 hover:shadow-lg border-l-4 border-y border-r border-y-white/5 border-r-white/5 ${borderClass} cursor-pointer`}
              >
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    abrirEditar(t);
                  }}
                  title="Editar orden"
                  className="absolute top-2 right-9 text-white/40 hover:text-white opacity-0 group-hover:opacity-100 transition p-1 bg-[#112C3E] rounded-md z-10"
                >
                  ✏️
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    eliminarTrabajo(t.id, t.chunkDoc);
                  }}
                  title="Eliminar orden"
                  className="absolute top-2 right-2 text-white/20 hover:text-red-400 opacity-0 group-hover:opacity-100 transition p-1 bg-[#112C3E] rounded-md z-10"
                >
                  ✕
                </button>

                <p className="font-semibold text-white text-base pr-12 leading-tight mb-3 truncate">
                  {t.descripcion}
                </p>

                <div className="space-y-1 mb-3">
                  <p className="text-xs text-white/60 flex items-center gap-1.5">
                    <span className="opacity-50">👤</span>{" "}
                    <span className="truncate">{t.clienteNombre}</span>
                  </p>
                  <p className="text-xs text-white/60 flex items-center gap-1.5">
                    <span className="opacity-50">🚗</span>{" "}
                    <span className="truncate">{t.vehiculo}</span>
                  </p>
                  <p
                    className={`text-xs flex items-center gap-1.5 ${(!t.mecanicosInfo || t.mecanicosInfo.length === 0) && !t.mecanico ? "text-orange-400" : "text-emerald-400"}`}
                  >
                    <span className="opacity-50">👥</span>{" "}
                    <span className="truncate">
                      {renderNombresMecanicos(t)}
                    </span>
                  </p>
                </div>

                {tareasTotales > 0 && (
                  <div className="mb-3">
                    <p className="text-[10px] text-white/40 mb-1 font-semibold uppercase tracking-wider">
                      Subtareas: {tareasCompletadas}/{tareasTotales}
                    </p>
                    <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden flex">
                      <div
                        className="h-full bg-emerald-400 transition-all duration-300"
                        style={{ width: `${progreso}%` }}
                      ></div>
                    </div>
                  </div>
                )}

                <div
                  className="flex items-center gap-3 pt-3 border-t border-white/5 mt-auto"
                  onClick={(e) => e.stopPropagation()}
                >
                  <span className="text-xs text-white/40 flex items-center gap-1 bg-white/5 px-2 py-1.5 rounded-lg whitespace-nowrap">
                    💬 {t.comentarios?.length || 0}
                  </span>
                  <select
                    value={t.estado}
                    onChange={(e) =>
                      cambiarEstadoRapido(t.id, t.chunkDoc, e.target.value)
                    }
                    className="w-full bg-[#112C3E] text-xs text-white/80 border border-white/10 rounded-lg p-1.5 focus:outline-none focus:border-emerald-400 transition cursor-pointer font-medium"
                  >
                    <option value="Sin comenzar">⏳ Sin comenzar</option>
                    <option value="En proceso">🔧 En proceso</option>
                    <option value="Terminado">✅ Terminado</option>
                  </select>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );

  return (
    <div className="animate-in fade-in duration-200">
      <div className="flex items-center justify-between mb-6 pb-4 border-b border-white/10">
        <div>
          <h3 className="text-xl font-semibold text-white tracking-tight">
            Tablero Kanban
          </h3>
          <p className="text-sm text-white/50 mt-1">
            Gestión de órdenes y tareas del taller.
          </p>
        </div>
        <button
          onClick={abrirCrear}
          className="bg-emerald-500 hover:bg-emerald-600 text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition shadow-lg flex items-center gap-2"
        >
          <span>+</span> Nueva Orden
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {renderColumna(
          "Sin comenzar",
          "text-white/80",
          "border-l-white/20",
          trabajosSinComenzar,
        )}
        {renderColumna(
          "En proceso",
          "text-emerald-400",
          "border-l-emerald-500",
          trabajosEnProceso,
        )}
        {renderColumna(
          "Terminado",
          "text-sky-400",
          "border-l-sky-500",
          trabajosTerminados,
        )}
      </div>

      {/* ========================================================= */}
      {/* MODAL: VER DETALLES Y COMENTARIOS (ADMIN) */}
      {/* ========================================================= */}
      {selectedTrabajoDetail && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
          <div className="bg-[#0C212D] border border-white/10 rounded-3xl w-full max-w-5xl max-h-[90vh] flex flex-col shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between p-6 border-b border-white/10 bg-[#112C3E] rounded-t-3xl shrink-0">
              <div>
                <h3 className="text-xl font-bold text-white tracking-tight">
                  Detalles de la Orden
                </h3>
                <p className="text-sm text-white/50 mt-1">
                  Cliente: {selectedTrabajoDetail.clienteNombre} | Ref:{" "}
                  {selectedTrabajoDetail.vehiculo}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => abrirEditar(selectedTrabajoDetail)}
                  className="bg-white/10 hover:bg-white/20 text-white px-5 py-2 rounded-xl text-sm font-semibold transition"
                >
                  Editar Orden
                </button>
                <button
                  onClick={() => setSelectedTrabajoDetail(null)}
                  className="text-white/50 hover:text-white transition bg-white/5 hover:bg-white/10 p-2 rounded-xl"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="p-6 overflow-y-auto flex-1 grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Info + Tareas (Toma 1 columna en Desktop) */}
              <div className="lg:col-span-1 flex flex-col gap-4">
                <div className="bg-[#112C3E] border border-white/5 p-4 rounded-2xl">
                  <p className="text-[10px] uppercase tracking-widest text-emerald-400 font-bold mb-1">
                    Descripción
                  </p>
                  <p className="text-white text-sm font-medium leading-relaxed">
                    {selectedTrabajoDetail.descripcion}
                  </p>
                </div>

                <div className="bg-[#112C3E] border border-white/5 p-4 rounded-2xl space-y-3 text-sm">
                  <div className="flex flex-col border-b border-white/5 pb-3 gap-1">
                    <span className="text-white/50 text-xs">
                      Equipo Asignado:
                    </span>
                    <span className="text-white font-medium">
                      {renderNombresMecanicos(selectedTrabajoDetail)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-white/50 text-xs">
                      Estado Actual:
                    </span>
                    <select
                      value={selectedTrabajoDetail.estado}
                      onChange={(e) =>
                        cambiarEstadoRapido(
                          selectedTrabajoDetail.id,
                          selectedTrabajoDetail.chunkDoc,
                          e.target.value,
                        )
                      }
                      className="bg-[#0C212D] text-emerald-400 font-bold border border-white/10 rounded-lg px-2 py-1 text-xs focus:outline-none"
                    >
                      <option value="Sin comenzar">Sin comenzar</option>
                      <option value="En proceso">En proceso</option>
                      <option value="Terminado">Terminado</option>
                    </select>
                  </div>
                </div>

                <div className="bg-[#112C3E] border border-white/5 p-4 rounded-2xl flex-1 min-h-[200px]">
                  <p className="text-[10px] uppercase tracking-widest text-emerald-400 font-bold mb-3 border-b border-white/5 pb-2">
                    Checklist de Tareas
                  </p>
                  {!selectedTrabajoDetail.tareas ||
                  selectedTrabajoDetail.tareas.length === 0 ? (
                    <p className="text-xs text-white/40 italic">
                      No hay subtareas registradas.
                    </p>
                  ) : (
                    <div className="space-y-2 mt-2">
                      {selectedTrabajoDetail.tareas.map((tarea, idx) => (
                        <div
                          key={idx}
                          className={`flex items-start gap-3 p-3 rounded-xl border ${tarea.completada ? "bg-emerald-500/10 border-emerald-500/20" : "bg-[#0C212D] border-white/5"} transition`}
                        >
                          <div
                            className={`mt-0.5 shrink-0 w-4 h-4 rounded border flex items-center justify-center ${tarea.completada ? "bg-emerald-500 border-emerald-500 text-white" : "bg-[#112C3E] border-gray-500"}`}
                          >
                            {tarea.completada && (
                              <span className="text-[10px]">✓</span>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p
                              className={`text-sm leading-snug ${tarea.completada ? "text-white/40 line-through" : "text-white/90"}`}
                            >
                              {tarea.descripcion}
                            </p>
                            {tarea.completada && tarea.fechaCompletada && (
                              <p className="text-[9px] text-emerald-400/70 mt-1.5 font-medium bg-emerald-400/10 inline-block px-1.5 py-0.5 rounded">
                                ✓ Por {tarea.completadaPor} (
                                {tarea.fechaCompletada.toDate
                                  ? tarea.fechaCompletada
                                      .toDate()
                                      .toLocaleString()
                                  : new Date(
                                      tarea.fechaCompletada,
                                    ).toLocaleString()}
                                )
                              </p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Centro: Historial Asignaciones (Toma 1 columna) */}
              <div className="lg:col-span-1 bg-[#112C3E] border border-white/5 p-5 rounded-2xl flex flex-col h-full">
                <h4 className="text-xs uppercase tracking-widest text-white/50 font-bold mb-4 shrink-0 border-b border-white/10 pb-2">
                  Historial de Asignaciones
                </h4>
                <div className="flex-1 overflow-y-auto space-y-5 pr-1">
                  {!selectedTrabajoDetail.historialAsignaciones ||
                  selectedTrabajoDetail.historialAsignaciones.length === 0 ? (
                    <p className="text-xs text-white/40 italic text-center py-4">
                      No hay historial registrado.
                    </p>
                  ) : (
                    selectedTrabajoDetail.historialAsignaciones.map(
                      (h, idx) => (
                        <div
                          key={idx}
                          className="relative pl-5 border-l-2 border-emerald-500/30 pb-2"
                        >
                          <div className="absolute w-3 h-3 bg-emerald-500 rounded-full -left-[7px] top-0.5 shadow-[0_0_8px_rgba(16,185,129,0.6)]"></div>
                          <p className="text-[10px] text-white/40 mb-1 font-mono">
                            {h.fecha?.toDate
                              ? h.fecha.toDate().toLocaleString()
                              : new Date(h.fecha).toLocaleString()}
                          </p>
                          <p className="text-xs text-white/80 mb-2">
                            Asignado por:{" "}
                            <strong className="text-emerald-400">
                              {h.asignadoPor}
                            </strong>
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {h.mecanicos && h.mecanicos.length > 0 ? (
                              h.mecanicos.map((m, i) => (
                                <span
                                  key={i}
                                  className="text-[10px] font-semibold tracking-wide bg-white/10 border border-white/5 px-2 py-1 rounded-md text-white"
                                >
                                  {m.nombre}
                                </span>
                              ))
                            ) : (
                              <span className="text-[10px] font-semibold bg-red-500/20 text-red-400 px-2 py-1 rounded-md">
                                Desasignado
                              </span>
                            )}
                          </div>
                        </div>
                      ),
                    )
                  )}
                </div>
              </div>

              {/* Derecha: Comentarios (Toma 1 columna) */}
              <div className="lg:col-span-1 bg-[#112C3E] border border-white/5 p-5 rounded-2xl flex flex-col h-full">
                <h4 className="text-xs uppercase tracking-widest text-white/50 font-bold mb-4 shrink-0 border-b border-white/10 pb-2">
                  Bitácora / Mensajes
                </h4>
                <div className="space-y-3 flex-1 overflow-y-auto mb-4 pr-1">
                  {!selectedTrabajoDetail.comentarios ||
                  selectedTrabajoDetail.comentarios.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center opacity-40">
                      <span className="text-3xl mb-2">💬</span>
                      <p className="text-sm italic">Sin comentarios.</p>
                    </div>
                  ) : (
                    selectedTrabajoDetail.comentarios.map((msg, i) => {
                      const soyYo =
                        msg.autor ===
                        (ctx.user?.displayName ||
                          ctx.user?.email?.split("@")[0] ||
                          "Admin");
                      return (
                        <div
                          key={i}
                          className={`p-3 rounded-xl max-w-[95%] ${soyYo ? "bg-emerald-500/20 border border-emerald-500/30 ml-auto rounded-tr-sm" : "bg-[#0C212D] border border-white/10 mr-auto rounded-tl-sm"}`}
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
                    placeholder="Mensaje..."
                    className="flex-1 bg-[#0C212D] border border-white/10 text-white rounded-xl p-2.5 text-sm focus:outline-none focus:border-emerald-400 transition"
                  />
                  <button
                    disabled={guardandoMsg || !nuevoComentario.trim()}
                    type="submit"
                    className="bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white font-semibold px-4 rounded-xl transition shadow-lg"
                  >
                    ➤
                  </button>
                </form>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL: FORMULARIO (NUEVA ORDEN / EDITAR ORDEN) */}
      {/* ========================================================= */}
      {showModalForm && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
          <div className="bg-[#0C212D] border border-white/10 rounded-3xl w-full max-w-4xl overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between p-6 border-b border-white/10 bg-[#0C212D]/95 shrink-0">
              <div>
                <h3 className="text-xl font-bold text-white tracking-tight">
                  {isEditing
                    ? "Editar Orden de Trabajo"
                    : "Crear Orden de Trabajo"}
                </h3>
              </div>
              <button
                onClick={cerrarModalForm}
                className="text-white/50 hover:text-white transition bg-white/5 hover:bg-white/10 p-2 rounded-xl"
              >
                ✕
              </button>
            </div>

            <form
              onSubmit={guardarTrabajo}
              className="p-6 flex flex-col gap-6 overflow-y-auto"
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Lado Izquierdo: Info Principal */}
                <div className="space-y-6">
                  {/* Bloque 1: Cliente/Vehiculo */}
                  <div className="bg-[#112C3E] p-5 rounded-2xl border border-white/5 space-y-4">
                    <h4 className="text-[10px] uppercase tracking-widest text-emerald-400 font-bold">
                      1. Cliente y Vehículo
                    </h4>

                    <div className="relative" ref={dropdownRef}>
                      <input
                        type="text"
                        value={busquedaCliente}
                        onChange={(e) => {
                          setBusquedaCliente(e.target.value);
                          setMostrarDropdown(true);
                          setForm({
                            ...form,
                            clienteId: "",
                            vehiculoIndex: "",
                            vehiculoString: "",
                          });
                          setClienteSeleccionadoTemp(null);
                        }}
                        onFocus={() => setMostrarDropdown(true)}
                        placeholder="Buscar cliente..."
                        className="w-full bg-[#0C212D] border border-white/10 text-white rounded-xl p-3 text-sm focus:outline-none focus:border-emerald-400"
                        required
                      />
                      {mostrarDropdown && (
                        <ul className="absolute z-50 w-full bg-[#112C3E] border border-white/10 rounded-xl mt-1 max-h-48 overflow-y-auto shadow-2xl">
                          {clientesFiltrados.length === 0 ? (
                            <li className="p-3 text-sm text-white/50 italic text-center">
                              No encontrado
                            </li>
                          ) : (
                            clientesFiltrados.map((c) => (
                              <li
                                key={c.id}
                                onClick={() => {
                                  setForm({
                                    ...form,
                                    clienteId: c.id,
                                    vehiculoIndex: "",
                                    vehiculoString: "",
                                  });
                                  setBusquedaCliente(`${c.nombre}`);
                                  setClienteSeleccionadoTemp(c);
                                  setMostrarDropdown(false);
                                }}
                                className="p-3 border-b border-white/5 text-sm hover:bg-white/10 cursor-pointer"
                              >
                                {c.nombre}
                              </li>
                            ))
                          )}
                        </ul>
                      )}
                    </div>

                    {(clienteSeleccionadoTemp || form.vehiculoString) && (
                      <div className="animate-in fade-in">
                        <select
                          required={!form.vehiculoString}
                          value={form.vehiculoIndex}
                          onChange={(e) =>
                            setForm({ ...form, vehiculoIndex: e.target.value })
                          }
                          className="w-full bg-[#0C212D] border border-white/10 text-white rounded-xl p-3 text-sm focus:outline-none focus:border-emerald-400"
                        >
                          {form.vehiculoString && (
                            <option value="">
                              {form.vehiculoString} (Actual)
                            </option>
                          )}
                          {!form.vehiculoString && (
                            <option value="">Seleccione vehículo...</option>
                          )}

                          {clienteSeleccionadoTemp?.vehiculos?.map((v, i) => (
                            <option key={i} value={i}>
                              {v.marcaModelo || "Sin modelo"} - {v.patente}
                            </option>
                          ))}
                          {clienteSeleccionadoTemp?.patente &&
                            !clienteSeleccionadoTemp?.vehiculos && (
                              <option value="0">
                                {clienteSeleccionadoTemp.marcaModelo} -{" "}
                                {clienteSeleccionadoTemp.patente}
                              </option>
                            )}
                        </select>
                      </div>
                    )}
                  </div>

                  {/* Bloque 2: Descripción y Estado */}
                  <div className="bg-[#112C3E] p-5 rounded-2xl border border-white/5 space-y-4">
                    <h4 className="text-[10px] uppercase tracking-widest text-emerald-400 font-bold">
                      2. Descripción y Estado
                    </h4>

                    <textarea
                      required
                      rows="2"
                      value={form.descripcion}
                      onChange={(e) =>
                        setForm({ ...form, descripcion: e.target.value })
                      }
                      placeholder="Descripción general..."
                      className="w-full bg-[#0C212D] border border-white/10 text-white rounded-xl p-3 text-sm focus:outline-none focus:border-emerald-400 resize-none"
                    />

                    <div>
                      <select
                        value={form.estado}
                        onChange={(e) =>
                          setForm({ ...form, estado: e.target.value })
                        }
                        className="w-full bg-[#0C212D] border border-white/10 text-white rounded-xl p-3 text-sm focus:outline-none focus:border-emerald-400"
                      >
                        <option value="Sin comenzar">Sin comenzar</option>
                        <option value="En proceso">En proceso</option>
                        <option value="Terminado">Terminado</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Lado Derecho: Mecánicos y Tareas */}
                <div className="space-y-6 flex flex-col h-full">
                  {/* Bloque 3: Asignación Múltiple */}
                  <div className="bg-[#112C3E] p-5 rounded-2xl border border-white/5 shrink-0">
                    <h4 className="text-[10px] uppercase tracking-widest text-emerald-400 font-bold mb-2">
                      3. Equipo Asignado
                    </h4>
                    <p className="text-[10px] text-white/50 mb-3">
                      Seleccioná uno o más mecánicos. Quedará guardado en el
                      historial.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {usuariosTaller.map((u) => {
                        const isSelected = form.mecanicosIds.includes(u.email);
                        return (
                          <div
                            key={u.email}
                            onClick={() => toggleMecanico(u.email)}
                            className={`cursor-pointer px-3 py-1.5 rounded-lg text-xs font-semibold transition border select-none ${isSelected ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-400" : "bg-[#0C212D] border-white/10 text-white/60 hover:bg-white/5"}`}
                          >
                            {isSelected && <span className="mr-1">✓</span>}
                            {u.displayName || u.email.split("@")[0]}
                          </div>
                        );
                      })}
                      {usuariosTaller.length === 0 && (
                        <p className="text-xs text-white/40 italic">
                          No hay mecánicos registrados.
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Bloque 4: Tareas / Checklist */}
                  <div className="bg-[#112C3E] p-5 rounded-2xl border border-white/5 flex flex-col flex-1 min-h-[200px]">
                    <h4 className="text-[10px] uppercase tracking-widest text-emerald-400 font-bold mb-4">
                      4. Subtareas (Opcional)
                    </h4>

                    <div className="flex gap-2 mb-4 shrink-0">
                      <input
                        type="text"
                        value={nuevaTareaDesc}
                        onChange={(e) => setNuevaTareaDesc(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            agregarTareaForm();
                          }
                        }}
                        placeholder="Ej: Cambiar filtro de aceite..."
                        className="flex-1 bg-[#0C212D] border border-white/10 text-white rounded-xl p-2.5 text-sm focus:outline-none focus:border-emerald-400"
                      />
                      <button
                        type="button"
                        onClick={agregarTareaForm}
                        disabled={!nuevaTareaDesc.trim()}
                        className="bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white px-4 rounded-xl font-bold transition"
                      >
                        +
                      </button>
                    </div>

                    <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                      {form.tareas.length === 0 ? (
                        <p className="text-xs text-white/40 italic text-center mt-4">
                          Sin subtareas agregadas.
                        </p>
                      ) : (
                        form.tareas.map((tarea, index) => (
                          <div
                            key={index}
                            className="flex items-center justify-between bg-[#0C212D] p-3 rounded-xl border border-white/5 group"
                          >
                            <span
                              className={`text-sm truncate flex-1 pr-2 ${tarea.completada ? "text-white/40 line-through" : "text-white/90"}`}
                            >
                              {tarea.descripcion}
                            </span>
                            <div className="flex items-center gap-3">
                              {tarea.completada && (
                                <span className="text-[9px] text-emerald-400 font-bold bg-emerald-400/10 px-1.5 py-0.5 rounded">
                                  HECHO
                                </span>
                              )}
                              <button
                                type="button"
                                onClick={() => eliminarTareaForm(index)}
                                className="text-white/30 hover:text-red-400 opacity-0 group-hover:opacity-100 transition px-1"
                              >
                                ✕
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 mt-2 border-t border-white/10 shrink-0">
                <button
                  type="button"
                  onClick={cerrarModalForm}
                  className="px-6 py-3 rounded-xl text-sm font-semibold text-white/70 hover:bg-white/10 transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={guardando || !form.clienteId}
                  className="bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white font-semibold px-8 py-3 rounded-xl transition shadow-lg"
                >
                  {guardando
                    ? "Guardando..."
                    : isEditing
                      ? "Guardar Cambios"
                      : "Crear Orden"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
