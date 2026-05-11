import {
  fetchMPOrder,
  findVentaChunk,
  getNormalizedPaymentStatus,
  normalizeExternalReference,
  reconcileOrder,
} from "@/lib/server/mpOrderSync";
import { requirePanelCaller } from "@/lib/server/mpAdmin";

function getOrderStateLabel(order) {
  return String(order?.status || "").toLowerCase() || "unknown";
}

async function requireOrderAccess(req, order) {
  const { chunkDocId, ventaKey } = normalizeExternalReference(
    order?.external_reference,
  );

  if (!ventaKey) {
    return {
      ok: false,
      status: 400,
      body: {
        code: "E_BAD_REFERENCE",
        error: "La orden no tiene una referencia válida a una venta",
      },
    };
  }

  const ventaDocRef = await findVentaChunk(ventaKey, chunkDocId);
  if (!ventaDocRef) {
    return {
      ok: false,
      status: 404,
      body: {
        code: "E_SALE_NOT_FOUND",
        error: "No se encontró la venta asociada a la orden",
      },
    };
  }

  const ventaSnap = ventaDocRef ? await ventaDocRef.get() : null;
  const venta = ventaSnap?.data()?.[ventaKey] || null;

  if (!venta?.location) {
    return {
      ok: false,
      status: 409,
      body: {
        code: "E_SALE_LOCATION",
        error: "La venta asociada no tiene una sede válida",
      },
    };
  }

  return requirePanelCaller(req, {
    allowedLocations: [venta.location],
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { orderId } = req.body || {};
  if (!orderId) {
    return res.status(400).json({ error: "Falta orderId" });
  }

  const accessToken = process.env.MP_ACCESS_TOKEN;
  if (!accessToken) {
    return res.status(500).json({
      error: "Variable MP_ACCESS_TOKEN no configurada",
    });
  }

  try {
    const order = await fetchMPOrder(orderId, accessToken);
    const authResult = await requireOrderAccess(req, order);
    if (!authResult.ok) {
      return res.status(authResult.status).json(authResult.body);
    }

    const result = await reconcileOrder(order);

    return res.status(200).json({
      ok: true,
      status: getNormalizedPaymentStatus(order),
      orderStatus: getOrderStateLabel(order),
      ventaKey: result?.ventaKey || null,
      chunkDocId: result?.chunkDocId || null,
    });
  } catch (err) {
    console.error("[mp/reconcile-order] error:", err.message, err.stack);
    return res.status(500).json({
      error: err?.message || "No se pudo consultar el estado del pago",
    });
  }
}

