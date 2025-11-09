"use client";

import { useContext, useEffect, useMemo, useState } from "react";
import {
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
} from "firebase/auth";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import ContextGeneral from "@/servicios/contextGeneral";

// 🔧 permisos por defecto si el usuario no existe aún
const PERMISOS_POR_DEFECTO = [1]; // Ej: PV1

// 🔧 semilla opcional (solo si se crea el usuario por primera vez)
const PERMISOS_SEMILLA = {
  "saabtian@gmail.com": [1, 2, 3, 4],
  "agusmeza2812@gmail.com": [1, 2, 3, 4],
};

export default function Login() {
  const { auth, firestore, user } = useContext(ContextGeneral);
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Crear o actualizar usuario en Firestore
  async function ensureUserInFirestore(emailStr, firebaseUser) {
    if (!firestore || !emailStr) return;
    try {
      const userRef = doc(firestore, "usuarios", emailStr);
      const snap = await getDoc(userRef);

      if (!snap.exists()) {
        const permisosInicial =
          PERMISOS_SEMILLA[emailStr] ?? PERMISOS_POR_DEFECTO;

        await setDoc(userRef, {
          email: emailStr,
          uid: firebaseUser.uid,
          displayName: firebaseUser.displayName || "",
          photoURL: firebaseUser.photoURL || "",
          permisos: permisosInicial, // ← array [1, 2, 3...]
          activo: true,
          createdAt: serverTimestamp(),
          lastLogin: serverTimestamp(),
        });
        console.log("Usuario creado en Firestore:", emailStr);
      } else {
        await setDoc(
          userRef,
          {
            lastLogin: serverTimestamp(),
          },
          { merge: true }
        );
      }
    } catch (err) {
      console.error("Error ensureUserInFirestore:", err);
    }
  }

  async function handleLogin(e) {
    e.preventDefault();
    if (!auth || !firestore) return toast.error("Firebase no disponible");
    setSubmitting(true);
    try {
      const cred = await toast.promise(
        signInWithEmailAndPassword(auth, email.trim(), password),
        {
          loading: "Ingresando…",
          success: "¡Bienvenido!",
          error: "Correo o contraseña incorrectos",
        }
      );
      await ensureUserInFirestore(email.trim(), cred.user);
    } catch (err) {
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLogout() {
    if (!auth) return;
    try {
      await signOut(auth);
      toast.success("Sesión cerrada");
    } catch (err) {
      console.error(err);
      toast.error("No se pudo cerrar sesión");
    }
  }

  async function handleResetPass() {
    if (!auth) return toast.error("Auth no disponible");
    const mail = email.trim();
    if (!mail) return toast.error("Ingresá tu correo primero");
    try {
      await toast.promise(sendPasswordResetEmail(auth, mail), {
        loading: "Enviando enlace…",
        success: "Revisá tu correo para restablecer la contraseña",
        error: "No se pudo enviar el enlace",
      });
    } catch (e) {
      console.error(e);
    }
  }

  const hasUser = useMemo(() => !!user, [user]);

  return (
    <div className="min-h-screen w-full overflow-x-clip bg-[#0B1E29] relative">
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          background:
            "radial-gradient(60% 60% at 100% 0%, #EE720322 0%, transparent 60%), radial-gradient(50% 50% at 0% 100%, #FF381622 0%, transparent 60%)",
        }}
      />
      <div className="relative z-10 flex min-h-screen items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="rounded-2xl border border-white/10 bg-[#112C3E]/80 backdrop-blur shadow-xl p-5 sm:p-6">
            {hasUser ? (
              <div className="space-y-4">
                <p className="text-center text-sm text-white/70 break-words">
                  Sesión iniciada como{" "}
                  <span className="text-white font-medium">{user?.email}</span>
                </p>
                <button
                  onClick={() => router.push("/panel")}
                  className="w-full h-10 rounded-lg text-sm font-medium bg-gradient-to-r from-[#EE7203] to-[#FF3816] hover:opacity-95 transition"
                >
                  Ir al Panel
                </button>
                <button
                  onClick={handleLogout}
                  className="w-full h-10 rounded-lg text-sm bg-white/10 hover:bg-white/15 transition"
                >
                  Cerrar sesión
                </button>
              </div>
            ) : (
              <form onSubmit={handleLogin} className="space-y-3">
                <div className="space-y-1">
                  <label htmlFor="email" className="text-xs text-white/70">
                    Correo
                  </label>
                  <input
                    id="email"
                    type="email"
                    className="inp"
                    placeholder="correo@tu-taller.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label htmlFor="password" className="text-xs text-white/70">
                      Contraseña
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowPass((s) => !s)}
                      className="text-[11px] text-white/60 hover:text-white"
                    >
                      {showPass ? "Ocultar" : "Mostrar"}
                    </button>
                  </div>
                  <input
                    id="password"
                    type={showPass ? "text" : "password"}
                    className="inp"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-white/50">
                    Acceso para colaboradores
                  </span>
                  <button
                    type="button"
                    onClick={handleResetPass}
                    className="text-[11px] text-[#EE7203] hover:text-[#ff9660]"
                  >
                    Olvidé mi contraseña
                  </button>
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full h-10 rounded-lg text-sm font-medium bg-gradient-to-r from-[#EE7203] to-[#FF3816] hover:opacity-95 disabled:opacity-60 transition"
                >
                  {submitting ? "Ingresando…" : "Iniciar sesión"}
                </button>
              </form>
            )}
          </div>

          <div className="mt-3 text-center text-[11px] text-white/50">
            © {new Date().getFullYear()} Mecánico App
          </div>
        </div>
      </div>

      <style jsx global>{`
        .inp {
          width: 100%;
          border-radius: 0.75rem;
          background: #0c212d;
          border: 1px solid rgba(255, 255, 255, 0.1);
          padding: 0.6rem 0.75rem;
          color: white;
          font-size: 0.95rem;
        }
        .inp::placeholder {
          color: rgba(255, 255, 255, 0.45);
        }
        .inp:focus {
          box-shadow: 0 0 0 2px rgba(238, 114, 3, 0.55);
        }
      `}</style>
    </div>
  );
}
