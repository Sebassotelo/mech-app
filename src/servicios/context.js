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

  const auth = getAuth(firebaseApp);
  const firestore = getFirestore(firebaseApp);
  const userDocUnsubRef = useRef(null);

  // Crear o actualizar usuario
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

  // Manejo de sesión
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
          }
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

  // RT de colecciones
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
      }
    );
    unsubsRef.current.push(unsubCategorias);

    // --- Productos ---
    const unsubProductos = onSnapshot(
      collection(firestore, "productos"),
      (snap) => {
        const prods = [];
        snap.docs.forEach((d) => {
          const data = d.data() || {};
          for (const [k, v] of Object.entries(data)) {
            if (k.startsWith("p_") && v) prods.push({ id: k, ...v });
          }
        });
        setProductos(prods);
        setLoader(false);
      }
    );
    unsubsRef.current.push(unsubProductos);

    // --- Ventas ---
    const unsubVentas = onSnapshot(collection(firestore, "ventas"), (snap) => {
      const arr = [];
      snap.docs.forEach((d) => {
        const data = d.data() || {};
        for (const [k, v] of Object.entries(data)) {
          if (k.startsWith("v_") && v) arr.push({ id: k, ...v });
        }
      });
      setVentas(arr);
      setLoader(false);
    });
    unsubsRef.current.push(unsubVentas);

    // --- Presupuestos ---
    const unsubPresupuestos = onSnapshot(
      collection(firestore, "presupuestos"),
      (snap) => {
        const list = [];
        snap.docs.forEach((d) => {
          const data = d.data() || {};
          for (const [k, v] of Object.entries(data)) {
            if (k.startsWith("b_") && v) list.push({ id: k, ...v });
          }
        });
        setPresupuestos(list);
        setPresupuestosLoading(false);
      }
    );
    unsubsRef.current.push(unsubPresupuestos);

    return () => {
      unsubsRef.current.forEach((u) => {
        try {
          if (typeof u === "function") u();
        } catch {}
      });
      unsubsRef.current = [];
    };
  }, [firestore]);

  // ===== Provider =====
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
        egresos,
        presupuestos,
        presupuestosLoading,
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
