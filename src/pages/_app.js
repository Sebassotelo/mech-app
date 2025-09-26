import Layout from "@/componentes/Layout";
import Context from "@/servicios/context";
import "@/styles/globals.css";

export default function App({ Component, pageProps }) {
  return (
    <Context>
      <Layout>
        <Component {...pageProps} />{" "}
      </Layout>
    </Context>
  );
}
