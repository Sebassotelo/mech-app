// src/servicios/Context.jsx
"use client";

import React, { useEffect, useRef, useState } from "react";
import ContextGeneral from "./contextGeneral";
import firebaseApp from "./firebase";

import { getAuth, onAuthStateChanged } from "firebase/auth";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  collection,
  onSnapshot,
  serverTimestamp,
} from "firebase/firestore";

const PERMISOS_POR_DEFECTO = [1];
const PERMISOS_SEMILLA = {
  "saabtian@gmail.com": [1, 2, 3, 4],
};

function Context(props) {
  const [loader, setLoader] = useState(true);
  const [user, setUser] = useState(null);
  const [user1, setUser1] = useState(null);
  const [permisos, setPermisos] = useState([]);

  const [categorias, setCategorias] = useState([]);
  const [productos, setProductos] = useState([]);
  const [ventas, setVentas] = useState([]);
  const [egresos, setEgresos] = useState([]);

  // ✅ Presupuestos (los de antes) -> coleccion "presupuestos"
  const [presupuestos, setPresupuestos] = useState([]);
  const [presupuestosLoading, setPresupuestosLoading] = useState(false);

  // ✅ NUEVO: Presupuestos Taller -> coleccion "presupuestosTaller"
  const [presupuestosTaller, setPresupuestosTaller] = useState([]);
  const [presupuestosTallerLoading, setPresupuestosTallerLoading] =
    useState(false);

  // ✅ NUEVOS ESTADOS TALLER
  const [clientesTaller, setClientesTaller] = useState([]);
  const [trabajosTaller, setTrabajosTaller] = useState([]);

  // ✅ Equivalencias (chunked)
  const [equivalenciasDocs, setEquivalenciasDocs] = useState([]);
  const [equivalenciasMap, setEquivalenciasMap] = useState({});
  const [equivalenciasLoading, setEquivalenciasLoading] = useState(false);

  // ✅ Estado de todos los usuarios
  const [usuariosApp, setUsuariosApp] = useState([]);

  const auth = getAuth(firebaseApp);
  const firestore = getFirestore(firebaseApp);
  const userDocUnsubRef = useRef(null);

  // ==========================
  // Helpers equivalencias (join)
  // ==========================
  function productKey(p) {
    const cd = String(p?.chunkDoc || "");
    const id = String(p?.id || "");
    if (!cd || !id) return "";
    return `${cd}_${id}`;
  }

  const productosByKeyRef = useRef(new Map());
  useEffect(() => {
    const m = new Map();
    (Array.isArray(productos) ? productos : []).forEach((p) => {
      const key = productKey(p);
      if (key) m.set(key, p);
    });
    productosByKeyRef.current = m;
  }, [productos]);

  function getEquivalenceGroupsForProduct(prod) {
    const refs = Array.isArray(prod?.equivalences) ? prod.equivalences : [];
    if (!refs.length) return [];

    const out = [];
    for (const r of refs) {
      const code = String(r?.code || "").trim();
      if (!code) continue;

      const eq = equivalenciasMap?.[code];
      if (!eq) continue;

      const members = Array.isArray(eq.members) ? eq.members : [];
      const enriched = members
        .map((m) => {
          const key = `${m.chunkDoc}_${m.id}`;
          const p = productosByKeyRef.current.get(key);
          return {
            key,
            chunkDoc: m.chunkDoc,
            id: m.id,
            name: p?.name || "(sin nombre)",
            sku: p?.sku || "",
            category: p?.category || "",
            provider: p?.provider || "",
            _raw: p || null,
          };
        })
        .filter(Boolean);

      out.push({
        code,
        chunkDoc: eq.chunkDoc || r.chunkDoc || "",
        members: enriched,
      });
    }

    out.sort((a, b) => String(a.code).localeCompare(String(b.code)));
    return out;
  }

  function getEquivalentProductsByCode(code, excludeKey) {
    const c = String(code || "").trim();
    if (!c) return [];
    const eq = equivalenciasMap?.[c];
    if (!eq) return [];
    const members = Array.isArray(eq.members) ? eq.members : [];
    return members
      .map((m) => {
        const key = `${m.chunkDoc}_${m.id}`;
        if (excludeKey && key === excludeKey) return null;
        return productosByKeyRef.current.get(key) || null;
      })
      .filter(Boolean);
  }

  // ==========================
  // Crear o actualizar usuario
  // ==========================
  async function ensureUserExists(usuarioFirebase) {
    if (!firestore || !usuarioFirebase?.email) return;
    const email = usuarioFirebase.email;
    try {
      const ref = doc(firestore, "usuarios", email);
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        const permisosInicial = PERMISOS_SEMILLA[email] ?? PERMISOS_POR_DEFECTO;

        await setDoc(ref, {
          email,
          uid: usuarioFirebase.uid,
          displayName: usuarioFirebase.displayName || "",
          photoURL: usuarioFirebase.photoURL || "",
          permisos: permisosInicial,
          activo: true,
          createdAt: serverTimestamp(),
          lastLogin: serverTimestamp(),
        });
        console.log("✅ Usuario creado:", email);
      } else {
        await setDoc(ref, { lastLogin: serverTimestamp() }, { merge: true });
      }
    } catch (err) {
      console.error("Error verificando usuario:", err);
    }
  }

  // ==========================
  // Manejo de sesión
  // ==========================
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (usuarioFirebase) => {
      if (userDocUnsubRef.current) {
        try {
          userDocUnsubRef.current();
        } catch {}
        userDocUnsubRef.current = null;
      }

      if (usuarioFirebase) {
        setUser(usuarioFirebase);
        setUser1(usuarioFirebase);
        await ensureUserExists(usuarioFirebase);

        const uref = doc(firestore, "usuarios", usuarioFirebase.email);
        const unsubDoc = onSnapshot(
          uref,
          (snap) => {
            const data = snap.data() || {};
            const p = Array.isArray(data.permisos)
              ? data.permisos.filter((n) => [1, 2, 3, 4].includes(n))
              : [];
            setPermisos(p);
          },
          (err) => {
            console.error("onSnapshot(usuarios):", err);
            setPermisos([]);
          },
        );
        userDocUnsubRef.current = unsubDoc;
      } else {
        setUser(null);
        setUser1(null);
        setPermisos([]);
        setLoader(false);
      }
    });

    return () => {
      unsub();
      if (userDocUnsubRef.current) {
        try {
          userDocUnsubRef.current();
        } catch {}
        userDocUnsubRef.current = null;
      }
    };
  }, [auth, firestore]);

  // ==========================
  // RT de colecciones
  // ==========================
  const unsubsRef = useRef([]);

  useEffect(() => {
    if (!firestore || !user) return;

    unsubsRef.current.forEach((u) => {
      try {
        if (typeof u === "function") u();
      } catch {}
    });
    unsubsRef.current = [];

    setLoader(true);
    setPresupuestosLoading(true);
    setPresupuestosTallerLoading(true);
    setEquivalenciasLoading(true);

    const loadingState = {
      categorias: true,
      productos: true,
      equivalencias: true,
      ventas: true,
      presupuestos: true,
      presupuestosTaller: true,
      caja: true,
      clientes: true,
      trabajos: true,
      usuarios: true,
    };

    const checkGlobalLoader = () => {
      const stillLoading = Object.values(loadingState).some(
        (state) => state === true,
      );
      if (!stillLoading) setLoader(false);
    };

    // --- Usuarios ---
    const unsubUsuarios = onSnapshot(
      collection(firestore, "usuarios"),
      (snap) => {
        setUsuariosApp(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        loadingState.usuarios = false;
        checkGlobalLoader();
      },
      (err) => {
        console.error("RT usuarios:", err);
        setUsuariosApp([]);
        loadingState.usuarios = false;
        checkGlobalLoader();
      },
    );
    unsubsRef.current.push(unsubUsuarios);

    // --- Categorías ---
    const unsubCategorias = onSnapshot(
      collection(firestore, "categorias"),
      (snap) => {
        setCategorias(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        loadingState.categorias = false;
        checkGlobalLoader();
      },
      () => {
        loadingState.categorias = false;
        checkGlobalLoader();
      },
    );
    unsubsRef.current.push(unsubCategorias);

    // --- Productos (chunked p_) ---
    const unsubProductos = onSnapshot(
      collection(firestore, "productos"),
      (snap) => {
        const prods = [];
        snap.docs.forEach((d) => {
          const data = d.data() || {};
          for (const [k, v] of Object.entries(data)) {
            if (k.startsWith("p_") && v)
              prods.push({
                id: v?.id || k.replace("p_", ""),
                chunkDoc: v?.chunkDoc || d.id,
                ...v,
              });
          }
        });
        setProductos(prods);
        loadingState.productos = false;
        checkGlobalLoader();
      },
      () => {
        loadingState.productos = false;
        checkGlobalLoader();
      },
    );
    unsubsRef.current.push(unsubProductos);

    // --- Equivalencias (chunked e_) ---
    const unsubEquivalencias = onSnapshot(
      collection(firestore, "equivalencias"),
      (snap) => {
        const chunks = [];
        const map = {};
        snap.docs.forEach((d) => {
          const data = d.data() || {};
          chunks.push({ id: d.id, data });
          for (const [k, v] of Object.entries(data)) {
            if (!k.startsWith("e_") || !v) continue;
            const code = String(v.code || k.slice(2) || "").trim();
            if (!code) continue;
            map[code] = {
              ...v,
              code,
              chunkDoc: v.chunkDoc || d.id,
              members: Array.isArray(v.members) ? v.members : [],
            };
          }
        });
        setEquivalenciasDocs(chunks);
        setEquivalenciasMap(map);
        setEquivalenciasLoading(false);
        loadingState.equivalencias = false;
        checkGlobalLoader();
      },
      () => {
        loadingState.equivalencias = false;
        checkGlobalLoader();
      },
    );
    unsubsRef.current.push(unsubEquivalencias);

    // --- Ventas (chunked v_) ---
    const unsubVentas = onSnapshot(
      collection(firestore, "ventas"),
      (snap) => {
        const arr = [];
        snap.docs.forEach((d) => {
          const data = d.data() || {};
          for (const [k, v] of Object.entries(data)) {
            if (k.startsWith("v_") && v)
              arr.push({ ...v, id: v.id || k, _id: v.id || k, chunkDoc: d.id });
          }
        });
        arr.sort(
          (a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0),
        );
        setVentas(arr);
        loadingState.ventas = false;
        checkGlobalLoader();
      },
      () => {
        loadingState.ventas = false;
        checkGlobalLoader();
      },
    );
    unsubsRef.current.push(unsubVentas);

    // ✅ Presupuestos (los de antes) (chunked b_) -> "presupuestos"
    const unsubPresupuestos = onSnapshot(
      collection(firestore, "presupuestos"),
      (snap) => {
        const list = [];
        snap.docs.forEach((d) => {
          const data = d.data() || {};
          for (const [k, v] of Object.entries(data)) {
            if (k.startsWith("b_") && v)
              list.push({ ...v, id: v.id || k, chunkDoc: d.id });
          }
        });
        list.sort(
          (a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0),
        );
        setPresupuestos(list);
        setPresupuestosLoading(false);
        loadingState.presupuestos = false;
        checkGlobalLoader();
      },
      () => {
        loadingState.presupuestos = false;
        setPresupuestosLoading(false);
        checkGlobalLoader();
      },
    );
    unsubsRef.current.push(unsubPresupuestos);

    // ✅ NUEVO: Presupuestos Taller (chunked b_) -> "presupuestosTaller"
    const unsubPresupuestosTaller = onSnapshot(
      collection(firestore, "presupuestosTaller"),
      (snap) => {
        const list = [];
        snap.docs.forEach((d) => {
          const data = d.data() || {};
          for (const [k, v] of Object.entries(data)) {
            if (k.startsWith("b_") && v)
              list.push({ ...v, id: v.id || k, chunkDoc: d.id });
          }
        });
        list.sort(
          (a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0),
        );
        setPresupuestosTaller(list);
        setPresupuestosTallerLoading(false);
        loadingState.presupuestosTaller = false;
        checkGlobalLoader();
      },
      () => {
        loadingState.presupuestosTaller = false;
        setPresupuestosTallerLoading(false);
        checkGlobalLoader();
      },
    );
    unsubsRef.current.push(unsubPresupuestosTaller);

    // --- Caja (egresos / movimientos de caja) ---
    const unsubCaja = onSnapshot(
      collection(firestore, "caja"),
      (snap) => {
        setEgresos(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        loadingState.caja = false;
        checkGlobalLoader();
      },
      () => {
        loadingState.caja = false;
        checkGlobalLoader();
      },
    );
    unsubsRef.current.push(unsubCaja);

    // ✅ NUEVO: RT Clientes Taller (chunked c_)
    const unsubClientes = onSnapshot(
      collection(firestore, "clientesTaller"),
      (snap) => {
        const arr = [];
        snap.docs.forEach((d) => {
          const data = d.data() || {};
          for (const [k, v] of Object.entries(data)) {
            if (k.startsWith("c_") && v) {
              arr.push({
                ...v,
                id: v.id || k.replace("c_", ""),
                chunkDoc: d.id,
              });
            }
          }
        });
        arr.sort((a, b) => (a.nombre || "").localeCompare(b.nombre || ""));
        setClientesTaller(arr);
        loadingState.clientes = false;
        checkGlobalLoader();
      },
      (err) => {
        console.error("RT clientes:", err);
        setClientesTaller([]);
        loadingState.clientes = false;
        checkGlobalLoader();
      },
    );
    unsubsRef.current.push(unsubClientes);

    // ✅ NUEVO: RT Trabajos Taller (chunked t_)
    const unsubTrabajos = onSnapshot(
      collection(firestore, "trabajosTaller"),
      (snap) => {
        const arr = [];
        snap.docs.forEach((d) => {
          const data = d.data() || {};
          for (const [k, v] of Object.entries(data)) {
            if (k.startsWith("t_") && v) {
              arr.push({
                ...v,
                id: v.id || k.replace("t_", ""),
                chunkDoc: d.id,
              });
            }
          }
        });
        arr.sort(
          (a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0),
        );
        setTrabajosTaller(arr);
        loadingState.trabajos = false;
        checkGlobalLoader();
      },
      (err) => {
        console.error("RT trabajos:", err);
        setTrabajosTaller([]);
        loadingState.trabajos = false;
        checkGlobalLoader();
      },
    );
    unsubsRef.current.push(unsubTrabajos);

    return () => {
      unsubsRef.current.forEach((u) => {
        try {
          if (typeof u === "function") u();
        } catch {}
      });
      unsubsRef.current = [];
    };
  }, [firestore, user]);

  return (
    <ContextGeneral.Provider
      value={{
        auth,
        firestore,
        user,
        user1,
        permisos,
        loader,
        setLoader,
        categorias,
        productos,
        ventas,
        egresos,

        // ✅ Presupuestos (antes)
        presupuestos,
        presupuestosLoading,

        // ✅ NUEVO: Presupuestos Taller
        presupuestosTaller,
        presupuestosTallerLoading,

        equivalenciasDocs,
        equivalenciasMap,
        equivalenciasLoading,
        usuariosApp,
        getEquivalenceGroupsForProduct,
        getEquivalentProductsByCode,
        clientesTaller,
        trabajosTaller,
        setCategorias,
        setProductos,
        setVentas,
        setEgresos,
        setUser,
        setPermisos,

        // ✅ setters
        setPresupuestos,
        setPresupuestosTaller,
      }}
    >
      {props.children}
    </ContextGeneral.Provider>
  );
}

export default Context;
