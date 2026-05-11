import { adminAuth, adminDb } from "@/servicios/firebaseAdmin";

async function verifyCallerToken(req) {
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
    console.error("[mp] verifyIdToken:", e?.message || e);
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

  return { ok: true, decoded, callerEmail };
}

async function loadCallerProfile(callerEmail) {
  try {
    const snap = await adminDb.collection("usuarios").doc(callerEmail).get();
    const data = snap.exists ? snap.data() || {} : {};
    return {
      ok: true,
      profile: {
        exists: snap.exists,
        email: callerEmail,
        permisos: Array.isArray(data?.permisos) ? data.permisos : [],
        activo: data?.activo !== false,
      },
    };
  } catch (e) {
    console.error("[mp] read caller permisos:", e?.message || e);
    return {
      ok: false,
      status: 500,
      body: { code: "E_CALLER_LOOKUP", error: "Caller lookup failed" },
    };
  }
}

function locationToPerm(location) {
  const normalized = String(location || "").toLowerCase();
  if (normalized === "pv1") return 1;
  if (normalized === "pv2") return 2;
  if (normalized === "taller") return 3;
  return null;
}

export async function requireAdminCaller(req) {
  const authResult = await verifyCallerToken(req);
  if (!authResult.ok) return authResult;

  const profileResult = await loadCallerProfile(authResult.callerEmail);
  if (!profileResult.ok) return profileResult;

  const callerPerms = profileResult.profile.permisos;
  if (!callerPerms.includes(4)) {
    return {
      ok: false,
      status: 403,
      body: { code: "E_FORBIDDEN", error: "forbidden" },
    };
  }

  return { ...authResult, profile: profileResult.profile };
}

export async function requirePanelCaller(
  req,
  { allowedLocations = [], allowedPerms = [], allowAdmin = true } = {},
) {
  const authResult = await verifyCallerToken(req);
  if (!authResult.ok) return authResult;

  const profileResult = await loadCallerProfile(authResult.callerEmail);
  if (!profileResult.ok) return profileResult;

  const profile = profileResult.profile;
  if (!profile.exists || profile.activo === false) {
    return {
      ok: false,
      status: 403,
      body: { code: "E_FORBIDDEN", error: "forbidden" },
    };
  }

  const requiredPerms = new Set(allowedPerms);
  for (const location of allowedLocations) {
    const perm = locationToPerm(location);
    if (perm) requiredPerms.add(perm);
  }

  const callerPerms = profile.permisos;
  const hasAdmin = allowAdmin && callerPerms.includes(4);
  const hasAllowedPerm =
    requiredPerms.size === 0 ||
    Array.from(requiredPerms).some((perm) => callerPerms.includes(perm));

  if (!hasAdmin && !hasAllowedPerm) {
    return {
      ok: false,
      status: 403,
      body: { code: "E_FORBIDDEN", error: "forbidden" },
    };
  }

  return { ...authResult, profile };
}

export async function fetchMpUser(accessToken) {
  const res = await fetch("https://api.mercadopago.com/users/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    throw new Error(`MP users/me ${res.status}: ${await res.text()}`);
  }

  return res.json();
}

export async function fetchMpJson(url, accessToken, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    throw new Error(`MP API ${res.status}: ${await res.text()}`);
  }

  return res.json();
}

