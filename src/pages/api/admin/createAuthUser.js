import { adminAuth, adminDb } from "@/servicios/firebaseAdmin";

// Asegura Node runtime (no Edge) y bodyParser habilitado
export const config = { api: { bodyParser: true } };

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res
      .status(405)
      .json({ code: "E_METHOD", error: "Method Not Allowed" });
  }

  try {
    // 1) ID Token del caller
    const authHeader = req.headers.authorization || "";
    const idToken = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;
    if (!idToken) {
      return res
        .status(401)
        .json({ code: "E_NO_TOKEN", error: "Missing bearer token" });
    }

    let decoded;
    try {
      decoded = await adminAuth.verifyIdToken(idToken);
    } catch (e) {
      console.error("[createAuthUser] verifyIdToken:", e?.message || e);
      return res.status(401).json({ code: "E_VERIFY", error: "Invalid token" });
    }

    const callerEmail = String(decoded.email || "").toLowerCase();
    if (!callerEmail) {
      return res
        .status(401)
        .json({ code: "E_NO_EMAIL", error: "Caller without email" });
    }

    // 2) Chequear permiso 4 del caller en Firestore
    let callerPerms = [];
    try {
      const snap = await adminDb.collection("usuarios").doc(callerEmail).get();
      callerPerms =
        snap.exists && Array.isArray(snap.data().permisos)
          ? snap.data().permisos
          : [];
    } catch (e) {
      console.error("[createAuthUser] read caller permisos:", e?.message || e);
      return res
        .status(500)
        .json({ code: "E_CALLER_LOOKUP", error: "Caller lookup failed" });
    }
    if (!callerPerms.includes(4)) {
      return res.status(403).json({ code: "E_FORBIDDEN", error: "forbidden" });
    }

    // 3) Validar payload
    const { email, password, displayName = "", activo = true } = req.body || {};
    const targetEmail = String(email || "")
      .trim()
      .toLowerCase();
    const targetPass = String(password || "").trim();

    if (!targetEmail || !targetPass) {
      return res
        .status(400)
        .json({ code: "E_BAD_PAYLOAD", error: "email/password required" });
    }

    // 4) Crear/obtener Auth user (NO toca Firestore aquí)
    try {
      let userRecord;
      try {
        userRecord = await adminAuth.getUserByEmail(targetEmail);
      } catch {
        userRecord = await adminAuth.createUser({
          email: targetEmail,
          password: targetPass,
          displayName: displayName || undefined,
          disabled: !activo,
        });
      }
      return res.status(200).json({ ok: true, uid: userRecord.uid });
    } catch (e) {
      console.error("[createAuthUser] create/get user:", e?.message || e);
      return res
        .status(500)
        .json({ code: "E_CREATE_AUTH", error: "Auth create failed" });
    }
  } catch (e) {
    console.error("[createAuthUser] internal:", e?.message || e);
    return res.status(500).json({ code: "E_INTERNAL", error: "internal" });
  }
}
