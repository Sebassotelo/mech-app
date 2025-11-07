// /src/servicios/context.jsx
import React, { useEffect, useRef, useState } from "react";
import ContextGeneral from "./contextGeneral";
import firebaseApp from "./firebase";

import { getAuth, onAuthStateChanged } from "firebase/auth";
import {
  getFirestore,
  collection,
  onSnapshot,
  getDocs, // (queda por compat, aunque ya no se usa)
} from "firebase/firestore";

function Context(props) {
  // ===== Estado base =====
  const [loader, setLoader] = useState(false);

  const [user, setUser] = useState(null);
  const [user1, setUser1] = useState(null); // compat con código existente
  const [permisos, setPermisos] = useState(0); // 1 = admin, 0 = común

  const [categorias, setCategorias] = useState([]);
  const [productos, setProductos] = useState([]); // flatten p_* de /productos
  const [ventas, setVentas] = useState([]); // flatten v_* de /ventas/001,002...
  const [egresos, setEgresos] = useState([]); // (sin RT por ahora)

  // ===== Presupuestos =====
  const [presupuestos, setPresupuestos] = useState([]); // flatten b_* de /presupuestos/001,002...
  const [presupuestosLoading, setPresupuestosLoading] = useState(false);

  // ===== Firebase clients =====
  const auth = getAuth(firebaseApp);
  const firestore = getFirestore(firebaseApp);

  // ===== Admins hardcoded (podés migrar a custom claims luego) =====
  const admins = ["saabtian@gmail.com", "agusmeza2812@gmail.com"];

  // ===== Sesión =====
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (usuarioFirebase) => {
      if (usuarioFirebase) {
        setUser(usuarioFirebase);
        setUser1(usuarioFirebase); // compat
        setPermisos(admins.includes(usuarioFirebase.email) ? 1 : 0);
      } else {
        setUser(null);
        setUser1(null);
        setPermisos(0);
      }
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ===== RT helpers =====
  const unsubsRef = useRef([]);

  useEffect(() => {
    if (!firestore) return;
    // Limpio subs previas si se re-monta
    unsubsRef.current.forEach((u) => {
      try {
        if (typeof u === "function") u();
      } catch {}
    });
    unsubsRef.current = [];

    // loader inicial mientras llegan primeras snapshots
    setLoader(true);
    setPresupuestosLoading(true);

    // --- Categorías (colección simple) ---
    const unsubCategorias = onSnapshot(
      collection(firestore, "categorias"),
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setCategorias(list);
        setLoader(false);
      },
      (err) => {
        console.error("RT categorias:", err);
        setCategorias([]);
        setLoader(false);
      }
    );
    unsubsRef.current.push(unsubCategorias);

    // --- Productos (chunk docs con p_*) ---
    const unsubProductos = onSnapshot(
      collection(firestore, "productos"),
      (snap) => {
        const prods = [];
        snap.docs.forEach((docSnap) => {
          const data = docSnap.data() || {};
          for (const [k, v] of Object.entries(data)) {
            if (!k.startsWith("p_") || !v) continue;
            prods.push({
              id: v.id || k.replace(/^p_/, ""),
              chunkDoc: v.chunkDoc || docSnap.id,
              ...v,
            });
          }
        });
        prods.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
        setProductos(prods);
        setLoader(false);
      },
      (err) => {
        console.error("RT productos:", err);
        setProductos([]);
        setLoader(false);
      }
    );
    unsubsRef.current.push(unsubProductos);

    // --- Ventas (chunk docs con v_*) ---
    const unsubVentas = onSnapshot(
      collection(firestore, "ventas"),
      (snap) => {
        const allVentas = [];
        snap.docs.forEach((docSnapshot) => {
          const data = docSnapshot.data() || {};
          for (const [k, v] of Object.entries(data)) {
            if (!k.startsWith("v_") || !v) continue;
            const saleId = k; // ej: v_1695851112345
            allVentas.push({
              _id: saleId,
              id: saleId,
              chunkDoc: docSnapshot.id,
              ...v,
            });
          }
        });
        allVentas.sort(
          (a, b) =>
            toMs(b?.createdAt, b?.id || b?._id) -
            toMs(a?.createdAt, a?.id || a?._id)
        );
        setVentas(allVentas);
        setLoader(false);
      },
      (err) => {
        console.error("RT ventas:", err);
        setVentas([]);
        setLoader(false);
      }
    );
    unsubsRef.current.push(unsubVentas);

    // --- Presupuestos (chunk docs con b_*) ---
    const unsubPresupuestos = onSnapshot(
      collection(firestore, "presupuestos"),
      (snap) => {
        const list = [];
        snap.docs.forEach((docSnap) => {
          const data = docSnap.data() || {};
          for (const [k, v] of Object.entries(data)) {
            if (!k.startsWith("b_") || !v) continue;
            list.push({
              id: k, // ej: b_1695851112345
              chunkDoc: docSnap.id,
              ...v,
            });
          }
        });
        list.sort(
          (a, b) => toMs(b?.createdAt, b?.id) - toMs(a?.createdAt, a?.id)
        );
        setPresupuestos(list);
        setPresupuestosLoading(false);
      },
      (err) => {
        console.error("RT presupuestos:", err);
        setPresupuestos([]);
        setPresupuestosLoading(false);
      }
    );
    unsubsRef.current.push(unsubPresupuestos);

    // Cleanup en unmount
    return () => {
      unsubsRef.current.forEach((u) => {
        try {
          if (typeof u === "function") u();
        } catch {}
      });
      unsubsRef.current = [];
    };
  }, [firestore]);

  // ===== Helper local =====
  function toMs(ts, idFallback) {
    if (ts?.toDate) return ts.toDate().getTime(); // Firestore Timestamp
    if (ts instanceof Date) return ts.getTime(); // Date
    if (typeof ts?.seconds === "number") return ts.seconds * 1000; // {seconds,nanos}
    const n = Number(String(idFallback || "").replace(/^\D*_/, "")); // soporta v_ / b_
    return Number.isFinite(n) ? n : 0;
  }

  // ===== Compat: fetchers ahora no-op (ya estamos en RT) =====
  const fetchCategorias = async () => {
    console.info("[fetchCategorias] no-op: ya hay onSnapshot en tiempo real.");
  };
  const fetchProductos = async () => {
    console.info("[fetchProductos] no-op: ya hay onSnapshot en tiempo real.");
  };
  const fetchVentas = async () => {
    console.info("[fetchVentas] no-op: ya hay onSnapshot en tiempo real.");
  };
  const fetchPresupuestos = async () => {
    console.info(
      "[fetchPresupuestos] no-op: ya hay onSnapshot en tiempo real."
    );
  };

  // ===== Provider =====
  return (
    <ContextGeneral.Provider
      value={{
        // firebase
        auth,
        firestore,

        // sesión
        user,
        user1, // compat
        permisos,

        // ui
        loader,
        setLoader,

        // datos
        categorias,
        productos,
        ventas,
        egresos,
        presupuestos,
        presupuestosLoading,

        // setters
        setCategorias,
        setProductos,
        setVentas,
        setEgresos,
        setUser,
        setPermisos,
        setPresupuestos,

        // fetchers (compat)
        fetchCategorias,
        fetchProductos,
        fetchVentas,
        fetchPresupuestos,
      }}
    >
      {props.children}
    </ContextGeneral.Provider>
  );
}

export default Context;
