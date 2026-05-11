"use client";

import { useContext, useMemo, useState } from "react";
import {
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
} from "firebase/auth";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { useRouter } from "next/router";
import { toast } from "sonner";
import ContextGeneral from "@/servicios/contextGeneral";
import HelpHint from "@/componentes/HelpHint";

// Si el usuario existe en Auth pero no fue configurado en la app,
// queda sin acceso hasta que un admin lo habilite.
const PERMISOS_POR_DEFECTO = [];

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

export default function Login() {
  const { auth, firestore, user } = useContext(ContextGeneral);
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function ensureUserInFirestore(emailStr, firebaseUser) {
    if (!firestore || !emailStr) return;
    try {
      const rawEmail = String(emailStr || "").trim();
      const normalizedEmail = normalizeEmail(rawEmail);
      const userRef = doc(firestore, "usuarios", normalizedEmail);
      const legacyRef =
        rawEmail && rawEmail !== normalizedEmail
          ? doc(firestore, "usuarios", rawEmail)
          : null;
      const [snap, legacySnap] = await Promise.all([
        getDoc(userRef),
        legacyRef ? getDoc(legacyRef) : Promise.resolve(null),
      ]);
      const existingData = snap.exists()
        ? snap.data() || {}
        : legacySnap?.exists()
          ? legacySnap.data() || {}
          : {};

      if (!snap.exists()) {
        await setDoc(userRef, {
          email: normalizedEmail,
          uid: firebaseUser.uid,
          displayName: firebaseUser.displayName || existingData.displayName || "",
          photoURL: firebaseUser.photoURL || existingData.photoURL || "",
          permisos: Array.isArray(existingData.permisos)
            ? existingData.permisos
            : PERMISOS_POR_DEFECTO,
          activo:
            typeof existingData.activo === "boolean" ? existingData.activo : false,
          createdAt: existingData.createdAt || serverTimestamp(),
          lastLogin: serverTimestamp(),
        });
        console.log("Usuario creado en Firestore:", normalizedEmail);
      } else {
        await setDoc(
          userRef,
          {
            email: normalizedEmail,
            uid: firebaseUser.uid,
            displayName:
              firebaseUser.displayName || existingData.displayName || "",
            photoURL: firebaseUser.photoURL || existingData.photoURL || "",
            lastLogin: serverTimestamp(),
          },
          { merge: true },
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
    const normalizedEmail = normalizeEmail(email);
    try {
      const cred = await toast.promise(
        signInWithEmailAndPassword(auth, normalizedEmail, password),
        {
          loading: "Ingresando...",
          success: "¡Bienvenido!",
          error: "Correo o contraseña incorrectos",
        },
      );
      await ensureUserInFirestore(normalizedEmail, cred.user);
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
    const mail = normalizeEmail(email);
    if (!mail) return toast.error("Ingresá tu correo primero");
    try {
      await toast.promise(sendPasswordResetEmail(auth, mail), {
        loading: "Enviando enlace...",
        success: "Revisá tu correo para restablecer la contraseña",
        error: "No se pudo enviar el enlace",
      });
    } catch (e) {
      console.error(e);
    }
  }

  const hasUser = useMemo(() => !!user, [user]);

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#081821] text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(0,166,80,0.18),_transparent_30%),radial-gradient(circle_at_top_right,_rgba(238,114,3,0.22),_transparent_34%),radial-gradient(circle_at_bottom,_rgba(0,158,227,0.16),_transparent_38%)]" />
      <div className="absolute inset-0 opacity-[0.06] [background-image:linear-gradient(rgba(255,255,255,0.9)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.9)_1px,transparent_1px)] [background-size:36px_36px]" />

      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-6xl items-center justify-center px-4 py-8 sm:px-6 lg:px-8">
        <section className="w-full max-w-xl overflow-hidden rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(17,44,62,0.96),rgba(8,24,33,0.98))] shadow-[0_24px_80px_rgba(0,0,0,0.42)] backdrop-blur-xl">
            <div className="border-b border-white/10 px-5 py-5 sm:px-7 sm:py-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.24em] text-white/48">
                    Acceso al sistema
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <h2 className="text-2xl font-semibold tracking-tight">
                      {hasUser ? "Sesión activa" : "Iniciar sesión"}
                    </h2>
                    <HelpHint
                      title="Ingreso al sistema"
                      description="Este acceso es solo para operar la aplicación interna del negocio."
                      sections={[
                        {
                          label: "Qué es",
                          value:
                            "Es la pantalla para entrar al panel con un usuario habilitado por la empresa.",
                        },
                        {
                          label: "Qué hace",
                          value:
                            "Permite iniciar sesión, entrar al panel y recuperar la contraseña del usuario.",
                        },
                        {
                          label: "Quién lo ve",
                          value:
                            "Lo ve cualquier persona que tenga acceso a esta aplicación y un usuario activo.",
                        },
                        {
                          label: "Uso interno",
                          value:
                            "Sí. No es una pantalla pública para clientes finales.",
                        },
                      ]}
                    />
                  </div>
                  <p className="mt-2 text-sm leading-6 text-white/62">
                    {hasUser
                      ? "Entrá al panel o cerrá tu sesión actual."
                      : "Usá tu correo y contraseña para ingresar al panel interno."}
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-right">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-white/42">
                    Panel
                  </div>
                  <div className="mt-1 text-sm font-semibold text-white/90">
                    Mecánico App
                  </div>
                </div>
              </div>
            </div>

            <div className="px-5 py-6 sm:px-7 sm:py-7">
              {hasUser ? (
                <div className="space-y-6">
                  <div className="rounded-3xl border border-emerald-400/15 bg-emerald-500/10 p-5">
                    <div className="flex items-start gap-4">
                      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-400/15 text-lg font-semibold text-emerald-100">
                        {(user?.email || "U").slice(0, 1).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs uppercase tracking-[0.2em] text-emerald-100/65">
                          Usuario autenticado
                        </p>
                        <p className="mt-2 break-words text-base font-medium text-white">
                          {user?.email}
                        </p>
                        <p className="mt-2 text-sm text-white/65">
                          La sesión está iniciada. Podés entrar al panel o cerrar
                          la cuenta actual.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <button
                      onClick={() => router.push("/panel")}
                      className="flex h-12 w-full items-center justify-center rounded-2xl bg-gradient-to-r from-[#EE7203] to-[#FF3816] text-sm font-semibold text-white shadow-[0_14px_30px_rgba(255,88,22,0.25)] transition hover:brightness-110"
                    >
                      Ir al panel
                    </button>
                    <button
                      onClick={handleLogout}
                      className="flex h-12 w-full items-center justify-center rounded-2xl border border-white/12 bg-white/6 text-sm font-medium text-white/88 transition hover:bg-white/10"
                    >
                      Cerrar sesión
                    </button>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleLogin} className="space-y-5">
                  <div className="space-y-2">
                    <label htmlFor="email" className="text-xs font-medium uppercase tracking-[0.18em] text-white/52">
                      Correo
                    </label>
                    <input
                      id="email"
                      type="email"
                      className="auth-input"
                      placeholder="correo@empresa.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <label htmlFor="password" className="text-xs font-medium uppercase tracking-[0.18em] text-white/52">
                        Contraseña
                      </label>
                      <button
                        type="button"
                        onClick={() => setShowPass((s) => !s)}
                        className="text-[11px] font-medium text-white/56 transition hover:text-white"
                      >
                        {showPass ? "Ocultar" : "Mostrar"}
                      </button>
                  </div>
                    <input
                      id="password"
                      type={showPass ? "text" : "password"}
                      className="auth-input"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={submitting}
                    className="flex h-12 w-full items-center justify-center rounded-2xl bg-gradient-to-r from-[#EE7203] to-[#FF3816] text-sm font-semibold text-white shadow-[0_14px_30px_rgba(255,88,22,0.28)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-65"
                  >
                    {submitting ? "Ingresando..." : "Iniciar sesión"}
                  </button>
                </form>
              )}
            </div>

            <div className="border-t border-white/10 px-5 py-4 text-center text-[11px] text-white/45 sm:px-7">
              © {new Date().getFullYear()} Mecánico App
            </div>
        </section>
      </div>

      <style jsx global>{`
        .auth-input {
          width: 100%;
          border-radius: 1rem;
          border: 1px solid rgba(255, 255, 255, 0.1);
          background: rgba(7, 24, 34, 0.78);
          padding: 0.85rem 0.95rem;
          color: #fff;
          font-size: 0.95rem;
          outline: none;
          transition:
            border-color 160ms ease,
            box-shadow 160ms ease,
            background 160ms ease;
        }
        .auth-input::placeholder {
          color: rgba(255, 255, 255, 0.38);
        }
        .auth-input:focus {
          border-color: rgba(238, 114, 3, 0.55);
          box-shadow: 0 0 0 3px rgba(238, 114, 3, 0.18);
          background: rgba(7, 24, 34, 0.92);
        }
      `}</style>
    </div>
  );
}
