import { useContext, useEffect, useMemo, useRef, useState } from "react";
import ContextGeneral from "@/servicios/contextGeneral";
import useDismissibleModal from "@/hooks/useDismissibleModal";
import HelpHint from "@/componentes/HelpHint";
import {
  collection,
  deleteField,
  doc,
  getDocs,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { toast } from "sonner";

const CHUNK_LIMIT = 100;

function createEmptyItem(kind = "servicio") {
  return {
    lineId: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    kind,
    desc: "",
    cantidad: 1,
    precioUnitario: "",
    productId: null,
    sku: null,
    category: null,
  };
}

function createEmptyOrderDraft() {
  return {
    draftId: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    title: "",
    description: "",
    tasksText: "",
  };
}

export default function PresupuestosTaller({
  location = "taller",
  embeddedFrom = "taller",
}) {
  const ctx = useContext(ContextGeneral);
  const nombreLogueado =
    ctx.user?.displayName || ctx.user?.email?.split("@")[0] || "Admin";

  const [showModalForm, setShowModalForm] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showCreateClientModal, setShowCreateClientModal] = useState(false);
  const [selectedPresupuesto, setSelectedPresupuesto] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [generandoOrdenes, setGenerandoOrdenes] = useState(false);
  const [guardandoCliente, setGuardandoCliente] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [busquedaCliente, setBusquedaCliente] = useState("");
  const [mostrarDropdown, setMostrarDropdown] = useState(false);
  const [productQuery, setProductQuery] = useState("");
  const [mostrarProductos, setMostrarProductos] = useState(false);
  const dropdownRef = useRef(null);
  const productDropdownRef = useRef(null);
  const [clienteSeleccionadoTemp, setClienteSeleccionadoTemp] = useState(null);
  const [clientForm, setClientForm] = useState(getInitialClientForm());

  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState(getInitialForm(location, embeddedFrom));

  const presupuestos = Array.isArray(ctx.presupuestosTaller)
    ? ctx.presupuestosTaller
    : [];
  const clientes = Array.isArray(ctx.clientesTaller) ? ctx.clientesTaller : [];
  const productos = useMemo(() => {
    return (Array.isArray(ctx.productos) ? ctx.productos : [])
      .filter((p) => p?.enabled !== false)
      .sort((a, b) => String(a?.name || "").localeCompare(String(b?.name || "")));
  }, [ctx.productos]);

  const presupuestosFiltrados = useMemo(() => {
    const q = normalizeText(searchQuery);
    if (!q) return presupuestos;
    return presupuestos.filter((p) => {
      const hayItems = (p.items || []).some((item) =>
        normalizeText(item.desc).includes(q),
      );
      return (
        normalizeText(p.clienteNombre).includes(q) ||
        normalizeText(p.vehiculo).includes(q) ||
        normalizeText(p.id).includes(q) ||
        normalizeText(p.sourceLocation).includes(q) ||
        hayItems
      );
    });
  }, [presupuestos, searchQuery]);

  const clientesFiltradosDropdown = useMemo(() => {
    const q = normalizeText(busquedaCliente);
    return clientes.filter((c) => {
      const vehiculos = Array.isArray(c.vehiculos) ? c.vehiculos : [];
      return (
        normalizeText(c.nombre).includes(q) ||
        normalizeText(c.patente).includes(q) ||
        vehiculos.some(
          (v) =>
            normalizeText(v.patente).includes(q) ||
            normalizeText(v.marcaModelo).includes(q),
        )
      );
    });
  }, [clientes, busquedaCliente]);

  const productosFiltrados = useMemo(() => {
    const q = normalizeText(productQuery);
    if (!q) return productos.slice(0, 10);
    return productos
      .filter((p) => {
        return (
          normalizeText(p.name).includes(q) ||
          normalizeText(p.sku).includes(q) ||
          normalizeText(p.category).includes(q)
        );
      })
      .slice(0, 12);
  }, [productos, productQuery]);

  const formTotal = useMemo(() => calcularTotal(form.items), [form.items]);
  const formServiceCount = useMemo(
    () => form.items.filter((item) => item.kind !== "producto").length,
    [form.items],
  );
  const formProductCount = useMemo(
    () => form.items.filter((item) => item.kind === "producto").length,
    [form.items],
  );

  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setMostrarDropdown(false);
      }
      if (
        productDropdownRef.current &&
        !productDropdownRef.current.contains(event.target)
      ) {
        setMostrarProductos(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const cerrarModales = () => {
    if (showModalForm && hayCambiosSinGuardar(form)) {
      const ok = window.confirm(
        "¿Seguro que querés salir? Los cambios no guardados se perderán.",
      );
      if (!ok) return;
    }
    setShowModalForm(false);
    setShowDetailModal(false);
    setSelectedPresupuesto(null);
  };

  const detailPresupuestoModal = useDismissibleModal(
    showDetailModal && !!selectedPresupuesto,
    cerrarModales,
  );
  const formPresupuestoModal = useDismissibleModal(
    showModalForm,
    cerrarModales,
  );
  const createClientModal = useDismissibleModal(
    showCreateClientModal,
    () => setShowCreateClientModal(false),
  );

  function abrirCrear() {
    setIsEditing(false);
    setForm(getInitialForm(location, embeddedFrom));
    setBusquedaCliente("");
    setClienteSeleccionadoTemp(null);
    setProductQuery("");
    setShowModalForm(true);
    setShowDetailModal(false);
  }

  function abrirCrearClienteRapido() {
    setClientForm(getInitialClientForm());
    setShowCreateClientModal(true);
  }

  function abrirEditar(presupuesto) {
    setIsEditing(true);
    setForm({
      id: presupuesto.id,
      chunkDoc: presupuesto.chunkDoc,
      clienteId: presupuesto.clienteId || "",
      vehiculoString: presupuesto.vehiculo || "",
      vehiculoIndex: "",
      items:
        presupuesto.items?.map((item) => ({
          lineId:
            item.lineId ||
            `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          kind: item.kind || (item.productId ? "producto" : "servicio"),
          desc: item.desc || "",
          cantidad: item.cantidad ?? 1,
          precioUnitario: item.precioUnitario ?? "",
          productId: item.productId || null,
          sku: item.sku || null,
          category: item.category || null,
        })) || [createEmptyItem()],
      notasExtras: presupuesto.notasExtras || "",
      ordenesTrabajo:
        presupuesto.ordenesTrabajo?.map((orden) => ({
          draftId:
            orden.draftId ||
            `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          title: orden.title || "",
          description: orden.description || "",
          tasksText:
            orden.tasksText ||
            (Array.isArray(orden.tasks)
              ? orden.tasks.map((task) => task.descripcion || task).join("\n")
              : ""),
        })) || [],
      createdAt: presupuesto.createdAt || null,
      creadoPor: presupuesto.creadoPor || null,
      workOrderLinks: presupuesto.workOrderLinks || [],
      workOrderHistory: presupuesto.workOrderHistory || [],
      sourceLocation: presupuesto.sourceLocation || location,
      sourceChannel: presupuesto.sourceChannel || embeddedFrom,
    });
    setBusquedaCliente(presupuesto.clienteNombre || "");
    setProductQuery("");

    const cliente = clientes.find((item) => item.id === presupuesto.clienteId);
    if (cliente) setClienteSeleccionadoTemp(cliente);

    setShowModalForm(true);
    setShowDetailModal(false);
  }

  function verDetalles(presupuesto) {
    setSelectedPresupuesto(presupuesto);
    setShowDetailModal(true);
  }

  function agregarItem(kind = "servicio") {
    setForm((prev) => ({
      ...prev,
      items: [...prev.items, createEmptyItem(kind)],
    }));
  }

  function actualizarItem(index, campo, valor) {
    setForm((prev) => {
      const items = [...prev.items];
      items[index] = { ...items[index], [campo]: valor };
      return { ...prev, items };
    });
  }

  function eliminarItem(index) {
    setForm((prev) => ({
      ...prev,
      items:
        prev.items.length === 1
          ? [createEmptyItem()]
          : prev.items.filter((_, itemIndex) => itemIndex !== index),
    }));
  }

  function agregarProducto(producto) {
    setForm((prev) => {
      const price = finalPrice(producto);
      const existingIndex = prev.items.findIndex(
        (item) => item.productId && item.productId === producto.id,
      );

      if (existingIndex >= 0) {
        const items = [...prev.items];
        const currentQty = Number(items[existingIndex].cantidad) || 0;
        items[existingIndex] = {
          ...items[existingIndex],
          cantidad: currentQty + 1,
        };
        return { ...prev, items };
      }

      const nextItems =
        prev.items.length === 1 && !prev.items[0].desc.trim()
          ? []
          : prev.items;

      return {
        ...prev,
        items: [
          ...nextItems,
          {
            lineId: `${Date.now()}_${producto.id}`,
            kind: "producto",
            desc: producto.name || "Producto",
            cantidad: 1,
            precioUnitario: price || 0,
            productId: producto.id,
            sku: producto.sku || null,
            category: producto.category || null,
          },
        ],
      };
    });

    setProductQuery("");
    setMostrarProductos(false);
    toast.success(`Producto agregado: ${producto.name || "sin nombre"}`);
  }

  function agregarOrdenTrabajo() {
    setForm((prev) => ({
      ...prev,
      ordenesTrabajo: [...prev.ordenesTrabajo, createEmptyOrderDraft()],
    }));
  }

  function handleClientInputChange(field, value) {
    setClientForm((prev) => ({ ...prev, [field]: value }));
  }

  function handleVehiculoClienteChange(index, field, value) {
    setClientForm((prev) => {
      const vehiculos = [...prev.vehiculos];
      vehiculos[index] = { ...vehiculos[index], [field]: value };
      return { ...prev, vehiculos };
    });
  }

  function agregarVehiculoCliente() {
    setClientForm((prev) => ({
      ...prev,
      vehiculos: [...prev.vehiculos, { patente: "", marcaModelo: "" }],
    }));
  }

  function eliminarVehiculoCliente(index) {
    setClientForm((prev) => ({
      ...prev,
      vehiculos:
        prev.vehiculos.length === 1
          ? [{ patente: "", marcaModelo: "" }]
          : prev.vehiculos.filter((_, vehiculoIndex) => vehiculoIndex !== index),
    }));
  }

  function actualizarOrdenTrabajo(index, campo, valor) {
    setForm((prev) => {
      const ordenesTrabajo = [...prev.ordenesTrabajo];
      ordenesTrabajo[index] = { ...ordenesTrabajo[index], [campo]: valor };
      return { ...prev, ordenesTrabajo };
    });
  }

  function eliminarOrdenTrabajo(index) {
    setForm((prev) => ({
      ...prev,
      ordenesTrabajo: prev.ordenesTrabajo.filter(
        (_, orderIndex) => orderIndex !== index,
      ),
    }));
  }

  function buildVehiculoSeleccionado() {
    let vehiculoString = form.vehiculoString;
    if (form.vehiculoIndex !== "" && clienteSeleccionadoTemp) {
      if (
        Array.isArray(clienteSeleccionadoTemp.vehiculos) &&
        clienteSeleccionadoTemp.vehiculos.length > 0
      ) {
        const vehiculo =
          clienteSeleccionadoTemp.vehiculos[parseInt(form.vehiculoIndex, 10)];
        vehiculoString = `${vehiculo?.marcaModelo || "Sin modelo"} (${vehiculo?.patente || "Sin patente"})`;
      } else if (clienteSeleccionadoTemp.patente) {
        vehiculoString = `${clienteSeleccionadoTemp.marcaModelo || "Sin modelo"} (${clienteSeleccionadoTemp.patente})`;
      }
    }
    return vehiculoString;
  }

  async function guardarPresupuesto(event) {
    event.preventDefault();

    if (!form.clienteId) return toast.error("Seleccioná un cliente");

    if (
      (!isEditing || form.vehiculoIndex !== "") &&
      form.vehiculoIndex === "" &&
      !form.vehiculoString
    ) {
      return toast.error("Seleccioná un vehículo");
    }

    const itemsValidos = form.items
      .filter((item) => item.desc.trim() !== "")
      .map((item) => ({
        lineId: item.lineId || `${Date.now()}_${Math.random()}`,
        kind: item.kind || "servicio",
        desc: item.desc.trim(),
        cantidad: parseFloat(item.cantidad) || 1,
        precioUnitario: parseFloat(item.precioUnitario) || 0,
        productId: item.productId || null,
        sku: item.sku || null,
        category: item.category || null,
      }));

    if (itemsValidos.length === 0) {
      return toast.error("Agregá al menos un ítem al presupuesto");
    }

    const ordenesTrabajo = form.ordenesTrabajo
      .map((orden) => ({
        draftId: orden.draftId,
        title: orden.title.trim(),
        description: orden.description.trim(),
        tasksText: orden.tasksText.trim(),
      }))
      .filter(
        (orden) =>
          orden.title || orden.description || normalizeText(orden.tasksText),
      );

    const vehiculo = buildVehiculoSeleccionado();
    const clienteNombre = clienteSeleccionadoTemp
      ? clienteSeleccionadoTemp.nombre
      : busquedaCliente;
    const total = calcularTotal(itemsValidos);

    setGuardando(true);
    try {
      const id = isEditing ? form.id : Date.now().toString();
      const key = `b_${id}`;
      const chunkDocId =
        form.chunkDoc ||
        (await findAvailableChunkDocId(ctx.firestore, "presupuestosTaller", "b_"));
      const ref = doc(ctx.firestore, "presupuestosTaller", chunkDocId);

      const payload = {
        id,
        chunkDoc: chunkDocId,
        clienteId: form.clienteId,
        clienteNombre,
        vehiculo,
        items: itemsValidos,
        total,
        notasExtras: form.notasExtras.trim(),
        ordenesTrabajo,
        sourceLocation: location,
        sourceChannel: embeddedFrom,
        actualizadoPor: nombreLogueado,
        updatedAt: new Date(),
        workOrderLinks: form.workOrderLinks || [],
        workOrderHistory: form.workOrderHistory || [],
      };

      if (isEditing) {
        payload.creadoPor = form.creadoPor || nombreLogueado;
        payload.createdAt = form.createdAt || new Date();
      } else {
        payload.creadoPor = nombreLogueado;
        payload.createdAt = new Date();
      }

      await setDoc(ref, { [key]: payload }, { merge: true });

      toast.success(
        isEditing ? "Presupuesto actualizado" : "Presupuesto creado",
      );
      setShowModalForm(false);

      if (selectedPresupuesto?.id === payload.id) {
        setSelectedPresupuesto((prev) => ({ ...prev, ...payload }));
        setShowDetailModal(true);
      }
    } catch (error) {
      console.error(error);
      toast.error("Error al guardar presupuesto");
    } finally {
      setGuardando(false);
    }
  }

  async function guardarClienteRapido(event) {
    event.preventDefault();

    if (!clientForm.nombre.trim()) {
      toast.error("El nombre del cliente es obligatorio");
      return;
    }

    const vehiculosValidos = clientForm.vehiculos
      .map((vehiculo) => ({
        patente: String(vehiculo.patente || "")
          .toUpperCase()
          .trim(),
        marcaModelo: String(vehiculo.marcaModelo || "").trim(),
      }))
      .filter((vehiculo) => vehiculo.patente);

    if (vehiculosValidos.length === 0) {
      toast.error("Agregá al menos un vehículo con patente");
      return;
    }

    setGuardandoCliente(true);
    try {
      const id = Date.now().toString();
      const key = `c_${id}`;
      const chunkDocId = await findAvailableChunkDocId(
        ctx.firestore,
        "clientesTaller",
        "c_",
      );
      const ref = doc(ctx.firestore, "clientesTaller", chunkDocId);

      const createdAt = new Date();
      const nuevoCliente = {
        id,
        chunkDoc: chunkDocId,
        nombre: clientForm.nombre.trim(),
        telefono: clientForm.telefono.trim(),
        vehiculos: vehiculosValidos,
        patente: deleteField(),
        marcaModelo: deleteField(),
        createdAt,
        updatedAt: createdAt,
      };

      await setDoc(ref, { [key]: nuevoCliente }, { merge: true });

      const clienteSeleccionado = {
        id,
        chunkDoc: chunkDocId,
        nombre: clientForm.nombre.trim(),
        telefono: clientForm.telefono.trim(),
        vehiculos: vehiculosValidos,
        createdAt,
        updatedAt: createdAt,
      };

      setForm((prev) => ({
        ...prev,
        clienteId: id,
        vehiculoIndex: "0",
        vehiculoString: "",
      }));
      setBusquedaCliente(clienteSeleccionado.nombre);
      setClienteSeleccionadoTemp(clienteSeleccionado);
      setMostrarDropdown(false);
      setShowCreateClientModal(false);
      setClientForm(getInitialClientForm());

      toast.success("Cliente creado y seleccionado");
    } catch (error) {
      console.error(error);
      toast.error("No se pudo crear el cliente");
    } finally {
      setGuardandoCliente(false);
    }
  }

  async function eliminarPresupuesto(id, chunkDoc) {
    const ok = window.confirm("¿Eliminar este presupuesto permanentemente?");
    if (!ok) return;

    try {
      const ref = doc(ctx.firestore, "presupuestosTaller", chunkDoc);
      await updateDoc(ref, { [`b_${id}`]: deleteField() });
      toast.success("Presupuesto eliminado");
      setShowDetailModal(false);
      setSelectedPresupuesto(null);
    } catch (error) {
      console.error(error);
      toast.error("Error al eliminar presupuesto");
    }
  }

  async function generarOrdenesDesdePresupuesto(presupuesto, mode) {
    if (!presupuesto?.id) return;

    if (mode === "multiple" && !(presupuesto.ordenesTrabajo || []).length) {
      toast.error("Este presupuesto no tiene órdenes de trabajo planeadas");
      return;
    }

    setGenerandoOrdenes(true);
    try {
      const baseTimestamp = Date.now();
      const drafts =
        mode === "single"
          ? [buildSingleWorkOrderDraft(presupuesto)]
          : presupuesto.ordenesTrabajo.map((orden, index) =>
              normalizeWorkOrderDraft(orden, presupuesto, index),
            );

      const createdOrders = [];

      for (let index = 0; index < drafts.length; index += 1) {
        const draft = drafts[index];
        const orderId = `${baseTimestamp}${index}`;
        const key = `t_${orderId}`;
        const chunkDocId = await findAvailableChunkDocId(
          ctx.firestore,
          "trabajosTaller",
          "t_",
        );
        const ref = doc(ctx.firestore, "trabajosTaller", chunkDocId);

        const payload = {
          id: orderId,
          chunkDoc: chunkDocId,
          clienteId: presupuesto.clienteId,
          clienteNombre: presupuesto.clienteNombre,
          vehiculo: presupuesto.vehiculo,
          descripcion: draft.description,
          tituloOrden: draft.title || null,
          mecanicosIds: [],
          mecanicosInfo: [],
          estado: "Sin comenzar",
          tareas: draft.tasks,
          historialAsignaciones: [],
          comentarios: [],
          createdAt: new Date(),
          sourceBudgetId: presupuesto.id,
          sourceBudgetChunkDoc: presupuesto.chunkDoc,
          sourceBudgetTotal: presupuesto.total || 0,
          sourceBudgetNotes: presupuesto.notasExtras || "",
          sourceBudgetItems: presupuesto.items || [],
          sourceBudgetLocation: presupuesto.sourceLocation || "taller",
          sourceBudgetChannel: presupuesto.sourceChannel || "taller",
          sourceBudgetMode: mode,
        };

        await setDoc(ref, { [key]: payload }, { merge: true });

        createdOrders.push({
          id: orderId,
          chunkDoc: chunkDocId,
          descripcion: payload.descripcion,
          tituloOrden: payload.tituloOrden,
          createdAt: payload.createdAt,
          mode,
        });
      }

      const nextLinks = mergeWorkOrderLinks(
        presupuesto.workOrderLinks || [],
        createdOrders,
      );
      const nextHistory = [
        ...(presupuesto.workOrderHistory || []),
        {
          generatedAt: new Date(),
          generatedBy: nombreLogueado,
          mode,
          orderIds: createdOrders.map((item) => item.id),
        },
      ];

      const ref = doc(ctx.firestore, "presupuestosTaller", presupuesto.chunkDoc);
      await updateDoc(ref, {
        [`b_${presupuesto.id}.workOrderLinks`]: nextLinks,
        [`b_${presupuesto.id}.workOrderHistory`]: nextHistory,
        [`b_${presupuesto.id}.updatedAt`]: new Date(),
        [`b_${presupuesto.id}.actualizadoPor`]: nombreLogueado,
      });

      setSelectedPresupuesto((prev) =>
        prev?.id === presupuesto.id
          ? { ...prev, workOrderLinks: nextLinks, workOrderHistory: nextHistory }
          : prev,
      );

      toast.success(
        mode === "single"
          ? "Orden creada desde el presupuesto"
          : `${createdOrders.length} órdenes creadas desde el presupuesto`,
      );
    } catch (error) {
      console.error(error);
      toast.error("No se pudieron generar las órdenes de trabajo");
    } finally {
      setGenerandoOrdenes(false);
    }
  }

  const sourceLabel =
    embeddedFrom === "pv" ? `Presupuestos de taller desde ${location.toUpperCase()}` : "Presupuestos del taller";

  return (
    <div className="animate-in fade-in duration-200">
      <div className="flex flex-col gap-4 border-b border-white/10 pb-4 mb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-xl font-semibold tracking-tight text-white">
              {sourceLabel}
            </h3>
            <HelpHint
              title="Presupuestos del taller"
              description="Esta pantalla se usa para cotizar trabajos, repuestos y planificar cómo bajar el presupuesto a órdenes operativas."
              sections={[
                {
                  label: "Qué es",
                  value:
                    "Es el módulo interno para preparar presupuestos de taller con servicios, productos y desglose operativo.",
                },
                {
                  label: "Qué hace",
                  value:
                    "Permite cargar ítems, adjuntar productos, definir órdenes planeadas y generar órdenes de trabajo desde el presupuesto.",
                },
                {
                  label: "Quién lo ve",
                  value:
                    embeddedFrom === "pv"
                      ? "Lo ve el personal habilitado que trabaja desde puntos de venta y taller."
                      : "Lo ve el personal del taller con permiso y el admin general.",
                },
                {
                  label: "Uso interno",
                  value:
                    "Sí. El presupuesto no descuenta stock; solo organiza la cotización y el trabajo a realizar.",
                },
              ]}
            />
          </div>
          <p className="text-sm mt-1 text-white/50">
            Total registrados: {presupuestos.length}
          </p>
        </div>

        <div className="flex flex-col gap-3 w-full sm:w-auto sm:flex-row">
          <input
            type="text"
            placeholder="Buscar presupuesto..."
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            className="w-full px-4 py-2 text-sm text-white transition border rounded-xl bg-[#0C212D] border-white/10 focus:outline-none focus:border-emerald-400 sm:w-72"
          />
          <button
            onClick={abrirCrear}
            className="flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold text-white transition rounded-xl shadow-lg bg-emerald-500 hover:bg-emerald-600"
          >
            <span>+</span>
            Crear presupuesto
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#112C3E] shadow-xl">
        {presupuestosFiltrados.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 opacity-60">
            <span className="text-4xl mb-3">📄</span>
            <p className="text-sm italic">
              No hay presupuestos de taller creados todavía.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left whitespace-nowrap">
              <thead className="bg-white/5 text-white/60 uppercase tracking-wider text-[11px] font-semibold border-b border-white/10">
                <tr>
                  <th className="px-5 py-4">Fecha</th>
                  <th className="px-5 py-4">Cliente y vehículo</th>
                  <th className="px-5 py-4">Origen</th>
                  <th className="px-5 py-4">Desglose</th>
                  <th className="px-5 py-4 text-right">Total</th>
                  <th className="px-5 py-4 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {presupuestosFiltrados.map((presupuesto) => {
                  const resumen = summarizeBudget(presupuesto);
                  return (
                    <tr
                      key={presupuesto.id}
                      onClick={() => verDetalles(presupuesto)}
                      className="transition cursor-pointer hover:bg-white/5 group"
                    >
                      <td className="px-5 py-4 text-white/70">
                        <p className="font-medium text-white transition group-hover:text-emerald-400">
                          {timestampLabel(presupuesto.createdAt)}
                        </p>
                        <p className="text-[10px] mt-1 text-white/40">
                          ID: {String(presupuesto.id || "").slice(-6)}
                        </p>
                      </td>
                      <td className="px-5 py-4">
                        <p className="text-base font-semibold text-white">
                          {presupuesto.clienteNombre}
                        </p>
                        <p className="text-xs mt-0.5 text-white/50">
                          {presupuesto.vehiculo}
                        </p>
                      </td>
                      <td className="px-5 py-4">
                        <span className="inline-flex px-2.5 py-1 text-[10px] font-semibold tracking-widest uppercase rounded-lg border bg-white/5 border-white/10 text-white/70">
                          {(presupuesto.sourceLocation || "taller").toUpperCase()}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-xs text-white/70">
                        <p>{resumen.services} servicio(s)</p>
                        <p>{resumen.products} producto(s)</p>
                        <p>{resumen.workOrders} orden(es) planificada(s)</p>
                      </td>
                      <td className="px-5 py-4 text-right text-base font-bold text-emerald-400">
                        {money(presupuesto.total || 0)}
                      </td>
                      <td className="px-5 py-4 text-right">
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            enviarWhatsApp(presupuesto, clientes);
                          }}
                          className="px-3 py-1.5 mr-2 text-xs font-semibold transition border rounded-lg text-[#25D366] bg-[#25D366]/10 hover:bg-[#25D366]/20 border-[#25D366]/30"
                        >
                          WhatsApp
                        </button>
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            abrirEditar(presupuesto);
                          }}
                          className="px-2 py-1.5 mr-2 text-xs font-medium transition rounded-lg text-white/40 hover:text-white hover:bg-white/5"
                        >
                          Editar
                        </button>
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            verDetalles(presupuesto);
                          }}
                          className="px-3 py-1.5 font-medium transition border rounded-lg text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 border-emerald-500/20"
                        >
                          Ver
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showDetailModal && selectedPresupuesto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md"
          onMouseDown={detailPresupuestoModal.handleBackdropMouseDown}
        >
          <div
            ref={detailPresupuestoModal.modalRef}
            className="bg-[#0C212D] border border-white/10 rounded-3xl w-full max-w-6xl max-h-[92vh] flex flex-col shadow-2xl animate-in fade-in zoom-in-95 duration-200"
          >
            <div className="shrink-0 p-6 border-b border-white/10 bg-[#0C212D]/95 rounded-t-3xl">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <h3 className="flex items-center gap-3 text-2xl font-bold tracking-tight text-white">
                    Presupuesto
                    <span className="px-2 py-1 text-sm font-mono rounded-md bg-white/5 text-white/40">
                      #{String(selectedPresupuesto.id || "").slice(-6)}
                    </span>
                  </h3>
                  <p className="mt-1 text-sm text-white/60">
                    Creado el {timestampLabel(selectedPresupuesto.createdAt)} por{" "}
                    {selectedPresupuesto.creadoPor || "Admin"}
                  </p>
                </div>

                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={() => enviarWhatsApp(selectedPresupuesto, clientes)}
                    className="px-4 py-2.5 text-sm font-semibold transition border rounded-xl text-[#25D366] bg-[#25D366]/20 hover:bg-[#25D366]/30 border-[#25D366]/30"
                  >
                    Enviar WhatsApp
                  </button>
                  <button
                    onClick={() =>
                      generarOrdenesDesdePresupuesto(selectedPresupuesto, "single")
                    }
                    disabled={generandoOrdenes}
                    className="px-4 py-2.5 text-sm font-semibold text-white transition rounded-xl bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50"
                  >
                    Crear orden única
                  </button>
                  <button
                    onClick={() =>
                      generarOrdenesDesdePresupuesto(selectedPresupuesto, "multiple")
                    }
                    disabled={
                      generandoOrdenes ||
                      !(selectedPresupuesto.ordenesTrabajo || []).length
                    }
                    className="px-4 py-2.5 text-sm font-semibold transition rounded-xl bg-sky-500/20 text-sky-300 hover:bg-sky-500/30 disabled:opacity-40"
                  >
                    Crear órdenes del desglose
                  </button>
                  <button
                    onClick={() => abrirEditar(selectedPresupuesto)}
                    className="px-5 py-2.5 text-sm font-semibold text-white transition rounded-xl bg-white/10 hover:bg-white/20"
                  >
                    Editar
                  </button>
                  <button
                    onClick={cerrarModales}
                    className="p-2 transition rounded-xl text-white/50 hover:text-white hover:bg-white/5"
                  >
                    ×
                  </button>
                </div>
              </div>
            </div>

            <div className="flex-1 p-6 overflow-y-auto space-y-6">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                <InfoCard label="Cliente" value={selectedPresupuesto.clienteNombre} />
                <InfoCard label="Vehículo" value={selectedPresupuesto.vehiculo} />
                <InfoCard
                  label="Origen"
                  value={(selectedPresupuesto.sourceLocation || "taller").toUpperCase()}
                />
                <InfoCard
                  label="Total"
                  value={money(selectedPresupuesto.total || 0)}
                  accent="text-emerald-400"
                />
              </div>

              <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
                <div className="xl:col-span-2 rounded-2xl border border-white/5 bg-[#112C3E] overflow-hidden">
                  <div className="p-4 border-b border-white/10 bg-white/5">
                    <h4 className="text-xs font-bold tracking-widest uppercase text-emerald-400">
                      Detalle completo del presupuesto
                    </h4>
                  </div>
                  <table className="w-full text-sm text-left">
                    <thead className="bg-[#0C212D]/50 text-white/50 text-[10px] uppercase">
                      <tr>
                        <th className="p-4 font-semibold">Tipo</th>
                        <th className="p-4 font-semibold">Descripción</th>
                        <th className="p-4 font-semibold text-center w-24">
                          Cant.
                        </th>
                        <th className="p-4 font-semibold text-right w-32">
                          Precio u.
                        </th>
                        <th className="p-4 font-semibold text-right w-32">
                          Subtotal
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {(selectedPresupuesto.items || []).map((item) => (
                        <tr key={item.lineId || `${item.desc}_${item.cantidad}`}>
                          <td className="p-4">
                            <span
                              className={`inline-flex px-2 py-1 text-[10px] font-semibold tracking-widest uppercase rounded-lg border ${item.kind === "producto" ? "border-sky-400/30 bg-sky-400/10 text-sky-300" : "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"}`}
                            >
                              {item.kind === "producto" ? "Producto" : "Servicio"}
                            </span>
                          </td>
                          <td className="p-4 text-white/90">
                            <p>{item.desc}</p>
                            {(item.sku || item.category) && (
                              <p className="text-[11px] mt-1 text-white/40">
                                {[item.sku, item.category].filter(Boolean).join(" · ")}
                              </p>
                            )}
                          </td>
                          <td className="p-4 text-center text-white/70">
                            {item.cantidad}
                          </td>
                          <td className="p-4 text-right text-white/70">
                            {money(item.precioUnitario || 0)}
                          </td>
                          <td className="p-4 font-medium text-right text-white">
                            {money(
                              (item.cantidad || 0) * (item.precioUnitario || 0),
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="flex justify-end gap-6 p-5 border-t border-white/10 bg-white/5">
                    <p className="text-sm font-semibold tracking-widest uppercase text-white/50">
                      Total:
                    </p>
                    <p className="text-3xl font-bold text-emerald-400">
                      {money(selectedPresupuesto.total || 0)}
                    </p>
                  </div>
                </div>

                <div className="space-y-6">
                  <PanelCard
                    title="Órdenes planificadas"
                    subtitle="Así se puede bajar este presupuesto al taller."
                  >
                    {(selectedPresupuesto.ordenesTrabajo || []).length === 0 ? (
                      <p className="text-sm italic text-white/40">
                        No hay órdenes cargadas. Podés crear una orden única desde
                        este presupuesto.
                      </p>
                    ) : (
                      <div className="space-y-3">
                        {selectedPresupuesto.ordenesTrabajo.map((orden, index) => (
                          <div
                            key={orden.draftId || `${orden.title}_${index}`}
                            className="p-3 rounded-xl border border-white/10 bg-[#0C212D]"
                          >
                            <p className="font-semibold text-white">
                              {orden.title || `Orden ${index + 1}`}
                            </p>
                            {orden.description && (
                              <p className="mt-1 text-sm leading-relaxed text-white/70">
                                {orden.description}
                              </p>
                            )}
                            <TaskPreview tasksText={orden.tasksText} />
                          </div>
                        ))}
                      </div>
                    )}
                  </PanelCard>

                  <PanelCard
                    title="Órdenes ya generadas"
                    subtitle="Historial de órdenes creadas desde este presupuesto."
                  >
                    {(selectedPresupuesto.workOrderLinks || []).length === 0 ? (
                      <p className="text-sm italic text-white/40">
                        Todavía no se generaron órdenes desde este presupuesto.
                      </p>
                    ) : (
                      <div className="space-y-3">
                        {selectedPresupuesto.workOrderLinks.map((orden) => (
                          <div
                            key={orden.id}
                            className="p-3 rounded-xl border border-white/10 bg-[#0C212D]"
                          >
                            <p className="font-semibold text-white">
                              {orden.tituloOrden || orden.descripcion || "Orden creada"}
                            </p>
                            <p className="text-xs mt-1 text-white/50">
                              #{String(orden.id || "").slice(-6)} ·{" "}
                              {timestampLabel(orden.createdAt)}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </PanelCard>

                  {selectedPresupuesto.notasExtras && (
                    <PanelCard title="Notas adicionales">
                      <p className="text-sm whitespace-pre-line text-white/80">
                        {selectedPresupuesto.notasExtras}
                      </p>
                    </PanelCard>
                  )}
                </div>
              </div>
            </div>

            <div className="shrink-0 p-6 border-t border-white/10 bg-[#112C3E]/50 rounded-b-3xl flex justify-end">
              <button
                onClick={() =>
                  eliminarPresupuesto(
                    selectedPresupuesto.id,
                    selectedPresupuesto.chunkDoc,
                  )
                }
                className="px-4 py-2 text-sm font-semibold text-red-400 transition rounded-xl hover:bg-red-500 hover:text-white"
              >
                Eliminar presupuesto permanentemente
              </button>
            </div>
          </div>
        </div>
      )}

      {showModalForm && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md"
          onMouseDown={formPresupuestoModal.handleBackdropMouseDown}
        >
          <div
            ref={formPresupuestoModal.modalRef}
            className="bg-[#0C212D] border border-white/10 rounded-3xl w-full max-w-7xl max-h-[95vh] flex flex-col shadow-2xl animate-in fade-in zoom-in-95 duration-200"
          >
            <div className="shrink-0 flex items-center justify-between p-6 border-b border-white/10 bg-[#112C3E] rounded-t-3xl">
              <div>
                <h3 className="text-xl font-bold tracking-tight text-white">
                  {isEditing ? "Editar presupuesto" : "Nuevo presupuesto"}
                </h3>
                <p className="mt-1 text-sm text-white/50">
                  Podés cotizar servicios, repuestos y dejar armado el desglose a
                  órdenes de trabajo.
                </p>
              </div>
              <button
                onClick={cerrarModales}
                className="p-2 transition rounded-xl text-white/50 hover:text-white hover:bg-white/10"
              >
                ×
              </button>
            </div>

            <form
              onSubmit={guardarPresupuesto}
              className="flex-1 overflow-y-auto p-6 grid grid-cols-1 xl:grid-cols-12 gap-6"
            >
              <div className="space-y-6 xl:col-span-3">
                <PanelCard title="1. Cliente y vehículo">
                  <div className="relative" ref={dropdownRef}>
                    <input
                      type="text"
                      value={busquedaCliente}
                      onChange={(event) => {
                        setBusquedaCliente(event.target.value);
                        setMostrarDropdown(true);
                        setForm((prev) => ({
                          ...prev,
                          clienteId: "",
                          vehiculoIndex: "",
                          vehiculoString: "",
                        }));
                        setClienteSeleccionadoTemp(null);
                      }}
                      onFocus={() => setMostrarDropdown(true)}
                      placeholder="Buscar cliente..."
                      className="w-full p-3 text-sm text-white border rounded-xl bg-[#0C212D] border-white/10 focus:outline-none focus:border-emerald-400"
                      required
                    />

                    {mostrarDropdown && (
                      <ul className="absolute z-50 w-full mt-1 overflow-y-auto border shadow-2xl rounded-xl bg-[#112C3E] border-white/10 max-h-48">
                        {clientesFiltradosDropdown.length === 0 ? (
                          <li className="p-3 text-sm italic text-center text-white/50">
                            No encontrado
                          </li>
                        ) : (
                          clientesFiltradosDropdown.map((cliente) => (
                            <li
                              key={cliente.id}
                              onClick={() => {
                                setForm((prev) => ({
                                  ...prev,
                                  clienteId: cliente.id,
                                  vehiculoIndex: "",
                                  vehiculoString: "",
                                }));
                                setBusquedaCliente(cliente.nombre || "");
                                setClienteSeleccionadoTemp(cliente);
                                setMostrarDropdown(false);
                              }}
                              className="flex flex-col gap-1 p-3 text-sm cursor-pointer border-b border-white/5 hover:bg-white/10"
                            >
                              <span className="font-semibold text-white">
                                {cliente.nombre}
                              </span>
                              <span className="text-[10px] text-emerald-400">
                                {Array.isArray(cliente.vehiculos)
                                  ? cliente.vehiculos
                                      .map((vehiculo) => vehiculo.patente)
                                      .filter(Boolean)
                                      .join(", ")
                                  : cliente.patente || ""}
                              </span>
                            </li>
                          ))
                        )}
                      </ul>
                    )}
                  </div>

                  {embeddedFrom === "pv" && (
                    <button
                      type="button"
                      onClick={abrirCrearClienteRapido}
                      className="mt-3 w-full px-3 py-2.5 text-sm font-semibold transition border rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 border-emerald-500/20 text-emerald-300"
                    >
                      + Crear cliente desde acá
                    </button>
                  )}

                  {(clienteSeleccionadoTemp || form.vehiculoString) && (
                    <select
                      required={!form.vehiculoString}
                      value={form.vehiculoIndex}
                      onChange={(event) =>
                        setForm((prev) => ({
                          ...prev,
                          vehiculoIndex: event.target.value,
                        }))
                      }
                      className="w-full mt-4 p-3 text-sm text-white border rounded-xl bg-[#0C212D] border-white/10 focus:outline-none focus:border-emerald-400"
                    >
                      {form.vehiculoString ? (
                        <option value="">{form.vehiculoString} (Actual)</option>
                      ) : (
                        <option value="">Seleccioná vehículo...</option>
                      )}
                      {clienteSeleccionadoTemp?.vehiculos?.map((vehiculo, index) => (
                        <option key={index} value={index}>
                          {vehiculo.marcaModelo || "Sin modelo"} -{" "}
                          {vehiculo.patente || "Sin patente"}
                        </option>
                      ))}
                      {clienteSeleccionadoTemp?.patente &&
                        !clienteSeleccionadoTemp?.vehiculos && (
                          <option value="0">
                            {clienteSeleccionadoTemp.marcaModelo || "Sin modelo"} -{" "}
                            {clienteSeleccionadoTemp.patente}
                          </option>
                        )}
                    </select>
                  )}
                </PanelCard>

                <PanelCard title="2. Notas adicionales">
                  <textarea
                    rows="6"
                    value={form.notasExtras}
                    onChange={(event) =>
                      setForm((prev) => ({
                        ...prev,
                        notasExtras: event.target.value,
                      }))
                    }
                    placeholder="Ej: entregar antes del viernes, revisar ruido en tren delantero, validez de la cotización..."
                    className="w-full p-3 text-sm text-white border rounded-xl resize-none bg-[#0C212D] border-white/10 focus:outline-none focus:border-emerald-400 placeholder:text-white/20"
                  />
                </PanelCard>

                <PanelCard title="Resumen actual">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <StatPill label="Servicios" value={formServiceCount} />
                    <StatPill label="Productos" value={formProductCount} />
                    <StatPill
                      label="Órdenes"
                      value={form.ordenesTrabajo.length}
                    />
                    <StatPill
                      label="Total"
                      value={money(formTotal)}
                      accent="text-emerald-400"
                    />
                  </div>
                  <p className="mt-4 text-xs text-white/50">
                    Los productos se adjuntan al presupuesto pero no descuentan
                    stock hasta la venta y cierre del trabajo.
                  </p>
                </PanelCard>
              </div>

              <div className="space-y-6 xl:col-span-5">
                <PanelCard
                  title="3. Detalle del presupuesto"
                  subtitle="Cargá mano de obra, servicios y repuestos en el mismo documento."
                >
                  <div className="flex flex-wrap gap-2 mb-4">
                    <button
                      type="button"
                      onClick={() => agregarItem("servicio")}
                      className="px-3 py-1.5 text-xs font-semibold transition border rounded-lg bg-white/5 hover:bg-white/10 border-white/10"
                    >
                      + Servicio manual
                    </button>
                    <button
                      type="button"
                      onClick={() => agregarItem("producto")}
                      className="px-3 py-1.5 text-xs font-semibold transition border rounded-lg bg-sky-500/10 hover:bg-sky-500/20 border-sky-500/20 text-sky-300"
                    >
                      + Producto manual
                    </button>
                  </div>

                  <div className="space-y-3 max-h-[28rem] overflow-y-auto pr-1">
                    {form.items.map((item, index) => {
                      const subtotal =
                        (parseFloat(item.cantidad) || 0) *
                        (parseFloat(item.precioUnitario) || 0);

                      return (
                        <div
                          key={item.lineId || index}
                          className="rounded-xl border border-white/5 bg-[#0C212D] p-3"
                        >
                          <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
                            <div className="md:col-span-2">
                              <label className="block text-[10px] uppercase tracking-wide text-white/50 font-semibold mb-1">
                                Tipo
                              </label>
                              <select
                                value={item.kind || "servicio"}
                                onChange={(event) =>
                                  actualizarItem(index, "kind", event.target.value)
                                }
                                className="w-full p-2 text-sm text-white border rounded-lg bg-[#112C3E] border-white/10 focus:outline-none focus:border-emerald-400"
                              >
                                <option value="servicio">Servicio</option>
                                <option value="producto">Producto</option>
                              </select>
                            </div>
                            <div className="md:col-span-6">
                              <label className="block text-[10px] uppercase tracking-wide text-white/50 font-semibold mb-1">
                                Descripción
                              </label>
                              <input
                                type="text"
                                required
                                value={item.desc}
                                onChange={(event) =>
                                  actualizarItem(index, "desc", event.target.value)
                                }
                                placeholder="Ej: cambio de distribución, filtro de aceite, juego de pastillas..."
                                className="w-full p-2 text-sm text-white border rounded-lg bg-transparent border-white/10 focus:outline-none focus:border-emerald-400"
                              />
                              {(item.sku || item.category) && (
                                <p className="mt-1 text-[11px] text-white/40">
                                  {[item.sku, item.category]
                                    .filter(Boolean)
                                    .join(" · ")}
                                </p>
                              )}
                            </div>
                            <div className="md:col-span-2">
                              <label className="block text-[10px] uppercase tracking-wide text-white/50 font-semibold mb-1">
                                Cant.
                              </label>
                              <input
                                type="number"
                                min="0.1"
                                step="any"
                                required
                                value={item.cantidad}
                                onChange={(event) =>
                                  actualizarItem(
                                    index,
                                    "cantidad",
                                    event.target.value,
                                  )
                                }
                                className="w-full p-2 text-sm text-center text-white border rounded-lg bg-transparent border-white/10 focus:outline-none focus:border-emerald-400"
                              />
                            </div>
                            <div className="md:col-span-2">
                              <label className="block text-[10px] uppercase tracking-wide text-white/50 font-semibold mb-1">
                                Precio
                              </label>
                              <input
                                type="number"
                                min="0"
                                step="any"
                                required
                                value={item.precioUnitario}
                                onChange={(event) =>
                                  actualizarItem(
                                    index,
                                    "precioUnitario",
                                    event.target.value,
                                  )
                                }
                                className="w-full p-2 text-sm text-white border rounded-lg bg-transparent border-white/10 focus:outline-none focus:border-emerald-400"
                              />
                            </div>
                          </div>

                          <div className="flex items-center justify-between mt-3">
                            <p className="text-sm font-semibold text-emerald-400">
                              Subtotal: {money(subtotal)}
                            </p>
                            <button
                              type="button"
                              onClick={() => eliminarItem(index)}
                              className="px-2 py-1 text-sm transition rounded-lg text-red-400/80 hover:text-red-300 hover:bg-red-400/10"
                            >
                              Eliminar
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex justify-end gap-6 p-4 mt-4 rounded-xl bg-white/5">
                    <p className="text-sm font-semibold tracking-widest uppercase text-white/50">
                      Total estimado
                    </p>
                    <p className="text-3xl font-bold text-emerald-400">
                      {money(formTotal)}
                    </p>
                  </div>
                </PanelCard>
              </div>

              <div className="space-y-6 xl:col-span-4">
                <PanelCard
                  title="4. Adjuntar productos desde inventario"
                  subtitle="Solo suman al presupuesto; no mueven stock."
                >
                  <div className="relative" ref={productDropdownRef}>
                    <input
                      type="text"
                      value={productQuery}
                      onChange={(event) => {
                        setProductQuery(event.target.value);
                        setMostrarProductos(true);
                      }}
                      onFocus={() => setMostrarProductos(true)}
                      placeholder="Buscar producto por nombre, SKU o categoría..."
                      className="w-full p-3 text-sm text-white border rounded-xl bg-[#0C212D] border-white/10 focus:outline-none focus:border-emerald-400"
                    />

                    {mostrarProductos && (
                      <div className="absolute z-40 w-full mt-2 overflow-hidden border shadow-2xl rounded-2xl bg-[#112C3E] border-white/10">
                        <div className="max-h-72 overflow-y-auto">
                          {productosFiltrados.length === 0 ? (
                            <div className="p-4 text-sm italic text-center text-white/50">
                              No encontramos productos con esa búsqueda.
                            </div>
                          ) : (
                            productosFiltrados.map((producto) => (
                              <button
                                key={producto.id}
                                type="button"
                                onClick={() => agregarProducto(producto)}
                                className="flex items-center justify-between w-full gap-3 p-3 text-left transition border-b border-white/5 hover:bg-white/10"
                              >
                                <div className="min-w-0">
                                  <p className="font-semibold text-white truncate">
                                    {producto.name || "Producto sin nombre"}
                                  </p>
                                  <p className="text-[11px] text-white/40">
                                    {[producto.sku, producto.category]
                                      .filter(Boolean)
                                      .join(" · ")}
                                  </p>
                                </div>
                                <div className="shrink-0 text-right">
                                  <p className="font-semibold text-emerald-400">
                                    {money(finalPrice(producto) || 0)}
                                  </p>
                                  <p className="text-[10px] uppercase tracking-wider text-white/30">
                                    Añadir
                                  </p>
                                </div>
                              </button>
                            ))
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </PanelCard>

                <PanelCard
                  title="5. Desglose a órdenes de trabajo"
                  subtitle="Podés dejar planeado cómo se va a repartir el trabajo."
                >
                  <div className="flex justify-between items-center mb-4">
                    <p className="text-sm text-white/60">
                      Si no cargás desglose, después igual vas a poder crear una
                      orden única desde el detalle del presupuesto.
                    </p>
                    <button
                      type="button"
                      onClick={agregarOrdenTrabajo}
                      className="px-3 py-1.5 text-xs font-semibold transition border rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 border-emerald-500/20 text-emerald-300"
                    >
                      + Nueva orden
                    </button>
                  </div>

                  <div className="space-y-3 max-h-[24rem] overflow-y-auto pr-1">
                    {form.ordenesTrabajo.length === 0 ? (
                      <div className="p-5 text-sm italic text-center rounded-xl bg-[#0C212D] border border-white/5 text-white/40">
                        Todavía no agregaste órdenes planeadas.
                      </div>
                    ) : (
                      form.ordenesTrabajo.map((orden, index) => (
                        <div
                          key={orden.draftId || index}
                          className="p-4 rounded-xl border border-white/10 bg-[#0C212D]"
                        >
                          <div className="flex items-center justify-between mb-3">
                            <p className="text-sm font-semibold text-white">
                              Orden {index + 1}
                            </p>
                            <button
                              type="button"
                              onClick={() => eliminarOrdenTrabajo(index)}
                              className="text-xs transition text-red-400/80 hover:text-red-300"
                            >
                              Eliminar
                            </button>
                          </div>

                          <div className="space-y-3">
                            <input
                              type="text"
                              value={orden.title}
                              onChange={(event) =>
                                actualizarOrdenTrabajo(
                                  index,
                                  "title",
                                  event.target.value,
                                )
                              }
                              placeholder="Título corto de la orden"
                              className="w-full p-2.5 text-sm text-white border rounded-lg bg-[#112C3E] border-white/10 focus:outline-none focus:border-emerald-400"
                            />
                            <textarea
                              rows="3"
                              value={orden.description}
                              onChange={(event) =>
                                actualizarOrdenTrabajo(
                                  index,
                                  "description",
                                  event.target.value,
                                )
                              }
                              placeholder="Qué se va a hacer en esta orden..."
                              className="w-full p-2.5 text-sm text-white border rounded-lg resize-none bg-[#112C3E] border-white/10 focus:outline-none focus:border-emerald-400"
                            />
                            <textarea
                              rows="4"
                              value={orden.tasksText}
                              onChange={(event) =>
                                actualizarOrdenTrabajo(
                                  index,
                                  "tasksText",
                                  event.target.value,
                                )
                              }
                              placeholder={"Tareas, una por línea\nEj:\nDesmontar tren delantero\nCambiar rulemanes\nProbar en ruta"}
                              className="w-full p-2.5 text-sm text-white border rounded-lg resize-none bg-[#112C3E] border-white/10 focus:outline-none focus:border-emerald-400"
                            />
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </PanelCard>
              </div>

              <div className="xl:col-span-12 flex justify-end gap-3 pt-4 border-t border-white/10">
                <button
                  type="button"
                  onClick={cerrarModales}
                  className="px-6 py-3 text-sm font-semibold transition rounded-xl text-white/70 hover:bg-white/10"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={guardando || !form.clienteId}
                  className="px-8 py-3 font-semibold text-white transition rounded-xl shadow-lg bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50"
                >
                  {guardando
                    ? "Guardando..."
                    : isEditing
                      ? "Guardar cambios"
                      : "Crear presupuesto"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showCreateClientModal && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md"
          onMouseDown={createClientModal.handleBackdropMouseDown}
        >
          <div
            ref={createClientModal.modalRef}
            className="bg-[#0C212D] border border-white/10 rounded-3xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl animate-in fade-in zoom-in-95 duration-200"
          >
            <div className="shrink-0 flex items-center justify-between p-6 border-b border-white/10 bg-[#112C3E] rounded-t-3xl">
              <div>
                <h3 className="text-xl font-bold tracking-tight text-white">
                  Nuevo cliente
                </h3>
                <p className="mt-1 text-sm text-white/50">
                  Crealo sin salir del presupuesto y usalo enseguida en esta
                  cotización.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateClientModal(false)}
                className="p-2 transition rounded-xl text-white/50 hover:text-white hover:bg-white/10"
              >
                ×
              </button>
            </div>

            <form
              onSubmit={guardarClienteRapido}
              className="flex-1 overflow-y-auto p-6 space-y-6"
            >
              <PanelCard title="Datos básicos">
                <div className="space-y-4">
                  <div>
                    <label className="block text-[10px] uppercase tracking-wide text-white/50 font-semibold mb-1">
                      Nombre
                    </label>
                    <input
                      type="text"
                      required
                      value={clientForm.nombre}
                      onChange={(event) =>
                        handleClientInputChange("nombre", event.target.value)
                      }
                      placeholder="Nombre del cliente"
                      className="w-full p-3 text-sm text-white border rounded-xl bg-[#0C212D] border-white/10 focus:outline-none focus:border-emerald-400"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase tracking-wide text-white/50 font-semibold mb-1">
                      Teléfono
                    </label>
                    <input
                      type="text"
                      value={clientForm.telefono}
                      onChange={(event) =>
                        handleClientInputChange("telefono", event.target.value)
                      }
                      placeholder="Opcional"
                      className="w-full p-3 text-sm text-white border rounded-xl bg-[#0C212D] border-white/10 focus:outline-none focus:border-emerald-400"
                    />
                  </div>
                </div>
              </PanelCard>

              <PanelCard
                title="Vehículos"
                subtitle="Necesita al menos una patente para poder usarlo en el presupuesto."
              >
                <div className="space-y-3">
                  {clientForm.vehiculos.map((vehiculo, index) => (
                    <div
                      key={`vehiculo_${index}`}
                      className="grid grid-cols-1 gap-3 p-3 rounded-xl border border-white/5 bg-[#0C212D] md:grid-cols-12"
                    >
                      <div className="md:col-span-4">
                        <label className="block text-[10px] uppercase tracking-wide text-white/50 font-semibold mb-1">
                          Patente
                        </label>
                        <input
                          type="text"
                          value={vehiculo.patente}
                          onChange={(event) =>
                            handleVehiculoClienteChange(
                              index,
                              "patente",
                              event.target.value,
                            )
                          }
                          placeholder="ABC123"
                          className="w-full p-2.5 text-sm text-white border rounded-lg bg-[#112C3E] border-white/10 focus:outline-none focus:border-emerald-400"
                        />
                      </div>
                      <div className="md:col-span-6">
                        <label className="block text-[10px] uppercase tracking-wide text-white/50 font-semibold mb-1">
                          Marca / modelo
                        </label>
                        <input
                          type="text"
                          value={vehiculo.marcaModelo}
                          onChange={(event) =>
                            handleVehiculoClienteChange(
                              index,
                              "marcaModelo",
                              event.target.value,
                            )
                          }
                          placeholder="Ej: Gol Trend 1.6"
                          className="w-full p-2.5 text-sm text-white border rounded-lg bg-[#112C3E] border-white/10 focus:outline-none focus:border-emerald-400"
                        />
                      </div>
                      <div className="flex items-end md:col-span-2">
                        <button
                          type="button"
                          onClick={() => eliminarVehiculoCliente(index)}
                          className="w-full px-3 py-2.5 text-sm transition rounded-lg text-red-400/80 hover:text-red-300 hover:bg-red-400/10"
                        >
                          Quitar
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={agregarVehiculoCliente}
                  className="mt-4 px-3 py-2 text-xs font-semibold transition border rounded-lg bg-white/5 hover:bg-white/10 border-white/10"
                >
                  + Agregar otro vehículo
                </button>
              </PanelCard>

              <div className="flex justify-end gap-3 pt-2 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setShowCreateClientModal(false)}
                  className="px-6 py-3 text-sm font-semibold transition rounded-xl text-white/70 hover:bg-white/10"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={guardandoCliente}
                  className="px-8 py-3 font-semibold text-white transition rounded-xl shadow-lg bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50"
                >
                  {guardandoCliente ? "Guardando..." : "Crear cliente"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function getInitialForm(location, embeddedFrom) {
  return {
    id: null,
    chunkDoc: null,
    clienteId: "",
    vehiculoString: "",
    vehiculoIndex: "",
    items: [createEmptyItem()],
    notasExtras: "",
    ordenesTrabajo: [],
    createdAt: null,
    creadoPor: null,
    workOrderLinks: [],
    workOrderHistory: [],
    sourceLocation: location,
    sourceChannel: embeddedFrom,
  };
}

function getInitialClientForm() {
  return {
    nombre: "",
    telefono: "",
    vehiculos: [{ patente: "", marcaModelo: "" }],
  };
}

function hayCambiosSinGuardar(form) {
  const hasItems = form.items.some(
    (item) =>
      item.desc.trim() ||
      Number(item.cantidad) !== 1 ||
      Number(item.precioUnitario) > 0,
  );
  const hasOrders = form.ordenesTrabajo.some(
    (orden) => orden.title || orden.description || orden.tasksText,
  );
  return !!(
    form.clienteId ||
    form.notasExtras.trim() ||
    hasItems ||
    hasOrders
  );
}

async function findAvailableChunkDocId(firestore, collectionName, keyPrefix) {
  const snap = await getDocs(collection(firestore, collectionName));
  for (const currentDoc of snap.docs) {
    const data = currentDoc.data() || {};
    const keysCount = Object.keys(data).filter((key) =>
      key.startsWith(keyPrefix),
    ).length;
    if (keysCount < CHUNK_LIMIT) return currentDoc.id;
  }
  return doc(collection(firestore, collectionName)).id;
}

function calcularTotal(items) {
  return items.reduce((acc, item) => {
    const cantidad = parseFloat(item.cantidad) || 0;
    const precio = parseFloat(item.precioUnitario) || 0;
    return acc + cantidad * precio;
  }, 0);
}

function finalPrice(product) {
  return product?.discountActive && product?.priceDiscount > 0
    ? product.priceDiscount
    : product?.price || 0;
}

function money(value) {
  return Number(value || 0).toLocaleString("es-AR", {
    style: "currency",
    currency: "ARS",
  });
}

function timestampLabel(value) {
  if (!value) return "-";
  if (typeof value?.toDate === "function") {
    return value.toDate().toLocaleDateString("es-AR");
  }
  if (typeof value?.seconds === "number") {
    return new Date(value.seconds * 1000).toLocaleDateString("es-AR");
  }
  return new Date(value).toLocaleDateString("es-AR");
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function summarizeBudget(presupuesto) {
  const items = Array.isArray(presupuesto.items) ? presupuesto.items : [];
  return {
    services: items.filter((item) => item.kind !== "producto").length,
    products: items.filter((item) => item.kind === "producto").length,
    workOrders: Array.isArray(presupuesto.ordenesTrabajo)
      ? presupuesto.ordenesTrabajo.length
      : 0,
  };
}

function enviarWhatsApp(presupuesto, clientes) {
  const cliente = clientes.find((item) => item.id === presupuesto.clienteId);
  let telefono = cliente?.telefono || presupuesto.telefonoViejo;

  if (!telefono) {
    telefono = window.prompt(
      "El cliente no tiene teléfono registrado. Ingresalo para enviar el WhatsApp:",
    );
    if (!telefono) return;
  }

  telefono = telefono.replace(/[\s-]/g, "");

  let mensaje = `¡Hola *${presupuesto.clienteNombre}*!\n`;
  mensaje += `Te enviamos el presupuesto para tu vehículo *${presupuesto.vehiculo}*.\n\n`;
  mensaje += `*Detalle:*\n`;

  (presupuesto.items || []).forEach((item) => {
    const subtotal =
      (parseFloat(item.cantidad) || 0) * (parseFloat(item.precioUnitario) || 0);
    const tag = item.kind === "producto" ? "[Producto]" : "[Servicio]";
    mensaje += `- ${tag} ${item.desc} (x${item.cantidad}) - ${money(subtotal)}\n`;
  });

  mensaje += `\n*TOTAL ESTIMADO: ${money(presupuesto.total || 0)}*\n`;

  if (presupuesto.notasExtras) {
    mensaje += `\n_Notas: ${presupuesto.notasExtras}_\n`;
  }

  const ordenes = Array.isArray(presupuesto.ordenesTrabajo)
    ? presupuesto.ordenesTrabajo.length
    : 0;
  if (ordenes > 0) {
    mensaje += `\nEste presupuesto está planificado en ${ordenes} orden(es) de trabajo.\n`;
  }

  mensaje += "\nCualquier duda, escribinos. ¡Gracias!";

  window.open(
    `https://wa.me/${telefono}?text=${encodeURIComponent(mensaje)}`,
    "_blank",
  );
}

function buildSingleWorkOrderDraft(presupuesto) {
  const draft = normalizeWorkOrderDraft(
    presupuesto.ordenesTrabajo?.[0] || {},
    presupuesto,
    0,
  );
  const serviceTasks = (presupuesto.items || [])
    .filter((item) => item.kind !== "producto")
    .map((item) => item.desc)
    .filter(Boolean);
  const tasks =
    draft.tasks.length > 0
      ? draft.tasks
      : buildTasks(serviceTasks.length ? serviceTasks : [draft.description]);

  return {
    title: draft.title || "Orden general del presupuesto",
    description:
      draft.description ||
      `Trabajo general presupuestado para ${presupuesto.vehiculo || "el vehículo"}`,
    tasks,
  };
}

function normalizeWorkOrderDraft(orderDraft, presupuesto, index) {
  const fallbackTitle = `Orden ${index + 1} del presupuesto`;
  const rawTasks = String(orderDraft?.tasksText || "")
    .split("\n")
    .map((task) => task.trim())
    .filter(Boolean);
  const tasks = buildTasks(
    rawTasks.length > 0
      ? rawTasks
      : [orderDraft?.description || fallbackTitle].filter(Boolean),
  );

  return {
    title: orderDraft?.title?.trim() || fallbackTitle,
    description:
      orderDraft?.description?.trim() ||
      orderDraft?.title?.trim() ||
      `Trabajo presupuestado para ${presupuesto.vehiculo || "el vehículo"}`,
    tasks,
  };
}

function buildTasks(rows) {
  return rows
    .map((row) => String(row || "").trim())
    .filter(Boolean)
    .map((descripcion) => ({
      descripcion,
      completada: false,
      fechaCompletada: null,
      completadaPor: null,
    }));
}

function mergeWorkOrderLinks(existingLinks, createdOrders) {
  const byId = new Map();
  [...existingLinks, ...createdOrders].forEach((item) => {
    byId.set(item.id, item);
  });
  return Array.from(byId.values()).sort((a, b) => {
    const aMs = getTimestampMs(a.createdAt);
    const bMs = getTimestampMs(b.createdAt);
    return bMs - aMs;
  });
}

function getTimestampMs(value) {
  if (!value) return 0;
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  if (typeof value?.seconds === "number") return value.seconds * 1000;
  return new Date(value).getTime();
}

function InfoCard({ label, value, accent = "text-white" }) {
  return (
    <div className="rounded-2xl border border-white/5 bg-[#112C3E] p-5">
      <p className="text-[10px] uppercase tracking-widest text-emerald-400 font-bold mb-1">
        {label}
      </p>
      <p className={`text-lg font-medium ${accent}`}>{value || "-"}</p>
    </div>
  );
}

function PanelCard({ title, subtitle, children }) {
  return (
    <div className="rounded-2xl border border-white/5 bg-[#112C3E] p-5">
      {title && (
        <div className="mb-4">
          <h4 className="text-[10px] uppercase tracking-widest text-emerald-400 font-bold">
            {title}
          </h4>
          {subtitle && <p className="mt-1 text-sm text-white/50">{subtitle}</p>}
        </div>
      )}
      {children}
    </div>
  );
}

function StatPill({ label, value, accent = "text-white" }) {
  return (
    <div className="rounded-xl border border-white/10 bg-[#0C212D] p-3">
      <p className="text-[10px] uppercase tracking-widest text-white/40 font-semibold">
        {label}
      </p>
      <p className={`mt-1 text-sm font-semibold ${accent}`}>{value}</p>
    </div>
  );
}

function TaskPreview({ tasksText }) {
  const tasks = String(tasksText || "")
    .split("\n")
    .map((task) => task.trim())
    .filter(Boolean);

  if (!tasks.length) return null;

  return (
    <div className="mt-3 space-y-1">
      {tasks.slice(0, 4).map((task, index) => (
        <p key={`${task}_${index}`} className="text-xs text-white/60">
          • {task}
        </p>
      ))}
      {tasks.length > 4 && (
        <p className="text-xs text-white/40">
          +{tasks.length - 4} tarea(s) más
        </p>
      )}
    </div>
  );
}
