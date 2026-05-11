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

    const {
      name,
      externalId,
      location = null,
      businessHours = null,
    } = req.body || {};

    const safeName = String(name || "").trim();
    const safeExternalId = String(externalId || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 60);
    const safeLocation = location && typeof location === "object"
      ? {
          street_name: String(location.street_name || "").trim(),
          street_number: String(location.street_number || "").trim(),
          city_name: String(location.city_name || "").trim(),
          state_name: String(location.state_name || "").trim(),
          latitude:
            location.latitude !== undefined && location.latitude !== null
              ? Number(location.latitude)
              : null,
          longitude:
            location.longitude !== undefined && location.longitude !== null
              ? Number(location.longitude)
              : null,
          reference: String(location.reference || "").trim(),
        }
      : null;

    if (!safeName || !safeExternalId) {
      return res.status(400).json({
        code: "E_BAD_PAYLOAD",
        error: "name y externalId alfanumérico son obligatorios",
      });
    }
    if (
      !safeLocation ||
      !safeLocation.street_name ||
      !safeLocation.street_number ||
      !safeLocation.city_name ||
      !safeLocation.state_name ||
      !Number.isFinite(safeLocation.latitude) ||
      !Number.isFinite(safeLocation.longitude)
    ) {
      return res.status(400).json({
        code: "E_BAD_LOCATION",
        error:
          "La ubicación es obligatoria: calle, número, ciudad, provincia, latitud y longitud",
      });
    }

    const user = await fetchMpUser(accessToken);
    const payload = {
      name: safeName,
      external_id: safeExternalId,
      location: safeLocation,
    };

    if (businessHours && typeof businessHours === "object") {
      payload.business_hours = businessHours;
    }

    const store = await fetchMpJson(
      `https://api.mercadopago.com/users/${user.id}/stores`,
      accessToken,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    );

    return res.status(200).json({
      ok: true,
      account: {
        id: user?.id ? String(user.id) : null,
        nickname: user?.nickname || null,
        email: user?.email || null,
        siteId: user?.site_id || null,
      },
      store: {
        id: store?.id ? String(store.id) : null,
        name: store?.name || safeName,
        externalId: store?.external_id || safeExternalId,
      },
    });
  } catch (e) {
    console.error("[mp/create-store] error:", e?.message || e);
    return res
      .status(500)
      .json({ code: "E_MP_CREATE_STORE", error: e?.message || "MP create store failed" });
  }
}
