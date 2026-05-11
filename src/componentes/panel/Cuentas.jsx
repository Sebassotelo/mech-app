"use client";
import React, { useContext, useEffect, useMemo, useState } from "react";
import ContextGeneral from "@/servicios/contextGeneral";
import MercadoPagoConfig from "@/componentes/panel/MercadoPagoConfig";
import useDismissibleModal from "@/hooks/useDismissibleModal";
import HelpHint from "@/componentes/HelpHint";
import { toast } from "sonner";
import {
  collection,
  onSnapshot,
  query as fsQuery,
  orderBy,
} from "firebase/firestore";

/*
  Cuentas (solo Admin 4)
  - Crea usuario en Auth vía /api/admin/createAuthUser (server).
  - CRUD de Firestore (usuarios) se hace desde cliente, como el resto de la app.
*/

export default function Cuentas() {
  const ctx = useContext(ContextGeneral);
  const { firestore, auth } = ctx || {};

  const isAdmin4 = useMemo(() => {
    const p = Array.isArray(ctx?.permisos) ? ctx.permisos : [];
    return p.includes(4);
  }, [ctx?.permisos]);

  // Estado tabla
  const [usuarios, setUsuarios] = useState([]);
  const [loadingList, setLoadingList] = useState(true);
  const [query, setQuery] = useState("");

  // Modal creación
  const [openNew, setOpenNew] = useState(false);
  const [openMpConfig, setOpenMpConfig] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newPass, setNewPass] = useState("");
  const [newName, setNewName] = useState("");
  const [newActivo, setNewActivo] = useState(true);
  const [newPermisos, setNewPermisos] = useState([]); // [1,2,3]
  const [creating, setCreating] = useState(false);
  const {
    modalRef: newUserModalRef,
    handleBackdropMouseDown: handleNewUserBackdrop,
  } = useDismissibleModal(openNew, () => setOpenNew(false));
  const {
    modalRef: mpConfigModalRef,
    handleBackdropMouseDown: handleMpConfigBackdrop,
  } = useDismissibleModal(openMpConfig, () => setOpenMpConfig(false));

  // RT usuarios
  useEffect(() => {
    if (!firestore || !isAdmin4) return;
    setLoadingList(true);
    const q = fsQuery(
      collection(firestore, "usuarios"),
      orderBy("email", "asc")
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const arr = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setUsuarios(arr);
        setLoadingList(false);
      },
      (err) => {
        console.error("RT usuarios:", err);
        setUsuarios([]);
        setLoadingList(false);
        toast.error("No se pudo cargar la lista de usuarios");
      }
    );
    return () => unsub();
  }, [firestore, isAdmin4]);

  // 🚫 NO mostrar admins (permiso 4) en la lista
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return usuarios;

    return usuarios.filter((u) => {
      const email = String(u.email || "").toLowerCase();
      const name = String(u.displayName || "").toLowerCase();
      return email.includes(q) || name.includes(q);
    });
  }, [usuarios, query]);

  const activeAdminCount = useMemo(
    () =>
      usuarios.filter((u) => {
        const perms = Array.isArray(u.permisos) ? u.permisos : [];
        return u?.activo !== false && perms.includes(4);
      }).length,
    [usuarios],
  );

  const togglePermiso = (n) => {
    setNewPermisos((prev) =>
      prev.includes(n) ? prev.filter((x) => x !== n) : [...prev, n]
    );
  };

  // === Crear: Auth (server) + usuarios/{email} (cliente) ===
  async function handleCreateUser() {
    if (!auth?.currentUser) return toast.error("No hay sesión");

    const email = newEmail.trim().toLowerCase();
    const pass = newPass.trim();
    if (!email || !pass) return toast.error("Email y contraseña obligatorios");
    if (
      !Array.isArray(newPermisos) ||
      newPermisos.some((n) => ![1, 2, 3].includes(n))
    ) {
      return toast.error("Permisos inválidos. Solo 1, 2 y/o 3.");
    }

    setCreating(true);
    try {
      const idToken = await auth.currentUser.getIdToken();

      // 1) Crear/obtener Auth user (server). NO toca Firestore.
      await toast.promise(
        fetch("/api/admin/createAuthUser", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            email,
            password: pass,
            displayName: newName.trim(),
            activo: newActivo,
          }),
        }).then(async (r) => {
          if (!r.ok) {
            const j = await r.json().catch(() => ({}));
            throw new Error(j.error || "Error creando Auth user");
          }
        }),
        {
          loading: "Creando usuario (Auth)…",
          success: "Usuario de Auth creado",
          error: (e) => e?.message || "Error creando usuario",
        }
      );

      // 2) Crear/merge doc de permisos (server)
      await toast.promise(
        fetch("/api/admin/updateUserAccess", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            email,
            displayName: newName.trim(),
            permisos: newPermisos,
            activo: newActivo,
          }),
        }).then(async (r) => {
          if (!r.ok) {
            const j = await r.json().catch(() => ({}));
            throw new Error(j.error || "No se pudo guardar en base");
          }
        }),
        {
          loading: "Guardando permisos…",
          success: "Usuario guardado en base",
          error: (e) => e?.message || "No se pudo guardar en base",
        }
      );

      // reset form
      setOpenNew(false);
      setNewEmail("");
      setNewPass("");
      setNewName("");
      setNewPermisos([]);
      setNewActivo(true);
    } catch (e) {
      console.error(e);
    } finally {
      setCreating(false);
    }
  }

  // === Update permisos/activo vía endpoint admin ===
  async function savePermisos(email, permisos, activo) {
    if (!auth?.currentUser) return toast.error("No hay sesión");
    const safe = Array.isArray(permisos)
      ? permisos.filter((n) => [1, 2, 3, 4].includes(n))
      : [];

    const currentUser = usuarios.find((u) => u.email === email) || null;
    const currentPerms = Array.isArray(currentUser?.permisos)
      ? currentUser.permisos
      : [];
    const currentActivo = currentUser?.activo !== false;
    const removesAdmin = currentPerms.includes(4) && !safe.includes(4);
    const deactivatesAdmin = currentPerms.includes(4) && currentActivo && !activo;

    if ((removesAdmin || deactivatesAdmin) && activeAdminCount <= 1) {
      return toast.error("Debe quedar al menos un usuario activo con permiso 4");
    }

    try {
      const idToken = await auth.currentUser.getIdToken();
      const res = await fetch("/api/admin/updateUserAccess", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          email,
          permisos: safe,
          activo: !!activo,
          displayName: currentUser?.displayName || "",
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "No se pudo actualizar permisos");
      }

      toast.success("Permisos actualizados");
    } catch (e) {
      console.error(e);
      toast.error(e?.message || "No se pudo actualizar permisos");
    }
  }

  if (!isAdmin4) {
    return (
      <div className="rounded-xl border border-slate-700 p-6 bg-[#0E2330]">
        <h3 className="text-lg font-semibold">Acceso restringido</h3>
        <p className="text-sm text-white/70 mt-1">
          Este módulo solo está disponible para usuarios con permiso <b>4</b>{" "}
          (Admin general).
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-xl font-semibold">Cuentas</h3>
            <HelpHint
              title="Administración de cuentas"
              description="Esta sección concentra funciones sensibles del sistema."
              sections={[
                {
                  label: "Qué es",
                  value:
                    "Es el módulo interno para administrar usuarios, permisos y ajustes de cobro.",
                },
                {
                  label: "Qué hace",
                  value:
                    "Permite crear usuarios, habilitar o deshabilitar accesos y abrir la configuración de Mercado Pago.",
                },
                {
                  label: "Quién lo ve",
                  value: "Solo lo ve el admin general con permiso 4.",
                },
                {
                  label: "Uso interno",
                  value:
                    "Sí. Acá no se cargan ventas ni tareas diarias; es una sección administrativa.",
                },
              ]}
            />
          </div>
          <p className="text-sm text-white/60">
            Gestión de usuarios y permisos.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar usuario…"
            className="px-3.5 py-2 rounded-xl bg-[#0C212D] border border-white/10 text-sm outline-none focus:ring-2 ring-[#EE7203]/60"
          />
          <button
            className="px-3.5 py-2 rounded-xl text-sm text-white bg-gradient-to-r from-[#EE7203] to-[#FF3816] hover:brightness-110"
            onClick={() => setOpenNew(true)}
          >
            Nuevo usuario
          </button>
        </div>
      </div>

      {/* LEYENDA DE NIVELES */}
      <div className="rounded-xl border border-white/10 bg-[#0E2330]">
        <div className="h-1 w-full bg-gradient-to-r from-[#EE7203] via-[#FF3816] to-[#EE7203]" />
        <div className="p-4 sm:p-5">
          <h4 className="text-sm font-semibold mb-2">Significado de niveles</h4>
          <div className="grid sm:grid-cols-4 gap-2 sm:gap-3 text-[13px]">
            <div className="flex items-start gap-2 rounded-lg border border-slate-700 bg-[#132836] p-2.5">
              <span className="inline-flex items-center justify-center h-6 w-6 rounded-md bg-[#EE7203]/20 text-[#EE7203] font-bold">
                1
              </span>
              <div className="min-w-0">
                <p className="font-medium">PV1</p>
                <p className="text-white/70">
                  Ventas / cajero — Punto de Venta 1.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-2 rounded-lg border border-slate-700 bg-[#132836] p-2.5">
              <span className="inline-flex items-center justify-center h-6 w-6 rounded-md bg-[#FF3816]/20 text-[#FF3816] font-bold">
                2
              </span>
              <div className="min-w-0">
                <p className="font-medium">PV2</p>
                <p className="text-white/70">
                  Ventas / cajero — Punto de Venta 2.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-2 rounded-lg border border-slate-700 bg-[#132836] p-2.5">
              <span className="inline-flex items-center justify-center h-6 w-6 rounded-md bg-emerald-500/20 text-emerald-300 font-bold">
                3
              </span>
              <div className="min-w-0">
                <p className="font-medium">Taller</p>
                <p className="text-white/70">Mecánico / órdenes de trabajo.</p>
              </div>
            </div>
            <div className="flex items-start gap-2 rounded-lg border border-slate-700 bg-[#132836] p-2.5">
              <span className="inline-flex items-center justify-center h-6 w-6 rounded-md bg-white/15 text-white font-bold">
                4
              </span>
              <div className="min-w-0">
                <p className="font-medium">Admin general</p>
                <p className="text-white/70">Acceso total y configuración.</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-[#0E2330] overflow-hidden">
        <div className="h-1 w-full bg-gradient-to-r from-[#00A650] via-[#009EE3] to-[#00A650]" />
        <div className="p-4 sm:p-5 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h4 className="text-lg font-semibold">Configuración Mercado Pago</h4>
              <HelpHint
                title="Configuración de cobro con QR"
                description="Este asistente prepara el cobro por Mercado Pago para cada sede."
                sections={[
                  {
                    label: "Qué es",
                    value:
                      "Es una configuración interna para conectar la cuenta del local y generar el QR fijo.",
                  },
                  {
                    label: "Qué hace",
                    value:
                      "Permite verificar la cuenta conectada, guardar la sucursal, crear la caja y dejar el QR listo para cobrar.",
                  },
                  {
                    label: "Quién lo ve",
                    value: "Solo lo ve el admin general.",
                  },
                  {
                    label: "Uso interno",
                    value:
                      "Sí. Se usa para preparar el sistema; el cliente final solo ve el QR ya impreso o disponible.",
                  },
                ]}
              />
            </div>
            <p className="text-sm text-white/65">
              Abrí el asistente para dejar lista la cuenta del local y generar el QR fijo de cada sede.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpenMpConfig(true)}
            className="inline-flex items-center justify-center rounded-2xl bg-gradient-to-r from-[#00A650] to-[#009EE3] px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-[#009EE3]/15 transition hover:brightness-110"
          >
            Configurar cobro con QR
          </button>
        </div>
      </div>

      {/* Tabla */}
      <div className="rounded-xl overflow-hidden border border-slate-700 bg-[#0E2330]">
        <div className="h-1 w-full bg-gradient-to-r from-[#EE7203] via-[#FF3816] to-[#EE7203]" />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#0A1B25]">
              <tr className="text-left">
                <th className="px-4 py-3 border-b border-white/10">Email</th>
                <th className="px-4 py-3 border-b border-white/10">Nombre</th>
                <th className="px-4 py-3 border-b border-white/10">Permisos</th>
                <th className="px-4 py-3 border-b border-white/10">Activo</th>
                <th className="px-4 py-3 border-b border-white/10 text-right">
                  Acciones
                </th>
              </tr>
            </thead>
            <tbody>
              {loadingList ? (
                <tr>
                  <td className="px-4 py-4 text-white/70" colSpan={5}>
                    Cargando…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td className="px-4 py-4 text-white/70" colSpan={5}>
                    Sin resultados.
                  </td>
                </tr>
              ) : (
                filtered.map((u) => {
                  const permisos = Array.isArray(u.permisos) ? u.permisos : [];
                  const isActive = u.activo !== false;

                  return (
                    <tr className="hover:bg-[#132836]" key={u.email}>
                      <td className="px-4 py-3 border-b border-white/10">
                        {u.email}
                      </td>
                      <td className="px-4 py-3 border-b border-white/10">
                        {u.displayName || "-"}
                      </td>
                      <td className="px-4 py-3 border-b border-white/10">
                        <div className="flex items-center gap-2 flex-wrap">
                          {[1, 2, 3, 4].map((n) => (
                            <label
                              key={n}
                              className={`inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg ring-1 ring-white/10 ${
                                permisos.includes(n)
                                  ? "bg-white/10"
                                  : "bg-transparent"
                              }`}
                            >
                              <input
                                type="checkbox"
                                className="accent-[#EE7203]"
                                checked={permisos.includes(n)}
                                onChange={(e) => {
                                  const next = e.target.checked
                                    ? [...permisos, n]
                                    : permisos.filter((x) => x !== n);
                                  savePermisos(u.email, next, isActive);
                                }}
                              />
                              <span>{n === 4 ? "Admin" : `Nivel ${n}`}</span>
                            </label>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3 border-b border-white/10">
                        <label className="inline-flex items-center gap-2 text-xs">
                          <input
                            type="checkbox"
                            className="accent-[#EE7203]"
                            checked={isActive}
                            onChange={(e) =>
                              savePermisos(u.email, permisos, e.target.checked)
                            }
                          />
                          <span>{isActive ? "Activo" : "Inactivo"}</span>
                        </label>
                      </td>
                      <td className="px-4 py-3 border-b border-white/10">
                        <div className="flex items-center justify-end gap-2">
                          <span className="text-white/40 text-xs">
                            UID: {u.uid || "-"}
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {openMpConfig && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center p-4"
          onMouseDown={handleMpConfigBackdrop}
        >
          <div className="absolute inset-0 bg-black/75" />
          <div
            ref={mpConfigModalRef}
            className="relative z-10 flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-[28px] border border-white/10 bg-[#112C3E] shadow-[0_28px_70px_rgba(0,0,0,0.45)]"
          >
            <div className="flex items-start justify-between gap-3 border-b border-white/10 p-4 sm:p-6">
              <div>
                <p className="text-[11px] uppercase tracking-[0.2em] text-white/45">
                  Ajustes de cobro
                </p>
                <h3 className="mt-1 text-xl font-semibold">Configuración Mercado Pago</h3>
                <p className="mt-1 text-sm text-white/60">
                  Verificá la cuenta del local, configurá cada sede y dejá listo el QR fijo para cobrar.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpenMpConfig(false)}
                className="rounded-xl bg-white/10 px-3 py-1.5 text-sm hover:bg-white/15"
              >
                Cerrar
              </button>
            </div>
            <div className="overflow-y-auto p-4 sm:p-6">
              <MercadoPagoConfig firestore={firestore} auth={auth} />
            </div>
          </div>
        </div>
      )}
      {/* Modal crear */}
      {openNew && (
        <div
          className="fixed inset-0 z-50 flex.items-center flex items-center justify-center p-4"
          onMouseDown={handleNewUserBackdrop}
        >
          <div className="absolute inset-0 bg-black/60" />
          <div
            ref={newUserModalRef}
            className="relative z-10 w-full max-w-md rounded-2xl border border-white/10 bg-[#112C3E] p-5 shadow-xl"
          >
            <div className="h-1 w-full bg-gradient-to-r from-[#EE7203] via-[#FF3816] to-[#EE7203] rounded-full mb-4" />
            <h4 className="text-lg font-semibold mb-2">Nuevo usuario</h4>

            <div className="space-y-3">
              <div>
                <label className="text-xs text-white/70">Email</label>
                <input
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="w-full mt-1 px-3.5 py-2 rounded-xl bg-[#0C212D] border border-white/10 text-sm outline-none focus:ring-2 ring-[#EE7203]/60"
                  placeholder="usuario@dominio.com"
                  type="email"
                />
              </div>

              <div>
                <label className="text-xs text-white/70">Contraseña</label>
                <input
                  value={newPass}
                  onChange={(e) => setNewPass(e.target.value)}
                  className="w-full mt-1 px-3.5 py-2 rounded-xl bg-[#0C212D] border border-white/10 text-sm outline-none focus:ring-2 ring-[#EE7203]/60"
                  placeholder="********"
                  type="password"
                />
              </div>

              <div>
                <label className="text-xs text-white/70">Nombre</label>
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full mt-1 px-3.5 py-2 rounded-xl bg-[#0C212D] border border-white/10 text-sm outline-none focus:ring-2 ring-[#EE7203]/60"
                  placeholder="Nombre visible (opcional)"
                />
              </div>

              <div>
                <p className="text-xs text-white/70 mb-1">Permisos</p>
                <div className="flex items-center gap-2 flex-wrap">
                  {[1, 2, 3].map((n) => (
                    <label
                      key={n}
                      className={`inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg ring-1 ring-white/10 ${
                        newPermisos.includes(n)
                          ? "bg-white/10"
                          : "bg-transparent"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="accent-[#EE7203]"
                        checked={newPermisos.includes(n)}
                        onChange={() => togglePermiso(n)}
                      />
                      <span>{`Nivel ${n}`}</span>
                    </label>
                  ))}
                  <span className="text-[11px] text-white/50">
                    (El rol 4 = Admin se asigna luego si corresponde)
                  </span>
                </div>
              </div>

              <label className="inline-flex.items-center inline-flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  className="accent-[#EE7203]"
                  checked={newActivo}
                  onChange={(e) => setNewActivo(e.target.checked)}
                />
                <span>Usuario activo</span>
              </label>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  className="px-3.5 py-2 rounded-xl text-sm bg-white/10 hover:bg-white/15"
                  onClick={() => setOpenNew(false)}
                  disabled={creating}
                >
                  Cancelar
                </button>
                <button
                  className="px-3.5 py-2 rounded-xl text-sm text-white bg-gradient-to-r from-[#EE7203] to-[#FF3816] hover:brightness-110 disabled:opacity-60"
                  onClick={handleCreateUser}
                  disabled={creating}
                >
                  {creating ? "Creando…" : "Crear"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
