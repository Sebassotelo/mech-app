// /pages/api/mp/create-preference.js
export default function handler(req, res) {
  // Feature deshabilitado por ahora: no usamos firebase-admin ni MP.
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  return res.status(501).json({
    error: "Mercado Pago deshabilitado",
    preferenceId: null,
    init_point: null,
    qr_url: null,
    status: "not_started",
  });
}
