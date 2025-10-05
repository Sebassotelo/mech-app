// /src/servicios/context.jsx
import React, { useEffect, useState } from "react";
import ContextGeneral from "./contextGeneral";
import firebaseApp from "./firebase";

import { getAuth, onAuthStateChanged } from "firebase/auth";
import { getFirestore, collection, getDocs } from "firebase/firestore";

function Context(props) {
  // ===== Estado base =====
  const [loader, setLoader] = useState(false);

  const [user, setUser] = useState(null);
  const [user1, setUser1] = useState(null); // compat con código existente
  const [permisos, setPermisos] = useState(0); // 1 = admin, 0 = común

  const [categorias, setCategorias] = useState([]);
  const [productos, setProductos] = useState([]); // flatten p_* de /productos
  const [ventas, setVentas] = useState([]); // flatten v_* de /ventas/001,002...
  const [egresos, setEgresos] = useState([]);

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

  // ===== Fetch: Categorías =====
  const fetchCategorias = async () => {
    setLoader(true);
    try {
      const ref = collection(firestore, "categorias");
      const snapshot = await getDocs(ref);

      const categoriasArray = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      setCategorias(categoriasArray);
    } catch (err) {
      console.error("Error al traer categorías:", err);
      setCategorias([]);
    } finally {
      setLoader(false);
    }
  };

  // ===== Fetch: Productos (flatten p_*) =====
  const fetchProductos = async () => {
    setLoader(true);
    try {
      const ref = collection(firestore, "productos");
      const snapshot = await getDocs(ref);

      const prods = [];
      snapshot.docs.forEach((docSnap) => {
        const data = docSnap.data() || {};
        Object.entries(data).forEach(([key, val]) => {
          if (!key.startsWith("p_") || !val) return;
          prods.push({
            id: val.id || key.replace(/^p_/, ""),
            chunkDoc: val.chunkDoc || docSnap.id,
            ...val,
          });
        });
      });

      prods.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
      setProductos(prods);
    } catch (err) {
      console.error("Error al traer productos:", err);
      setProductos([]);
    } finally {
      setLoader(false);
    }
  };

  // ===== Fetch: Ventas (flatten v_* de /ventas/001,002...) =====
  const fetchVentas = async () => {
    setLoader(true);
    try {
      const ventasRef = collection(firestore, "ventas");
      const querySnapshot = await getDocs(ventasRef);

      const allVentas = [];
      querySnapshot.docs.forEach((docSnapshot) => {
        const data = docSnapshot.data() || {};
        Object.entries(data).forEach(([key, val]) => {
          if (!key.startsWith("v_") || !val) return;
          // Compatibilidad: exponemos _id y id con el mismo valor
          const saleId = key; // ej: v_1695851112345
          allVentas.push({
            _id: saleId,
            id: saleId,
            chunkDoc: docSnapshot.id, // ej: 001, 002
            ...val, // { location, lines[], total, createdAt, status?, createdByEmail?, ... }
          });
        });
      });

      // Ordenar: más recientes primero (por createdAt o por id numérico)
      allVentas.sort(
        (a, b) =>
          toMs(b?.createdAt, b?.id || b?._id) -
          toMs(a?.createdAt, a?.id || a?._id)
      );

      setVentas(allVentas);
    } catch (error) {
      console.error("Error al obtener las ventas:", error);
      setVentas([]);
    } finally {
      setLoader(false);
    }
  };

  // ===== Helper local =====
  function toMs(ts, idFallback) {
    if (ts?.toDate) return ts.toDate().getTime(); // Firestore Timestamp
    if (ts instanceof Date) return ts.getTime(); // Date
    if (typeof ts?.seconds === "number") return ts.seconds * 1000; // {seconds,nanos}
    const n = Number(String(idFallback || "").replace(/^v_/, ""));
    return Number.isFinite(n) ? n : 0;
  }

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

        // setters
        setCategorias,
        setProductos,
        setVentas,
        setEgresos,
        setUser,
        setPermisos,

        // fetchers
        fetchCategorias,
        fetchProductos,
        fetchVentas,
      }}
    >
      {props.children}
    </ContextGeneral.Provider>
  );
}

export default Context;
