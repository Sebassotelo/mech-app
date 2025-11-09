// ⚠️ Importar SOLO desde /pages/api/** (server). Nunca en componentes.
import * as admin from "firebase-admin";

function required(name, v) {
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

if (!admin.apps.length) {
  try {
    const projectId = required(
      "FIREBASE_PROJECT_ID",
      process.env.FIREBASE_PROJECT_ID
    );
    const clientEmail = required(
      "FIREBASE_CLIENT_EMAIL",
      process.env.FIREBASE_CLIENT_EMAIL
    );
    const privateKeyRaw = required(
      "FIREBASE_PRIVATE_KEY",
      process.env.FIREBASE_PRIVATE_KEY
    );
    const privateKey = privateKeyRaw.replace(/\\n/g, "\n");

    admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey,
      }),
    });
  } catch (e) {
    // Si falla acá, cualquier endpoint devolverá 500. Log explícito:
    console.error("[firebaseAdmin] init error:", e?.message || e);
    throw e;
  }
}

export const adminAuth = admin.auth();
export const adminDb = admin.firestore();
export default admin;
