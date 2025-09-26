import { useContext, useState } from "react";
import { signInWithEmailAndPassword, signOut } from "firebase/auth";
import { useRouter } from "next/navigation";
import ContextGeneral from "@/servicios/contextGeneral";

export default function Login() {
  const { auth, user, setUser } = useContext(ContextGeneral);
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");

    try {
      await signInWithEmailAndPassword(auth, email, password);
      router.push("/panel");
    } catch (err) {
      setError("Correo o contraseña incorrectos");
      console.error(err);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (err) {
      console.error("Error al cerrar sesión:", err);
    }
  };

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        {user ? (
          <>
            <h1 className="text-2xl font-semibold text-black text-center">
              ¡Bienvenido {user.email}!
            </h1>
            <button
              onClick={() => router.push("/panel")}
              className="w-full bg-black text-white py-2 rounded-lg hover:bg-gray-800 transition-colors"
            >
              Ir al Panel
            </button>
            <button
              onClick={handleLogout}
              className="w-full bg-red-600 text-white py-2 rounded-lg hover:bg-red-800 transition-colors mt-4"
            >
              Cerrar sesión
            </button>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-semibold text-black text-center">
              Iniciar sesión
            </h1>
            <form
              onSubmit={handleLogin}
              className="bg-white shadow-md rounded-xl px-6 py-8 space-y-4 border border-gray-200"
            >
              <div>
                <label
                  className="block text-sm text-black mb-1"
                  htmlFor="username"
                >
                  Usuario
                </label>
                <input
                  type="text"
                  id="username"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-black bg-white text-black"
                  placeholder="Tu usuario"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div>
                <label
                  className="block text-sm text-black mb-1"
                  htmlFor="password"
                >
                  Contraseña
                </label>
                <input
                  type="password"
                  id="password"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-black bg-white text-black"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>

              {error && (
                <p className="text-sm text-red-600 text-center">{error}</p>
              )}

              <button
                type="submit"
                className="w-full bg-black text-white py-2 rounded-lg hover:bg-gray-800 transition-colors"
              >
                Iniciar sesión
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
