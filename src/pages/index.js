import Image from "next/image";
import { Geist, Geist_Mono } from "next/font/google";
import Login from "@/componentes/Login";
import { useContext, useEffect } from "react";
import { useRouter } from "next/navigation";
import ContextGeneral from "@/servicios/contextGeneral";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export default function Home() {
  const router = useRouter();
  const { user } = useContext(ContextGeneral);

  useEffect(() => {
    if (user) {
      // router.push("/panel");
    }
  }, [user]);

  return (
    <div>
      {" "}
      <Login />
    </div>
  );
}
