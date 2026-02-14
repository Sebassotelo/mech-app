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
  "agusmeza2812@gmail.com": [1, 2, 3, 4],
};

function Context(props) {
  const [loader, setLoader] = useState(false);
  const [user, setUser] = useState(null);
  const [user1, setUser1] = useState(null);
  const [permisos, setPermisos] = useState([]); // array de números

  const [categorias, setCategorias] = useState([]);
  const [productos, setProductos] = useState([]);
  const [ventas, setVentas] = useState([]);
  const [egresos, setEgresos] = useState([]);
  const [presupuestos, setPresupuestos] = useState([]);
  const [presupuestosLoading, setPresupuestosLoading] = useState(false);

  // ✅ Equivalencias (chunked)
  const [equivalenciasDocs, setEquivalenciasDocs] = useState([]); // chunks crudos
  const [equivalenciasMap, setEquivalenciasMap] = useState({}); // code -> obj
  const [equivalenciasLoading, setEquivalenciasLoading] = useState(false);

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

  // Índice rápido key -> producto (para resolver members a info del producto)
  const productosByKeyRef = useRef(new Map());
  useEffect(() => {
    const m = new Map();
    (Array.isArray(productos) ? productos : []).forEach((p) => {
      const key = productKey(p);
      if (key) m.set(key, p);
    });
    productosByKeyRef.current = m;
  }, [productos]);

  // Devuelve grupos equivalencia del producto actual (enriquecido)
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

  // Devuelve productos equivalentes dado un code (opcional excluyendo uno)
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

        // RT permisos del usuario
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
    if (!firestore) return;

    unsubsRef.current.forEach((u) => {
      try {
        if (typeof u === "function") u();
      } catch {}
    });
    unsubsRef.current = [];

    setLoader(true);
    setPresupuestosLoading(true);
    setEquivalenciasLoading(true);

    // --- Categorías ---
    const unsubCategorias = onSnapshot(
      collection(firestore, "categorias"),
      (snap) => {
        setCategorias(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoader(false);
      },
      (err) => {
        console.error("RT categorias:", err);
        setCategorias([]);
        setLoader(false);
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
            if (k.startsWith("p_") && v) {
              prods.push({
                id: v?.id || k.replace("p_", ""),
                chunkDoc: v?.chunkDoc || d.id,
                ...v,
              });
            }
          }
        });
        setProductos(prods);
        setLoader(false);
      },
      (err) => {
        console.error("RT productos:", err);
        setProductos([]);
        setLoader(false);
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
      },
      (err) => {
        console.error("RT equivalencias:", err);
        setEquivalenciasDocs([]);
        setEquivalenciasMap({});
        setEquivalenciasLoading(false);
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
            if (k.startsWith("v_") && v) {
              // ⚠️ CORRECCIÓN APLICADA: Inyectamos chunkDoc y aseguramos id
              arr.push({
                ...v,
                id: v.id || k, // ID de la venta
                _id: v.id || k, // Copia de seguridad
                chunkDoc: d.id, // ID del documento contenedor (para eliminar)
              });
            }
          }
        });
        // Ordenamos por fecha de creación (más reciente primero)
        arr.sort((a, b) => {
          const ta = a.createdAt?.seconds || 0;
          const tb = b.createdAt?.seconds || 0;
          return tb - ta;
        });

        setVentas(arr);
        setLoader(false);
      },
      (err) => {
        console.error("RT ventas:", err);
        setVentas([]);
        setLoader(false);
      },
    );
    unsubsRef.current.push(unsubVentas);

    // --- Presupuestos (chunked b_) ---
    const unsubPresupuestos = onSnapshot(
      collection(firestore, "presupuestos"),
      (snap) => {
        const list = [];
        snap.docs.forEach((d) => {
          const data = d.data() || {};
          for (const [k, v] of Object.entries(data)) {
            if (k.startsWith("b_") && v) {
              // ⚠️ CORRECCIÓN APLICADA: Inyectamos chunkDoc
              list.push({
                ...v,
                id: v.id || k,
                chunkDoc: d.id,
              });
            }
          }
        });
        setPresupuestos(list);
        setPresupuestosLoading(false);
      },
      (err) => {
        console.error("RT presupuestos:", err);
        setPresupuestos([]);
        setPresupuestosLoading(false);
      },
    );
    unsubsRef.current.push(unsubPresupuestos);

    // --- Caja (egresos / movimientos de caja) ---
    const unsubCaja = onSnapshot(
      collection(firestore, "caja"),
      (snap) => {
        const list = snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        }));
        setEgresos(list);
      },
      (err) => {
        console.error("RT caja:", err);
        setEgresos([]);
      },
    );
    unsubsRef.current.push(unsubCaja);

    return () => {
      unsubsRef.current.forEach((u) => {
        try {
          if (typeof u === "function") u();
        } catch {}
      });
      unsubsRef.current = [];
    };
  }, [firestore]);

  // ==========================
  // Provider
  // ==========================
  return (
    <ContextGeneral.Provider
      value={{
        auth,
        firestore,
        user,
        user1,
        permisos, // array [1,2,3...]
        loader,
        setLoader,

        categorias,
        productos,
        ventas,
        egresos, // 👈 viene de colección "caja"
        presupuestos,
        presupuestosLoading,

        // ✅ Equivalencias
        equivalenciasDocs,
        equivalenciasMap,
        equivalenciasLoading,
        getEquivalenceGroupsForProduct,
        getEquivalentProductsByCode,

        // setters
        setCategorias,
        setProductos,
        setVentas,
        setEgresos,
        setUser,
        setPermisos,
        setPresupuestos,
      }}
    >
      {props.children}
    </ContextGeneral.Provider>
  );
}

export default Context;
