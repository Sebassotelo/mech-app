import React, { useEffect, useState, useRef } from "react";
import ContextGeneral from "./contextGeneral";
import firebaseApp from "./firebase";

import { getAuth, onAuthStateChanged } from "firebase/auth";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
} from "firebase/firestore";

function Context(props) {
  const [loader, setLoader] = useState(null);

  const [user, setUser] = useState("");
  let user1 = "";

  const auth = getAuth(firebaseApp);
  const firestore = getFirestore(firebaseApp);

  const [categorias, setCategorias] = useState([]);
  const [productos, setProductos] = useState(null);
  const [ventas, setVentas] = useState([]);
  const [egresos, setEgresos] = useState([]);
  const [permisos, setPermisos] = useState(0);

  const verificarLogin = () => {
    onAuthStateChanged(auth, inspectorSesion);
  };

  const admins = ["saabtian@gmail.com", "agusmeza2812@gmail.com"];

  const inspectorSesion = (usuarioFirebase) => {
    //en caso de que haya seison iniciada
    if (usuarioFirebase) {
      setUser(usuarioFirebase);
      user1 = usuarioFirebase;

      if (admins.includes(usuarioFirebase.email)) {
        setPermisos(1);
      } else {
        setPermisos(0);
      }

      console.log("asdasdsadasdd", user);
    } else {
      //en caso de que haya seison iniciada
      setUser(null);
      user1 = null;
    }
  };

  const fetchCategorias = async () => {
    setLoader(true);
    const ref = collection(firestore, "categorias");
    const snapshot = await getDocs(ref);

    const categoriasArray = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    setCategorias(categoriasArray); // ← guarda todas las categorías

    console.log("Categorías:", categoriasArray);
    setLoader(false);
  };

  const fetchEgresos = async () => {
    setLoader(true);
    const ref = collection(firestore, "egresos");
    const snapshot = await getDocs(ref);
    let egresosArray = [];

    snapshot.docs.forEach((doc) => {
      const data = doc.data();
      const productosEnDoc = Object.entries(data).map(
        ([productoId, productoData]) => ({
          id: productoId,
          ...productoData,
        })
      );
      egresosArray = [...egresosArray, ...productosEnDoc];
    });

    setEgresos(egresosArray);
    console.log("EGERSO", egresosArray);
    setLoader(false);
  };

  const fetchProductos = async () => {
    setLoader(true);
    const ref = collection(firestore, "productos");
    const snapshot = await getDocs(ref);
    let productosArray = [];

    snapshot.docs.forEach((doc) => {
      const data = doc.data();
      const productosEnDoc = Object.entries(data).map(
        ([productoId, productoData]) => ({
          id: productoId,
          ...productoData,
        })
      );
      productosArray = [...productosArray, ...productosEnDoc];
    });

    // Ordenar productos por nombre alfabéticamente
    productosArray.sort((a, b) => a.nombre.localeCompare(b.nombre));

    setProductos(productosArray);
    setLoader(false);
  };

  const fetchVentas = async () => {
    try {
      setLoader(true);
      // Referencia a la colección "ventas"
      const ventasRef = collection(firestore, "ventas");

      // Obtener los documentos de la colección "ventas"
      const querySnapshot = await getDocs(ventasRef);

      // Array para almacenar todas las ventas
      let allVentas = [];

      // Recorrer cada documento en la colección "ventas"
      for (const docSnapshot of querySnapshot.docs) {
        // Obtener los datos del documento
        const ventasDocData = docSnapshot.data();

        // Extraer las ventas que están guardadas como campos dentro del documento
        // Los campos de cada venta tendrán su propio ID (como claves de los campos)
        const ventas = Object.keys(ventasDocData).map((key) => ({
          id: key, // El ID del campo (por ejemplo, "venta_12345")
          ...ventasDocData[key], // Los datos de la venta
        }));

        // Agregar todas las ventas al array general
        allVentas = [...allVentas, ...ventas];
      }

      setVentas(allVentas); // Establecer el estado con todas las ventas combinadas
      console.log("Todas las ventas:", allVentas);
      setLoader(false);
    } catch (error) {
      console.error("Error al obtener las ventas:", error);
      setVentas([]); // En caso de error, establecer un array vacío
      setLoader(false);
    }
  };

  useEffect(() => {
    verificarLogin();
  }, [user, user1]);

  return (
    <ContextGeneral.Provider
      value={{
        auth: auth,
        firestore: firestore,
        categorias: categorias,
        productos: productos,
        ventas: ventas,
        user: user,
        user1: user1,
        loader: loader,
        permisos: permisos,
        egresos: egresos,
        setEgresos,
        setLoader,
        setVentas,
        fetchVentas,
        setProductos,
        setCategorias,
        fetchCategorias,
        fetchProductos,
        fetchEgresos,
        setUser,
        setPermisos,
      }}
    >
      {props.children}
    </ContextGeneral.Provider>
  );
}

export default Context;
