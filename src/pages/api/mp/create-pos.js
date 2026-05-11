import {
  fetchMpJson,
  fetchMpUser,
  requireAdminCaller,
} from "@/lib/server/mpAdmin";

export const config = { api: { bodyParser: true } };

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res
      .status(405)
      .json({ code: "E_METHOD", error: "Method Not Allowed" });
  }

  const authResult = await requireAdminCaller(req);
  if (!authResult.ok) {
    return res.status(authResult.status).json(authResult.body);
  }

  try {
    const accessToken = process.env.MP_ACCESS_TOKEN;
    if (!accessToken) {
      return res
        .status(500)
        .json({ code: "E_NO_MP_TOKEN", error: "MP_ACCESS_TOKEN missing" });
    }

    const { name, externalStoreId, externalPosId, fixedAmount = false } =
      req.body || {};

    const safeName = String(name || "").trim();
    const safeExternalStoreId = String(externalStoreId || "").trim();
    const safeExternalPosId = String(externalPosId || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");

    if (!safeName || !safeExternalStoreId || !safeExternalPosId) {
      return res.status(400).json({
        code: "E_BAD_PAYLOAD",
        error:
          "name, externalStoreId y externalPosId son obligatorios; externalPosId debe ser alfanumérico",
      });
    }

    const pos = await fetchMpJson("https://api.mercadopago.com/pos", accessToken, {
      method: "POST",
      body: JSON.stringify({
        name: safeName,
        fixed_amount: !!fixedAmount,
        external_store_id: safeExternalStoreId,
        external_id: safeExternalPosId,
      }),
    });

    const user = await fetchMpUser(accessToken);
    return res.status(200).json({
      ok: true,
      account: {
        id: user?.id ? String(user.id) : null,
        nickname: user?.nickname || null,
        email: user?.email || null,
        siteId: user?.site_id || null,
      },
      pos: {
        id: pos?.id ? String(pos.id) : null,
        name: pos?.name || safeName,
        externalId: pos?.external_id || safeExternalPosId,
        storeId: pos?.store_id ? String(pos.store_id) : null,
        fixedAmount: !!pos?.fixed_amount,
        qr: {
          image: pos?.qr?.image || null,
          templateDocument: pos?.qr?.template_document || null,
          templateImage: pos?.qr?.template_image || null,
        },
      },
    });
  } catch (e) {
    console.error("[mp/create-pos] error:", e?.message || e);
    return res
      .status(500)
      .json({ code: "E_MP_CREATE_POS", error: e?.message || "MP create pos failed" });
  }
}
