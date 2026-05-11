import { adminAuth, adminDb } from "@/servicios/firebaseAdmin";

export const config = { api: { bodyParser: true } };

async function requireAdminCaller(req) {
  const authHeader = req.headers.authorization || "";
  const idToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;

  if (!idToken) {
    return {
      ok: false,
      status: 401,
      body: { code: "E_NO_TOKEN", error: "Missing bearer token" },
    };
  }

  let decoded;
  try {
    decoded = await adminAuth.verifyIdToken(idToken);
  } catch (e) {
    console.error("[updateUserAccess] verifyIdToken:", e?.message || e);
    return {
      ok: false,
      status: 401,
      body: { code: "E_VERIFY", error: "Invalid token" },
    };
  }

  const callerEmail = String(decoded.email || "").toLowerCase();
  if (!callerEmail) {
    return {
      ok: false,
      status: 401,
      body: { code: "E_NO_EMAIL", error: "Caller without email" },
    };
  }

  const callerSnap = await adminDb.collection("usuarios").doc(callerEmail).get();
  const callerPerms =
    callerSnap.exists && Array.isArray(callerSnap.data()?.permisos)
      ? callerSnap.data().permisos
      : [];
  const callerActivo = callerSnap.exists ? callerSnap.data()?.activo !== false : false;

  if (!callerActivo || !callerPerms.includes(4)) {
    return {
      ok: false,
      status: 403,
      body: { code: "E_FORBIDDEN", error: "forbidden" },
    };
  }

  return { ok: true, callerEmail };
}

async function countActiveAdmins(excludeEmail, nextPerms, nextActivo) {
  const snap = await adminDb.collection("usuarios").get();
  let count = 0;

  snap.docs.forEach((docSnap) => {
    const email = String(docSnap.id || "").toLowerCase();
    const data = docSnap.data() || {};

    let perms = Array.isArray(data.permisos) ? data.permisos : [];
    let activo = data.activo !== false;

    if (email === excludeEmail) {
      perms = nextPerms;
      activo = nextActivo;
    }

    if (activo && perms.includes(4)) count += 1;
  });

  return count;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res
      .status(405)
      .json({ code: "E_METHOD", error: "Method Not Allowed" });
  }

  try {
    const authResult = await requireAdminCaller(req);
    if (!authResult.ok) {
      return res.status(authResult.status).json(authResult.body);
    }

    const {
      email,
      permisos = [],
      activo = true,
      displayName = "",
    } = req.body || {};

    const targetEmail = String(email || "").trim().toLowerCase();
    const safePerms = Array.isArray(permisos)
      ? [...new Set(permisos.filter((n) => [1, 2, 3, 4].includes(n)))]
      : [];
    const safeActivo = !!activo;
    const safeDisplayName = String(displayName || "").trim();

    if (!targetEmail) {
      return res
        .status(400)
        .json({ code: "E_BAD_PAYLOAD", error: "email required" });
    }

    const targetRef = adminDb.collection("usuarios").doc(targetEmail);
    const targetSnap = await targetRef.get();
    const targetData = targetSnap.exists ? targetSnap.data() || {} : {};

    const activeAdmins = await countActiveAdmins(
      targetEmail,
      safePerms,
      safeActivo,
    );
    if (activeAdmins < 1) {
      return res.status(409).json({
        code: "E_LAST_ADMIN",
        error: "Debe quedar al menos un usuario activo con permiso 4",
      });
    }

    let userRecord = null;
    try {
      userRecord = await adminAuth.getUserByEmail(targetEmail);
      await adminAuth.updateUser(userRecord.uid, {
        disabled: !safeActivo,
        displayName: safeDisplayName || userRecord.displayName || undefined,
      });
    } catch (e) {
      console.error("[updateUserAccess] auth lookup/update:", e?.message || e);
    }

    await targetRef.set(
      {
        email: targetEmail,
        uid: userRecord?.uid || targetData?.uid || null,
        displayName:
          safeDisplayName || targetData?.displayName || userRecord?.displayName || "",
        permisos: safePerms,
        activo: safeActivo,
        updatedAt: new Date(),
      },
      { merge: true },
    );

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("[updateUserAccess] internal:", e?.message || e);
    return res.status(500).json({ code: "E_INTERNAL", error: "internal" });
  }
}
