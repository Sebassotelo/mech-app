import {
  cancelMPOrder,
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
  const ventaDocRef = await findVentaChunk(ventaKey, chunkDocId);
  const ventaSnap = ventaDocRef ? await ventaDocRef.get() : null;
  const venta = ventaSnap?.data()?.[ventaKey] || null;

  return requirePanelCaller(req, {
    allowedLocations: venta?.location ? [venta.location] : [],
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
    const currentOrder = await fetchMPOrder(orderId, accessToken);
    const authResult = await requireOrderAccess(req, currentOrder);
    if (!authResult.ok) {
      return res.status(authResult.status).json(authResult.body);
    }

    const currentState = getOrderStateLabel(currentOrder);
    const currentPaymentStatus = getNormalizedPaymentStatus(currentOrder);

    if (currentPaymentStatus === "approved") {
      await reconcileOrder(currentOrder);
      return res.status(409).json({
        error: "La venta ya fue pagada y no se puede cancelar.",
        status: currentPaymentStatus,
        orderStatus: currentState,
      });
    }

    if (currentState === "created") {
      const canceledOrder = await cancelMPOrder(orderId, accessToken);
      await reconcileOrder(canceledOrder);
      return res.status(200).json({
        ok: true,
        status: getNormalizedPaymentStatus(canceledOrder),
        orderStatus: getOrderStateLabel(canceledOrder),
      });
    }

    await reconcileOrder(currentOrder);

    if (currentPaymentStatus === "canceled" || currentPaymentStatus === "expired") {
      return res.status(200).json({
        ok: true,
        status: currentPaymentStatus,
        orderStatus: currentState,
      });
    }

    return res.status(409).json({
      error:
        "Mercado Pago no permite cancelar esta venta en el estado actual. Revisá si el cliente ya está pagando desde su app.",
      status: currentPaymentStatus,
      orderStatus: currentState,
    });
  } catch (err) {
    console.error("[mp/cancel-order] error:", err.message, err.stack);
    return res.status(500).json({
      error: err?.message || "No se pudo cancelar la venta en Mercado Pago",
    });
  }
}

