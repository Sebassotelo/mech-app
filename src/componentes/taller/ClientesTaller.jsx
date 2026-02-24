import { useState, useContext, useMemo } from "react";
import ContextGeneral from "@/servicios/contextGeneral";
import {
  collection,
  doc,
  setDoc,
  updateDoc,
  deleteField,
  getDocs,
} from "firebase/firestore";
import { toast } from "sonner";

export default function ClientesTaller() {
  const ctx = useContext(ContextGeneral);

  // Control de Modales
  const [showFormModal, setShowFormModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);

  // Detalle profundo de una orden (para ver comentarios desde el perfil del cliente)
  const [selectedOrdenDetail, setSelectedOrdenDetail] = useState(null);

  const [selectedClient, setSelectedClient] = useState(null);
  const [guardando, setGuardando] = useState(false);

  // Buscador
  const [searchQuery, setSearchQuery] = useState("");

  // Estado del formulario
  const [formData, setFormData] = useState({
    nombre: "",
    telefono: "",
    vehiculos: [],
  });

  // --- NAVEGACIÓN Y VISTAS ---

  const verDetalle = (cliente) => {
    setSelectedClient(cliente);
    setShowDetailModal(true);
    setShowFormModal(false);
  };

  const abrirFormularioNuevo = () => {
    setSelectedClient(null);
    setFormData({
      nombre: "",
      telefono: "",
      vehiculos: [{ patente: "", marcaModelo: "" }],
    });
    setShowDetailModal(false);
    setShowFormModal(true);
  };

  const abrirFormularioEditar = (cliente) => {
    setSelectedClient(cliente);

    let vehiculosCargados = [];
    if (cliente.vehiculos && cliente.vehiculos.length > 0) {
      vehiculosCargados = [...cliente.vehiculos];
    } else if (cliente.patente) {
      vehiculosCargados = [
        { patente: cliente.patente, marcaModelo: cliente.marcaModelo || "" },
      ];
    } else {
      vehiculosCargados = [{ patente: "", marcaModelo: "" }];
    }

    setFormData({
      nombre: cliente.nombre || "",
      telefono: cliente.telefono || "",
      vehiculos: vehiculosCargados,
    });
    setShowDetailModal(false);
    setShowFormModal(true);
  };

  const cerrarModales = () => {
    setShowFormModal(false);
    setShowDetailModal(false);
    setSelectedOrdenDetail(null);
    setSelectedClient(null);
  };

  // --- MANEJO DEL FORMULARIO ---

  const handleInputChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleVehiculoChange = (index, field, value) => {
    const nuevosVehiculos = [...formData.vehiculos];
    nuevosVehiculos[index][field] = value;
    setFormData({ ...formData, vehiculos: nuevosVehiculos });
  };

  const agregarVehiculo = () => {
    setFormData({
      ...formData,
      vehiculos: [...formData.vehiculos, { patente: "", marcaModelo: "" }],
    });
  };

  const eliminarVehiculoForm = (index) => {
    const nuevosVehiculos = formData.vehiculos.filter((_, i) => i !== index);
    setFormData({ ...formData, vehiculos: nuevosVehiculos });
  };

  // --- CRUD FIREBASE ---

  const guardarCliente = async (e) => {
    e.preventDefault();
    if (!formData.nombre) {
      toast.error("El nombre es obligatorio");
      return;
    }

    const vehiculosValidos = formData.vehiculos
      .filter((v) => v.patente.trim() !== "")
      .map((v) => ({ ...v, patente: v.patente.toUpperCase().trim() }));

    if (vehiculosValidos.length === 0) {
      toast.error("Debe ingresar al menos un vehículo con patente");
      return;
    }

    setGuardando(true);
    try {
      const isEdit = !!selectedClient;
      const id = isEdit ? selectedClient.id : Date.now().toString();
      const key = `c_${id}`;

      let chunkDocId = isEdit ? selectedClient.chunkDoc : null;

      if (!chunkDocId) {
        const snap = await getDocs(collection(ctx.firestore, "clientesTaller"));
        for (const docSnap of snap.docs) {
          const data = docSnap.data();
          const keysCount = Object.keys(data).filter((k) =>
            k.startsWith("c_"),
          ).length;
          if (keysCount < 100) {
            chunkDocId = docSnap.id;
            break;
          }
        }
        if (!chunkDocId) {
          chunkDocId = doc(collection(ctx.firestore, "clientesTaller")).id;
        }
      }

      const ref = doc(ctx.firestore, "clientesTaller", chunkDocId);

      const datosGuardar = {
        id,
        chunkDoc: chunkDocId,
        nombre: formData.nombre,
        telefono: formData.telefono,
        vehiculos: vehiculosValidos,
        patente: deleteField(),
        marcaModelo: deleteField(),
        updatedAt: new Date(),
      };

      if (!isEdit) datosGuardar.createdAt = new Date();

      await setDoc(ref, { [key]: datosGuardar }, { merge: true });

      toast.success(isEdit ? "Cliente actualizado" : "Cliente creado");

      if (isEdit) {
        delete datosGuardar.patente;
        delete datosGuardar.marcaModelo;
        verDetalle({ ...selectedClient, ...datosGuardar });
      } else {
        cerrarModales();
      }
    } catch (error) {
      console.error("Error guardando cliente:", error);
      toast.error("Ocurrió un error al guardar");
    } finally {
      setGuardando(false);
    }
  };

  const eliminarCliente = async (id, chunkDoc) => {
    if (
      !window.confirm(
        "¿Seguro que querés eliminar a este cliente permanentemente?",
      )
    )
      return;
    try {
      const ref = doc(ctx.firestore, "clientesTaller", chunkDoc);
      await updateDoc(ref, { [`c_${id}`]: deleteField() });
      toast.success("Cliente eliminado");
      cerrarModales();
    } catch (error) {
      console.error("Error eliminando:", error);
      toast.error("Error al eliminar");
    }
  };

  // --- FILTROS Y RENDERS ---
  const clientesFiltrados = useMemo(() => {
    if (!searchQuery) return ctx.clientesTaller || [];
    const lowerQ = searchQuery.toLowerCase();

    return (ctx.clientesTaller || []).filter((c) => {
      const matchNombre = c.nombre.toLowerCase().includes(lowerQ);
      const matchTel = (c.telefono || "").toLowerCase().includes(lowerQ);
      const matchVehiculo =
        c.vehiculos?.some(
          (v) =>
            v.patente.toLowerCase().includes(lowerQ) ||
            (v.marcaModelo || "").toLowerCase().includes(lowerQ),
        ) || (c.patente || "").toLowerCase().includes(lowerQ);

      return matchNombre || matchTel || matchVehiculo;
    });
  }, [ctx.clientesTaller, searchQuery]);

  const trabajosDelCliente =
    ctx.trabajosTaller?.filter((t) => t.clienteId === selectedClient?.id) || [];

  const renderIconEstado = (estado) => {
    switch (estado) {
      case "Sin comenzar":
        return <span className="text-white/40">⏳</span>;
      case "En proceso":
        return <span className="text-emerald-400">🔧</span>;
      case "Terminado":
        return <span className="text-sky-400">✅</span>;
      default:
        return null;
    }
  };

  const renderNombresMecanicos = (t) => {
    if (t.mecanicosInfo && t.mecanicosInfo.length > 0) {
      return t.mecanicosInfo.map((m) => m.nombre).join(", ");
    }
    return t.mecanico || "Sin asignar";
  };

  // ==========================================
  // RENDER PRINCIPAL (LISTA)
  // ==========================================
  return (
    <div className="animate-in fade-in duration-200">
      {/* Encabezado Lista */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between border-b border-white/10 mb-6 pb-4 gap-4">
        <div>
          <h3 className="text-xl font-semibold text-white tracking-tight">
            Directorio de Clientes
          </h3>
          <p className="text-sm text-white/50 mt-1">
            Total registrados: {ctx.clientesTaller?.length || 0}
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
          <input
            type="text"
            placeholder="Buscar por nombre, patente..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-[#0C212D] border border-white/10 text-white text-sm rounded-xl px-4 py-2 focus:outline-none focus:border-emerald-400 transition w-full sm:w-64"
          />
          <button
            onClick={abrirFormularioNuevo}
            className="bg-emerald-500 hover:bg-emerald-600 text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition shadow-lg flex items-center justify-center gap-2 whitespace-nowrap"
          >
            <span>+</span> Nuevo Cliente
          </button>
        </div>
      </div>

      {/* Tabla */}
      <div className="bg-[#112C3E] border border-white/10 rounded-2xl overflow-hidden shadow-xl">
        {clientesFiltrados.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 opacity-60">
            <span className="text-4xl mb-3">👥</span>
            <p className="text-sm italic">
              {searchQuery
                ? "No se encontraron clientes con esa búsqueda."
                : "No hay clientes registrados en el sistema."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-white/5 text-white/60 uppercase tracking-wider text-[11px] font-semibold border-b border-white/10">
                <tr>
                  <th className="px-5 py-4">Cliente</th>
                  <th className="px-5 py-4">Contacto</th>
                  <th className="px-5 py-4">Flota</th>
                  <th className="px-5 py-4 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {clientesFiltrados.map((cliente) => (
                  <tr
                    key={cliente.id}
                    onClick={() => verDetalle(cliente)}
                    className="hover:bg-white/5 transition cursor-pointer group"
                  >
                    <td className="px-5 py-4">
                      <p className="font-semibold text-white group-hover:text-emerald-400 transition text-base">
                        {cliente.nombre}
                      </p>
                    </td>
                    <td className="px-5 py-4 text-white/70">
                      {cliente.telefono || (
                        <span className="italic opacity-50">Sin teléfono</span>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/5 border border-white/10 text-xs text-white/80">
                          🚗{" "}
                          {cliente.vehiculos?.length ||
                            (cliente.patente ? 1 : 0)}
                        </span>
                        {cliente.vehiculos && cliente.vehiculos.length > 0 && (
                          <span className="text-xs text-white/40 truncate max-w-[120px] hidden md:inline-block">
                            ({cliente.vehiculos[0].patente}
                            {cliente.vehiculos.length > 1 ? ", ..." : ""})
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-4 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          abrirFormularioEditar(cliente);
                        }}
                        className="text-white/40 hover:text-white font-medium px-3 py-1.5 mr-2 transition rounded-lg hover:bg-white/5"
                      >
                        Editar
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          verDetalle(cliente);
                        }}
                        className="text-emerald-400 hover:text-emerald-300 font-medium px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 rounded-lg transition"
                      >
                        Ver Perfil
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ========================================== */}
      {/* MODAL: DETALLE DEL CLIENTE */}
      {/* ========================================== */}
      {showDetailModal && selectedClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
          <div className="bg-[#0C212D] border border-white/10 rounded-3xl w-full max-w-5xl max-h-[90vh] flex flex-col shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            {/* Header Modal Detalle */}
            <div className="shrink-0 bg-[#0C212D]/95 backdrop-blur border-b border-white/10 p-6 flex items-start sm:items-center justify-between flex-col sm:flex-row gap-4 rounded-t-3xl z-10">
              <div>
                <h3 className="text-2xl font-bold text-white tracking-tight">
                  {selectedClient.nombre}
                </h3>
                <p className="text-sm text-white/60 mt-1 flex items-center gap-2">
                  <span>📞</span>{" "}
                  {selectedClient.telefono || "Sin teléfono registrado"}
                </p>
              </div>
              <div className="flex items-center gap-3 w-full sm:w-auto">
                <button
                  onClick={() => abrirFormularioEditar(selectedClient)}
                  className="flex-1 sm:flex-none bg-white/10 hover:bg-white/20 text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition"
                >
                  Editar Perfil
                </button>
                <button
                  onClick={cerrarModales}
                  className="p-2 text-white/50 hover:text-white transition rounded-xl hover:bg-white/5"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Columna Izquierda: Vehículos */}
              <div className="lg:col-span-1">
                <h4 className="text-xs uppercase tracking-widest text-emerald-400 font-bold mb-4">
                  Flota de Vehículos
                </h4>
                <div className="space-y-3">
                  {selectedClient.vehiculos &&
                  selectedClient.vehiculos.length > 0 ? (
                    selectedClient.vehiculos.map((v, i) => (
                      <div
                        key={i}
                        className="bg-[#112C3E] border border-white/10 p-4 rounded-2xl flex justify-between items-center shadow-sm"
                      >
                        <div>
                          <p className="font-semibold text-white leading-tight">
                            {v.marcaModelo || "Sin modelo"}
                          </p>
                          <p className="text-xs text-emerald-400 font-mono mt-1 bg-emerald-400/10 px-2 py-0.5 rounded inline-block">
                            {v.patente}
                          </p>
                        </div>
                        <span className="text-2xl opacity-40">🚗</span>
                      </div>
                    ))
                  ) : selectedClient.patente ? (
                    <div className="bg-[#112C3E] border border-white/10 p-4 rounded-2xl flex justify-between items-center shadow-sm">
                      <div>
                        <p className="font-semibold text-white leading-tight">
                          {selectedClient.marcaModelo || "Sin modelo"}
                        </p>
                        <p className="text-xs text-emerald-400 font-mono mt-1 bg-emerald-400/10 px-2 py-0.5 rounded inline-block">
                          {selectedClient.patente}
                        </p>
                      </div>
                      <span className="text-2xl opacity-40">🚗</span>
                    </div>
                  ) : (
                    <div className="bg-[#112C3E]/50 border border-white/5 p-4 rounded-2xl text-center">
                      <p className="text-xs text-white/40 italic">
                        No hay vehículos registrados.
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Columna Derecha: Trabajos */}
              <div className="lg:col-span-2">
                <div className="flex items-center justify-between mb-4 border-b border-white/10 pb-2">
                  <h4 className="text-xs uppercase tracking-widest text-emerald-400 font-bold">
                    Historial de Órdenes
                  </h4>
                  <span className="text-xs bg-white/5 border border-white/10 px-2.5 py-1 rounded-lg text-white/70 font-medium">
                    {trabajosDelCliente.length} en total
                  </span>
                </div>

                {trabajosDelCliente.length === 0 ? (
                  <div className="bg-[#112C3E]/50 border border-white/5 rounded-2xl p-10 flex flex-col items-center justify-center opacity-60">
                    <span className="text-4xl mb-3">📋</span>
                    <p className="text-sm italic text-white/70">
                      Aún no hay órdenes de trabajo para este cliente.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {trabajosDelCliente.map((trabajo) => {
                      const tareasTotales = trabajo.tareas?.length || 0;
                      const tareasCompletadas =
                        trabajo.tareas?.filter((t) => t.completada).length || 0;
                      const progreso =
                        tareasTotales > 0
                          ? Math.round(
                              (tareasCompletadas / tareasTotales) * 100,
                            )
                          : 0;

                      return (
                        <div
                          key={trabajo.id}
                          className="bg-[#112C3E] border border-white/10 p-5 rounded-2xl flex flex-col gap-3 shadow-sm transition hover:border-white/20"
                        >
                          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                            <div className="flex items-center gap-2">
                              {renderIconEstado(trabajo.estado)}
                              <span
                                className={`text-[10px] uppercase tracking-wider font-bold px-2.5 py-1 rounded-md border ${
                                  trabajo.estado === "Sin comenzar"
                                    ? "bg-white/5 border-white/10 text-white/70"
                                    : trabajo.estado === "En proceso"
                                      ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                                      : "bg-sky-500/10 border-sky-500/20 text-sky-400"
                                }`}
                              >
                                {trabajo.estado}
                              </span>
                              <span className="text-xs text-white/40 font-mono ml-2">
                                ID: {trabajo.id.slice(-5)}
                              </span>
                            </div>
                            <p className="text-[11px] font-medium text-white/40 bg-white/5 px-2 py-1 rounded-md">
                              {trabajo.createdAt?.toDate
                                ? trabajo.createdAt
                                    .toDate()
                                    .toLocaleDateString()
                                : "Fecha N/A"}
                            </p>
                          </div>

                          <p className="font-semibold text-white text-base leading-snug">
                            {trabajo.descripcion}
                          </p>

                          <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-white/50">
                            <span>
                              <strong className="text-white/70">Ref:</strong>{" "}
                              {trabajo.vehiculo}
                            </span>
                            <span>
                              <strong className="text-white/70">Equipo:</strong>{" "}
                              {renderNombresMecanicos(trabajo)}
                            </span>
                          </div>

                          {/* Barra de progreso si hay tareas */}
                          {tareasTotales > 0 && (
                            <div className="flex items-center gap-3 w-full mt-1">
                              <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-emerald-400 transition-all duration-300"
                                  style={{ width: `${progreso}%` }}
                                />
                              </div>
                              <span className="text-[10px] text-white/50 whitespace-nowrap">
                                {tareasCompletadas}/{tareasTotales} tareas
                              </span>
                            </div>
                          )}

                          {/* Botón para ver bitácora completa */}
                          <div className="border-t border-white/5 pt-3 mt-1 flex justify-end">
                            <button
                              onClick={() => setSelectedOrdenDetail(trabajo)}
                              className="text-xs text-emerald-400 hover:text-emerald-300 font-semibold bg-emerald-400/10 hover:bg-emerald-400/20 px-3 py-1.5 rounded-lg transition"
                            >
                              Ver Bitácora y Comentarios (
                              {trabajo.comentarios?.length || 0})
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Footer Modal Detalle (Eliminar) */}
            <div className="p-6 border-t border-white/10 bg-[#112C3E]/50 flex justify-end shrink-0 rounded-b-3xl">
              <button
                onClick={() =>
                  eliminarCliente(selectedClient.id, selectedClient.chunkDoc)
                }
                className="text-red-400 hover:text-white hover:bg-red-500 px-4 py-2 rounded-xl text-sm font-semibold transition"
              >
                Eliminar Cliente Permanentemente
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* MODAL: VER DETALLE ESPECIFICO DE ORDEN (Desde el perfil) */}
      {/* ========================================== */}
      {selectedOrdenDetail && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-[#0C212D] border border-white/10 rounded-3xl w-full max-w-2xl flex flex-col max-h-[85vh] shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="p-5 border-b border-white/10 bg-[#112C3E] rounded-t-3xl flex justify-between items-center shrink-0">
              <div>
                <h4 className="text-white font-bold">Bitácora de Orden</h4>
                <p className="text-xs text-white/50">
                  {selectedOrdenDetail.descripcion}
                </p>
              </div>
              <button
                onClick={() => setSelectedOrdenDetail(null)}
                className="text-white/50 hover:text-white p-2"
              >
                ✕
              </button>
            </div>

            <div className="p-5 overflow-y-auto flex-1 space-y-4">
              {/* Mostrar tareas */}
              {selectedOrdenDetail.tareas &&
                selectedOrdenDetail.tareas.length > 0 && (
                  <div className="bg-white/5 p-4 rounded-xl border border-white/5">
                    <p className="text-[10px] uppercase tracking-widest text-emerald-400 font-bold mb-3">
                      Subtareas
                    </p>
                    <div className="space-y-2">
                      {selectedOrdenDetail.tareas.map((t, i) => (
                        <div key={i} className="flex items-start gap-3 text-sm">
                          <span
                            className={
                              t.completada
                                ? "text-emerald-400 mt-1"
                                : "text-white/30 mt-1"
                            }
                          >
                            {t.completada ? "✓" : "○"}
                          </span>
                          <div>
                            <span
                              className={
                                t.completada
                                  ? "text-white/50 line-through block"
                                  : "text-white/90 block"
                              }
                            >
                              {t.descripcion}
                            </span>
                            {t.completada && t.fechaCompletada && (
                              <p className="text-[9px] text-emerald-400/70 mt-0.5">
                                Hecho por {t.completadaPor} (
                                {t.fechaCompletada.toDate
                                  ? t.fechaCompletada.toDate().toLocaleString()
                                  : new Date(
                                      t.fechaCompletada,
                                    ).toLocaleString()}
                                )
                              </p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

              {/* Mostrar comentarios */}
              <div className="bg-white/5 p-4 rounded-xl border border-white/5 min-h-[200px]">
                <p className="text-[10px] uppercase tracking-widest text-emerald-400 font-bold mb-4">
                  Comentarios
                </p>
                <div className="space-y-3">
                  {!selectedOrdenDetail.comentarios ||
                  selectedOrdenDetail.comentarios.length === 0 ? (
                    <p className="text-xs text-white/40 italic">
                      No hay comentarios.
                    </p>
                  ) : (
                    selectedOrdenDetail.comentarios.map((msg, i) => (
                      <div
                        key={i}
                        className="bg-[#112C3E] border border-white/5 p-3 rounded-lg"
                      >
                        <div className="flex justify-between items-end mb-1">
                          <span className="text-[10px] font-bold text-white/50 uppercase">
                            {msg.autor}
                          </span>
                          <span className="text-[9px] text-white/30">
                            {msg.fecha?.toDate
                              ? msg.fecha.toDate().toLocaleString()
                              : "Reciente"}
                          </span>
                        </div>
                        <p className="text-sm text-white/90">{msg.texto}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* MODAL: FORMULARIO (NUEVO / EDITAR CLIENTE) */}
      {/* ========================================== */}
      {showFormModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
          <div className="bg-[#0C212D] border border-white/10 rounded-3xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-white/10 bg-[#0C212D]/95 backdrop-blur flex items-center justify-between sticky top-0 z-10">
              <div>
                <h3 className="text-xl font-bold text-white tracking-tight">
                  {selectedClient ? "Editar Cliente" : "Crear Nuevo Cliente"}
                </h3>
                <p className="text-sm text-white/50 mt-1">
                  Completá los datos personales y registrá su flota.
                </p>
              </div>
              <button
                onClick={() =>
                  selectedClient ? verDetalle(selectedClient) : cerrarModales()
                }
                className="p-2 text-white/50 hover:text-white transition rounded-xl hover:bg-white/5"
              >
                ✕
              </button>
            </div>

            <form onSubmit={guardarCliente} className="p-6 flex flex-col gap-8">
              {/* Datos Personales */}
              <div className="bg-[#112C3E] border border-white/5 p-5 rounded-2xl">
                <h4 className="text-xs uppercase tracking-widest text-emerald-400 font-bold mb-4 flex items-center gap-2">
                  <span className="bg-emerald-400/10 text-emerald-400 w-5 h-5 flex items-center justify-center rounded-full text-[10px]">
                    1
                  </span>
                  Datos del Contacto
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div>
                    <label className="block text-xs font-medium text-white/70 mb-1.5">
                      Nombre completo *
                    </label>
                    <input
                      name="nombre"
                      value={formData.nombre}
                      onChange={handleInputChange}
                      type="text"
                      placeholder="Ej: Juan Pérez"
                      className="w-full bg-[#0C212D] border border-white/10 text-white rounded-xl p-3 focus:outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400/50 transition placeholder:text-white/20"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-white/70 mb-1.5">
                      Teléfono (WhatsApp)
                    </label>
                    <input
                      name="telefono"
                      value={formData.telefono}
                      onChange={handleInputChange}
                      type="text"
                      placeholder="Ej: 1122334455"
                      className="w-full bg-[#0C212D] border border-white/10 text-white rounded-xl p-3 focus:outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400/50 transition placeholder:text-white/20"
                    />
                  </div>
                </div>
              </div>

              {/* Vehículos */}
              <div className="bg-[#112C3E] border border-white/5 p-5 rounded-2xl">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
                  <h4 className="text-xs uppercase tracking-widest text-emerald-400 font-bold flex items-center gap-2">
                    <span className="bg-emerald-400/10 text-emerald-400 w-5 h-5 flex items-center justify-center rounded-full text-[10px]">
                      2
                    </span>
                    Vehículos Asociados
                  </h4>
                  <button
                    type="button"
                    onClick={agregarVehiculo}
                    className="text-xs font-semibold bg-white/5 hover:bg-white/10 border border-white/10 text-white px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 w-fit"
                  >
                    <span>+</span> Agregar otro vehículo
                  </button>
                </div>

                <div className="space-y-4">
                  {formData.vehiculos.map((vehiculo, index) => (
                    <div
                      key={index}
                      className="bg-[#0C212D] border border-white/10 p-5 rounded-xl relative group transition hover:border-white/20"
                    >
                      {formData.vehiculos.length > 1 && (
                        <button
                          type="button"
                          onClick={() => eliminarVehiculoForm(index)}
                          className="absolute -top-2.5 -right-2.5 bg-red-500 text-white w-7 h-7 rounded-full text-sm flex items-center justify-center hover:bg-red-600 transition shadow-lg opacity-0 group-hover:opacity-100"
                          title="Eliminar vehículo"
                        >
                          ✕
                        </button>
                      )}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                        <div>
                          <label className="block text-xs font-medium text-white/70 mb-1.5">
                            Patente / Dominio *
                          </label>
                          <input
                            value={vehiculo.patente}
                            onChange={(e) =>
                              handleVehiculoChange(
                                index,
                                "patente",
                                e.target.value,
                              )
                            }
                            type="text"
                            placeholder="Ej: AB123CD"
                            className="w-full bg-[#112C3E] border border-white/10 text-white rounded-lg p-2.5 focus:outline-none focus:border-emerald-400 uppercase transition placeholder:text-white/20 placeholder:normal-case font-mono"
                            required
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-white/70 mb-1.5">
                            Marca y Modelo
                          </label>
                          <input
                            value={vehiculo.marcaModelo}
                            onChange={(e) =>
                              handleVehiculoChange(
                                index,
                                "marcaModelo",
                                e.target.value,
                              )
                            }
                            type="text"
                            placeholder="Ej: VW Gol Trend 1.6"
                            className="w-full bg-[#112C3E] border border-white/10 text-white rounded-lg p-2.5 focus:outline-none focus:border-emerald-400 transition placeholder:text-white/20"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Acciones */}
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() =>
                    selectedClient
                      ? verDetalle(selectedClient)
                      : cerrarModales()
                  }
                  className="px-6 py-3 rounded-xl text-sm font-semibold text-white/70 hover:bg-white/10 transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={guardando}
                  className="bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white font-semibold px-8 py-3 rounded-xl transition shadow-lg flex items-center gap-2"
                >
                  {guardando ? (
                    <>
                      <span className="animate-spin text-lg">↻</span>{" "}
                      Guardando...
                    </>
                  ) : (
                    "Guardar Cliente"
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
