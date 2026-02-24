import { useState, useContext, useRef, useEffect, useMemo } from "react";
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

export default function PresupuestosTaller() {
  const ctx = useContext(ContextGeneral);
  const nombreLogueado =
    ctx.user?.displayName || ctx.user?.email?.split("@")[0] || "Admin";

  // Control de Modal
  const [showModalForm, setShowModalForm] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedPresupuesto, setSelectedPresupuesto] = useState(null);

  const [guardando, setGuardando] = useState(false);

  // Buscadores
  const [searchQuery, setSearchQuery] = useState("");
  const [busquedaCliente, setBusquedaCliente] = useState("");
  const [mostrarDropdown, setMostrarDropdown] = useState(false);
  const dropdownRef = useRef(null);
  const [clienteSeleccionadoTemp, setClienteSeleccionadoTemp] = useState(null);

  // Estado del Formulario
  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState({
    id: null,
    chunkDoc: null,
    clienteId: "",
    vehiculoString: "",
    vehiculoIndex: "",
    items: [], // { desc: "", cantidad: 1, precioUnitario: 0 }
    notasExtras: "",
  });

  // ✅ AHORA: estos son los presupuestos del taller
  const presupuestos = ctx.presupuestosTaller || [];
  const clientes = ctx.clientesTaller || [];

  // Filtro de clientes en el buscador de la tabla
  const presupuestosFiltrados = useMemo(() => {
    if (!searchQuery) return presupuestos;
    const q = searchQuery.toLowerCase();
    return presupuestos.filter(
      (p) =>
        p.clienteNombre?.toLowerCase().includes(q) ||
        p.vehiculo?.toLowerCase().includes(q) ||
        p.id?.toLowerCase().includes(q),
    );
  }, [presupuestos, searchQuery]);

  // Filtro de clientes en el dropdown del formulario
  const clientesFiltradosDropdown = clientes.filter(
    (c) =>
      c.nombre.toLowerCase().includes(busquedaCliente.toLowerCase()) ||
      (c.vehiculos &&
        c.vehiculos.some((v) =>
          v.patente.toLowerCase().includes(busquedaCliente.toLowerCase()),
        )) ||
      (c.patente || "").toLowerCase().includes(busquedaCliente.toLowerCase()),
  );

  // Cerrar dropdown si se hace clic afuera
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setMostrarDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // --- Lógica Items de Presupuesto ---
  const agregarItem = () => {
    setForm((prev) => ({
      ...prev,
      items: [...prev.items, { desc: "", cantidad: 1, precioUnitario: "" }],
    }));
  };

  const actualizarItem = (index, campo, valor) => {
    const nuevosItems = [...form.items];
    nuevosItems[index][campo] = valor;
    setForm((prev) => ({ ...prev, items: nuevosItems }));
  };

  const eliminarItem = (index) => {
    setForm((prev) => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== index),
    }));
  };

  const calcularTotal = (items) => {
    return items.reduce((acc, item) => {
      const cant = parseFloat(item.cantidad) || 0;
      const precio = parseFloat(item.precioUnitario) || 0;
      return acc + cant * precio;
    }, 0);
  };

  const formTotal = calcularTotal(form.items);

  // --- WhatsApp Logic ---
  const enviarWhatsApp = (presupuesto) => {
    const cliente = clientes.find((c) => c.id === presupuesto.clienteId);
    let telefono = cliente?.telefono || presupuesto.telefonoViejo;

    if (!telefono) {
      telefono = window.prompt(
        "El cliente no tiene teléfono registrado. Ingresalo para enviar el WhatsApp:",
      );
      if (!telefono) return;
    }

    telefono = telefono.replace(/[\s-]/g, "");

    let msj = `¡Hola *${presupuesto.clienteNombre}*!\nTe enviamos el presupuesto para tu vehículo *${presupuesto.vehiculo}*:\n\n`;
    msj += `*Detalle:*\n`;

    presupuesto.items.forEach((item) => {
      const subtotal =
        (parseFloat(item.cantidad) || 0) *
        (parseFloat(item.precioUnitario) || 0);
      msj += `- ${item.desc} (x${item.cantidad}) - $${subtotal.toLocaleString("es-AR")}\n`;
    });

    msj += `\n*TOTAL ESTIMADO: $${parseFloat(presupuesto.total).toLocaleString("es-AR")}*\n`;

    if (presupuesto.notasExtras) {
      msj += `\n_Notas: ${presupuesto.notasExtras}_\n`;
    }

    msj += `\nCualquier duda avisanos. ¡Saludos!`;

    window.open(
      `https://wa.me/${telefono}?text=${encodeURIComponent(msj)}`,
      "_blank",
    );
  };

  // --- CRUD Actions ---
  const abrirCrear = () => {
    setIsEditing(false);
    setForm({
      id: null,
      chunkDoc: null,
      clienteId: "",
      vehiculoIndex: "",
      vehiculoString: "",
      items: [{ desc: "", cantidad: 1, precioUnitario: "" }],
      notasExtras: "",
    });
    setBusquedaCliente("");
    setClienteSeleccionadoTemp(null);
    setShowModalForm(true);
    setShowDetailModal(false);
  };

  const abrirEditar = (p) => {
    setIsEditing(true);
    setForm({
      id: p.id,
      chunkDoc: p.chunkDoc,
      clienteId: p.clienteId,
      vehiculoIndex: "",
      vehiculoString: p.vehiculo,
      items: p.items ? [...p.items] : [],
      notasExtras: p.notasExtras || "",
    });
    setBusquedaCliente(p.clienteNombre);

    const c = clientes.find((cli) => cli.id === p.clienteId);
    if (c) setClienteSeleccionadoTemp(c);

    setShowModalForm(true);
    setShowDetailModal(false);
  };

  const verDetalles = (p) => {
    setSelectedPresupuesto(p);
    setShowDetailModal(true);
  };

  const cerrarModales = () => {
    if (showModalForm && form.items.length > 0 && form.items[0].desc !== "") {
      if (
        !window.confirm(
          "¿Seguro que querés salir? Los cambios no guardados se perderán.",
        )
      )
        return;
    }
    setShowModalForm(false);
    setShowDetailModal(false);
    setSelectedPresupuesto(null);
  };

  const guardarPresupuesto = async (e) => {
    e.preventDefault();
    if (!form.clienteId) return toast.error("Seleccioná un cliente");
    if (
      (!isEditing || form.vehiculoIndex !== "") &&
      form.vehiculoIndex === "" &&
      !form.vehiculoString
    ) {
      return toast.error("Seleccioná un vehículo");
    }

    const itemsValidos = form.items.filter((i) => i.desc.trim() !== "");
    if (itemsValidos.length === 0)
      return toast.error("Agregá al menos un ítem al presupuesto");

    setGuardando(true);
    try {
      const id = isEditing ? form.id : Date.now().toString();
      const key = `b_${id}`;
      let chunkDocId = form.chunkDoc;

      // Buscar Lote
      if (!chunkDocId) {
        const snap = await getDocs(
          collection(ctx.firestore, "presupuestosTaller"),
        );
        for (const docSnap of snap.docs) {
          const data = docSnap.data();
          const keysCount = Object.keys(data).filter((k) =>
            k.startsWith("b_"),
          ).length;
          if (keysCount < 100) {
            chunkDocId = docSnap.id;
            break;
          }
        }
        if (!chunkDocId)
          chunkDocId = doc(collection(ctx.firestore, "presupuestosTaller")).id;
      }

      // Vehiculo string
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
      const totalFinal = calcularTotal(itemsValidos);

      const ref = doc(ctx.firestore, "presupuestosTaller", chunkDocId);

      const payload = {
        id,
        chunkDoc: chunkDocId,
        clienteId: form.clienteId,
        clienteNombre,
        vehiculo: vString,
        items: itemsValidos.map((i) => ({
          desc: i.desc,
          cantidad: parseFloat(i.cantidad) || 1,
          precioUnitario: parseFloat(i.precioUnitario) || 0,
        })),
        total: totalFinal,
        notasExtras: form.notasExtras,
        actualizadoPor: nombreLogueado,
        updatedAt: new Date(),
      };

      if (!isEditing) {
        payload.creadoPor = nombreLogueado;
        payload.createdAt = new Date();
      }

      await setDoc(ref, { [key]: payload }, { merge: true });

      toast.success(
        isEditing ? "Presupuesto actualizado" : "Presupuesto creado",
      );
      setShowModalForm(false);

      if (isEditing && selectedPresupuesto) {
        setSelectedPresupuesto({ ...selectedPresupuesto, ...payload });
        setShowDetailModal(true);
      }
    } catch (error) {
      console.error(error);
      toast.error("Error al guardar presupuesto");
    } finally {
      setGuardando(false);
    }
  };

  const eliminarPresupuesto = async (id, chunkDoc) => {
    if (!window.confirm("¿Eliminar este presupuesto permanentemente?")) return;
    try {
      const ref = doc(ctx.firestore, "presupuestosTaller", chunkDoc);
      await updateDoc(ref, { [`b_${id}`]: deleteField() });
      toast.success("Presupuesto eliminado");
      setShowDetailModal(false);
    } catch (error) {
      console.error(error);
      toast.error("Error al eliminar");
    }
  };

  return (
    <div className="animate-in fade-in duration-200">
      {/* Encabezado */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between border-b border-white/10 mb-6 pb-4 gap-4">
        <div>
          <h3 className="text-xl font-semibold text-white tracking-tight">
            Presupuestos Taller
          </h3>
          <p className="text-sm text-white/50 mt-1">
            Total registrados: {presupuestos.length}
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
          <input
            type="text"
            placeholder="Buscar presupuesto..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-[#0C212D] border border-white/10 text-white text-sm rounded-xl px-4 py-2 focus:outline-none focus:border-emerald-400 transition w-full sm:w-64"
          />
          <button
            onClick={abrirCrear}
            className="bg-emerald-500 hover:bg-emerald-600 text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition shadow-lg flex items-center justify-center gap-2 whitespace-nowrap"
          >
            <span>+</span> Crear Presupuesto
          </button>
        </div>
      </div>

      {/* Lista de Presupuestos */}
      <div className="bg-[#112C3E] border border-white/10 rounded-2xl overflow-hidden shadow-xl">
        {presupuestosFiltrados.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 opacity-60">
            <span className="text-4xl mb-3">📄</span>
            <p className="text-sm italic">
              No hay presupuestos creados todavía.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-white/5 text-white/60 uppercase tracking-wider text-[11px] font-semibold border-b border-white/10">
                <tr>
                  <th className="px-5 py-4">Fecha</th>
                  <th className="px-5 py-4">Cliente y Vehículo</th>
                  <th className="px-5 py-4">Creado Por</th>
                  <th className="px-5 py-4 text-right">Total</th>
                  <th className="px-5 py-4 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {presupuestosFiltrados.map((p) => (
                  <tr
                    key={p.id}
                    onClick={() => verDetalles(p)}
                    className="hover:bg-white/5 transition group cursor-pointer"
                  >
                    <td className="px-5 py-4 text-white/70">
                      <p className="font-medium text-white group-hover:text-emerald-400 transition">
                        {p.createdAt?.toDate
                          ? p.createdAt.toDate().toLocaleDateString()
                          : "-"}
                      </p>
                      <p className="text-[10px] text-white/40 mt-1">
                        ID: {String(p.id || "").slice(-5)}
                      </p>
                    </td>
                    <td className="px-5 py-4">
                      <p className="font-semibold text-white text-base">
                        {p.clienteNombre}
                      </p>
                      <p className="text-xs text-white/50 mt-0.5">
                        {p.vehiculo}
                      </p>
                    </td>
                    <td className="px-5 py-4 text-white/70 text-xs">
                      {p.creadoPor || "Admin"}
                    </td>
                    <td className="px-5 py-4 text-right font-bold text-emerald-400 text-base">
                      $ {(p.total || 0).toLocaleString("es-AR")}
                    </td>
                    <td className="px-5 py-4 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          enviarWhatsApp(p);
                        }}
                        title="Enviar por WhatsApp"
                        className="bg-[#25D366]/10 text-[#25D366] hover:bg-[#25D366]/20 px-3 py-1.5 rounded-lg text-xs font-semibold transition border border-[#25D366]/30 mr-2"
                      >
                        WhatsApp
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          abrirEditar(p);
                        }}
                        className="text-white/40 hover:text-white px-2 py-1.5 rounded-lg hover:bg-white/5 transition text-xs font-medium mr-2"
                      >
                        Editar
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          verDetalles(p);
                        }}
                        className="text-emerald-400 hover:text-emerald-300 font-medium px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 rounded-lg transition"
                      >
                        Ver
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ========================================================= */}
      {/* MODAL: VER DETALLE PRESUPUESTO */}
      {/* ========================================================= */}
      {showDetailModal && selectedPresupuesto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
          <div className="bg-[#0C212D] border border-white/10 rounded-3xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="shrink-0 bg-[#0C212D]/95 backdrop-blur border-b border-white/10 p-6 flex items-start sm:items-center justify-between flex-col sm:flex-row gap-4 rounded-t-3xl z-10">
              <div>
                <h3 className="text-2xl font-bold text-white tracking-tight flex items-center gap-3">
                  Presupuesto{" "}
                  <span className="text-sm font-mono text-white/40 bg-white/5 px-2 py-1 rounded-md">
                    #{String(selectedPresupuesto.id || "").slice(-6)}
                  </span>
                </h3>
                <p className="text-sm text-white/60 mt-1">
                  Creado el{" "}
                  {selectedPresupuesto.createdAt?.toDate
                    ? selectedPresupuesto.createdAt
                        .toDate()
                        .toLocaleDateString()
                    : ""}{" "}
                  por {selectedPresupuesto.creadoPor}
                </p>
              </div>
              <div className="flex items-center gap-3 w-full sm:w-auto">
                <button
                  onClick={() => enviarWhatsApp(selectedPresupuesto)}
                  className="bg-[#25D366]/20 text-[#25D366] hover:bg-[#25D366]/30 px-4 py-2.5 rounded-xl text-sm font-semibold transition border border-[#25D366]/30 flex-1 sm:flex-none"
                >
                  Enviar WhatsApp
                </button>
                <button
                  onClick={() => abrirEditar(selectedPresupuesto)}
                  className="flex-1 sm:flex-none bg-white/10 hover:bg-white/20 text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition"
                >
                  Editar
                </button>
                <button
                  onClick={cerrarModales}
                  className="p-2 text-white/50 hover:text-white transition rounded-xl hover:bg-white/5"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-[#112C3E] border border-white/5 p-5 rounded-2xl">
                  <p className="text-[10px] uppercase tracking-widest text-emerald-400 font-bold mb-1">
                    Cliente
                  </p>
                  <p className="text-white text-lg font-medium">
                    {selectedPresupuesto.clienteNombre}
                  </p>
                </div>
                <div className="bg-[#112C3E] border border-white/5 p-5 rounded-2xl">
                  <p className="text-[10px] uppercase tracking-widest text-emerald-400 font-bold mb-1">
                    Vehículo Ref.
                  </p>
                  <p className="text-white text-lg font-medium">
                    {selectedPresupuesto.vehiculo}
                  </p>
                </div>
              </div>

              <div className="bg-[#112C3E] border border-white/5 rounded-2xl overflow-hidden">
                <div className="p-4 border-b border-white/10 bg-white/5">
                  <h4 className="text-xs uppercase tracking-widest text-emerald-400 font-bold">
                    Detalle de Ítems
                  </h4>
                </div>
                <table className="w-full text-left text-sm">
                  <thead className="bg-[#0C212D]/50 text-white/50 text-[10px] uppercase">
                    <tr>
                      <th className="p-4 font-semibold">Descripción</th>
                      <th className="p-4 font-semibold text-center w-24">
                        Cant.
                      </th>
                      <th className="p-4 font-semibold text-right w-32">
                        Precio U.
                      </th>
                      <th className="p-4 font-semibold text-right w-32">
                        Subtotal
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {selectedPresupuesto.items?.map((it, idx) => (
                      <tr key={idx}>
                        <td className="p-4 text-white/90">{it.desc}</td>
                        <td className="p-4 text-center text-white/70">
                          {it.cantidad}
                        </td>
                        <td className="p-4 text-right text-white/70">
                          ${(it.precioUnitario || 0).toLocaleString("es-AR")}
                        </td>
                        <td className="p-4 text-right text-white font-medium">
                          $
                          {(
                            (it.cantidad || 0) * (it.precioUnitario || 0)
                          ).toLocaleString("es-AR")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="p-5 border-t border-white/10 bg-white/5 flex justify-end items-end gap-6">
                  <p className="text-white/50 text-sm mb-1 uppercase tracking-widest font-semibold">
                    Total:
                  </p>
                  <p className="text-3xl font-bold text-emerald-400">
                    $ {(selectedPresupuesto.total || 0).toLocaleString("es-AR")}
                  </p>
                </div>
              </div>

              {selectedPresupuesto.notasExtras && (
                <div className="bg-[#112C3E] border border-white/5 p-5 rounded-2xl">
                  <p className="text-[10px] uppercase tracking-widest text-white/50 font-bold mb-2">
                    Notas Adicionales
                  </p>
                  <p className="text-white/80 text-sm whitespace-pre-line">
                    {selectedPresupuesto.notasExtras}
                  </p>
                </div>
              )}
            </div>

            {/* Footer Modal Detalle (Eliminar) */}
            <div className="p-6 border-t border-white/10 bg-[#112C3E]/50 flex justify-end shrink-0 rounded-b-3xl">
              <button
                onClick={() =>
                  eliminarPresupuesto(
                    selectedPresupuesto.id,
                    selectedPresupuesto.chunkDoc,
                  )
                }
                className="text-red-400 hover:text-white hover:bg-red-500 px-4 py-2 rounded-xl text-sm font-semibold transition"
              >
                Eliminar Presupuesto Permanentemente
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL: FORMULARIO PRESUPUESTO */}
      {/* ========================================================= */}
      {showModalForm && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md">
          <div className="bg-[#0C212D] border border-white/10 rounded-3xl w-full max-w-5xl max-h-[95vh] flex flex-col shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="shrink-0 flex items-center justify-between p-6 border-b border-white/10 bg-[#112C3E] rounded-t-3xl">
              <div>
                <h3 className="text-xl font-bold text-white tracking-tight">
                  {isEditing ? "Editar Presupuesto" : "Nuevo Presupuesto"}
                </h3>
              </div>
              <button
                onClick={cerrarModales}
                className="text-white/50 hover:text-white transition bg-white/5 hover:bg-white/10 p-2 rounded-xl"
              >
                ✕
              </button>
            </div>

            <form
              onSubmit={guardarPresupuesto}
              className="flex-1 overflow-y-auto p-6 flex flex-col gap-6"
            >
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Lado Izquierdo: Info Cliente */}
                <div className="lg:col-span-1 space-y-6">
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
                          {clientesFiltradosDropdown.length === 0 ? (
                            <li className="p-3 text-sm text-white/50 italic text-center">
                              No encontrado
                            </li>
                          ) : (
                            clientesFiltradosDropdown.map((c) => (
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
                                className="p-3 border-b border-white/5 text-sm hover:bg-white/10 cursor-pointer flex flex-col gap-1"
                              >
                                <span className="font-semibold">
                                  {c.nombre}
                                </span>
                                <span className="text-emerald-400 text-[10px]">
                                  {c.vehiculos
                                    ?.map((v) => v.patente)
                                    .join(", ") ||
                                    c.patente ||
                                    ""}
                                </span>
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

                  <div className="bg-[#112C3E] p-5 rounded-2xl border border-white/5 space-y-4">
                    <h4 className="text-[10px] uppercase tracking-widest text-emerald-400 font-bold">
                      2. Notas Adicionales
                    </h4>
                    <textarea
                      rows="3"
                      value={form.notasExtras}
                      onChange={(e) =>
                        setForm({ ...form, notasExtras: e.target.value })
                      }
                      placeholder="Ej: Validez del presupuesto: 15 días..."
                      className="w-full bg-[#0C212D] border border-white/10 text-white rounded-xl p-3 text-sm focus:outline-none focus:border-emerald-400 resize-none placeholder:text-white/20"
                    />
                  </div>
                </div>

                {/* Lado Derecho: Items y Total */}
                <div className="lg:col-span-2 bg-[#112C3E] p-5 rounded-2xl border border-white/5 flex flex-col min-h-[400px]">
                  <div className="flex items-center justify-between mb-4 pb-2 border-b border-white/10 shrink-0">
                    <h4 className="text-[10px] uppercase tracking-widest text-emerald-400 font-bold">
                      3. Detalle de Repuestos y Mano de Obra
                    </h4>
                    <button
                      type="button"
                      onClick={agregarItem}
                      className="bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold px-3 py-1.5 rounded-lg transition"
                    >
                      + Añadir Ítem
                    </button>
                  </div>

                  <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                    {form.items.length === 0 && (
                      <div className="flex flex-col items-center justify-center h-full opacity-40 py-10">
                        <span className="text-3xl mb-2">📋</span>
                        <p className="text-xs italic">
                          Agregá ítems al presupuesto.
                        </p>
                      </div>
                    )}
                    {form.items.map((item, index) => {
                      const qty = parseFloat(item.cantidad) || 0;
                      const prc = parseFloat(item.precioUnitario) || 0;
                      const sub = qty * prc;

                      return (
                        <div
                          key={index}
                          className="flex flex-col sm:flex-row gap-3 items-end sm:items-center bg-[#0C212D] p-3 rounded-xl border border-white/5"
                        >
                          <div className="w-full sm:flex-1">
                            <label className="block text-[10px] text-white/50 mb-1 ml-1 font-semibold uppercase tracking-wide">
                              Descripción
                            </label>
                            <input
                              type="text"
                              required
                              value={item.desc}
                              onChange={(e) =>
                                actualizarItem(index, "desc", e.target.value)
                              }
                              placeholder="Ej: Cambio de aceite Motul"
                              className="w-full bg-transparent border border-white/10 rounded-lg p-2 text-sm focus:outline-none focus:border-emerald-400"
                            />
                          </div>
                          <div className="flex gap-3 w-full sm:w-auto">
                            <div className="w-20 shrink-0">
                              <label className="block text-[10px] text-white/50 mb-1 ml-1 font-semibold uppercase tracking-wide">
                                Cant.
                              </label>
                              <input
                                type="number"
                                min="0.1"
                                step="any"
                                required
                                value={item.cantidad}
                                onChange={(e) =>
                                  actualizarItem(
                                    index,
                                    "cantidad",
                                    e.target.value,
                                  )
                                }
                                className="w-full bg-transparent border border-white/10 rounded-lg p-2 text-sm text-center focus:outline-none focus:border-emerald-400"
                              />
                            </div>
                            <div className="w-32 shrink-0">
                              <label className="block text-[10px] text-white/50 mb-1 ml-1 font-semibold uppercase tracking-wide">
                                Precio Unit.
                              </label>
                              <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 text-sm">
                                  $
                                </span>
                                <input
                                  type="number"
                                  min="0"
                                  step="any"
                                  required
                                  value={item.precioUnitario}
                                  onChange={(e) =>
                                    actualizarItem(
                                      index,
                                      "precioUnitario",
                                      e.target.value,
                                    )
                                  }
                                  className="w-full bg-transparent border border-white/10 rounded-lg p-2 pl-7 text-sm focus:outline-none focus:border-emerald-400"
                                />
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-3 w-full sm:w-auto justify-end sm:justify-start pt-2 sm:pt-0 sm:mt-5 shrink-0">
                            <div className="text-right w-28">
                              <span className="text-[10px] text-white/40 block sm:hidden">
                                Subtotal:
                              </span>
                              <span className="font-semibold text-emerald-400 text-base">
                                ${sub.toLocaleString("es-AR")}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => eliminarItem(index)}
                              className="text-red-400/60 hover:text-red-400 p-2 transition bg-red-400/10 hover:bg-red-400/20 rounded-lg"
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Footer con Total */}
                  <div className="shrink-0 mt-4 pt-4 border-t border-white/10 flex justify-end items-end gap-6 bg-white/5 p-4 rounded-xl">
                    <p className="text-white/50 text-sm mb-1 uppercase tracking-widest font-semibold">
                      Total estimado:
                    </p>
                    <p className="text-3xl font-bold text-emerald-400">
                      $ {formTotal.toLocaleString("es-AR")}
                    </p>
                  </div>
                </div>
              </div>

              {/* Acciones Generales */}
              <div className="flex justify-end gap-3 pt-4 border-t border-white/10 shrink-0">
                <button
                  type="button"
                  onClick={cerrarModales}
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
                      : "Crear Presupuesto"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
