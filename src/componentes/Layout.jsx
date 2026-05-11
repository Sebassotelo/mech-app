import Head from "next/head";
import { Toaster } from "sonner";
import Loader from "./Loader";
import { useContext } from "react";
import ContextGeneral from "@/servicios/contextGeneral";

function Layout({ children }) {
  const context = useContext(ContextGeneral);

  return (
    <div style={{ display: "grid" }}>
      <Head>
        <title>Mecánico App</title>
        <meta
          name="description"
          content="Aplicación interna de gestión para mecánica y puntos de venta."
        />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      {context.loader && <Loader text="Cargando..." fullScreen={true} />}
      <Toaster position="top-center" />

      <div>{children}</div>
    </div>
  );
}

export default Layout;
