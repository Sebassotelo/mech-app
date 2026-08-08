import admin from "firebase-admin";
import { adminDb } from "@/servicios/firebaseAdmin";
import { requirePanelCaller } from "@/lib/server/mpAdmin";
import {
  buildExternalReference,
  computeVentaPaymentSummary,
  getVentaStatus,
} from "@/lib/server/mpOrderSync";

const FieldValue = admin.firestore.FieldValue;
const Timestamp = admin.firestore.Timestamp;

function toAmount(value) {
  return Number(value || 0).toFixed(2);
}

function buildDescription(lines = []) {
  return lines
    .map((line) => `${line.qty}x ${line.name}`)
    .join(", ")
    .slice(0, 150);
}

function getLocationConfig(configSnap, venta) {
  const location = String(venta?.location || "").toLowerCase();
  return configSnap.data()?.locations?.[location] || {};
}

function resolveExternalPosId(locationConfig) {
  const configuredPosId = locationConfig?.pos?.externalId || null;
  if (configuredPosId) return configuredPosId;
  return process.env.MP_POS_ID || null;
}

function normalizeMethod(method) {
  const value = String(method || "").trim().toLowerCase();
  return value === "mercadopago" ? "mercadago" : value;
}

function isMercadoPagoMethod(method) {
  return normalizeMethod(method) === "mercadago";
}

function normalizeStatus(status) {
  return String(status || "").trim().toLowerCase();
}

function isActivePaymentStatus(status) {
  return ["created", "pending", "preparing"].includes(normalizeStatus(status));
}

function findExistingMercadoPagoPayment(payments = []) {
  return [...payments]
    .reverse()
    .find((entry) => {
      const provider = String(entry?.provider || "").toLowerCase();
      return provider === "mercadopago" || isMercadoPagoMethod(entry?.method);
    });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { ventaKey, chunkDocId, splitId } = req.body || {};
  if (!ventaKey || !chunkDocId) {
    return res.status(400).json({
      error: "Faltan parámetros: ventaKey, chunkDocId",
    });
  }

  const accessToken = process.env.MP_ACCESS_TOKEN;
  if (!accessToken) {
    return res.status(500).json({
      error: "Variable MP_ACCESS_TOKEN no configurada",
    });
  }

  const ventaDocRef = adminDb.doc(`ventas/${chunkDocId}`);
  const ventaDocSnap = await ventaDocRef.get();
  const venta = ventaDocSnap.data()?.[ventaKey] || null;

  if (!venta) {
    return res.status(404).json({ error: "Venta no encontrada" });
  }

  const authResult = await requirePanelCaller(req, {
    allowedLocations: [venta?.location],
  });
  if (!authResult.ok) {
    return res.status(authResult.status).json(authResult.body);
  }

  const configSnap = await adminDb.doc("config/mercadopago").get();
  const locationConfig = getLocationConfig(configSnap, venta);
  const externalPosId = resolveExternalPosId(locationConfig);

  if (!externalPosId) {
    return res.status(500).json({
      error: "No hay caja de Mercado Pago configurada para esta sede",
    });
  }

  const ventaLines = Array.isArray(venta?.lines) ? venta.lines : [];
  const total = Number(venta?.totals?.total || 0);
  const currentBreakdown = Array.isArray(venta?.paymentBreakdown)
    ? venta.paymentBreakdown
    : [];
  const targetSplit = splitId
    ? currentBreakdown.find((entry) => String(entry?.id || "") === String(splitId))
    : null;
  const chargeAmount = splitId ? Number(targetSplit?.amount || 0) : total;

  if (splitId) {
    if (!targetSplit) {
      return res.status(404).json({
        error: "No se encontró el tramo de Mercado Pago para esta venta",
      });
    }

    if (!isMercadoPagoMethod(targetSplit?.method)) {
      return res.status(400).json({
        error: "El tramo seleccionado no corresponde a Mercado Pago",
      });
    }

    if (!isActivePaymentStatus(targetSplit?.status)) {
      return res.status(409).json({
        error: "El tramo de Mercado Pago no está pendiente de cobro",
      });
    }

    if (targetSplit?.orderId) {
      return res.status(200).json({
        ok: true,
        reused: true,
        orderId: String(targetSplit.orderId),
        paymentId: targetSplit?.paymentId ? String(targetSplit.paymentId) : null,
        amount: chargeAmount,
      });
    }
  } else {
    const existingPayment =
      findExistingMercadoPagoPayment(venta?.payments || []) ||
      (venta?.payment?.orderId &&
      (String(venta?.payment?.provider || "").toLowerCase() === "mercadopago" ||
        isMercadoPagoMethod(venta?.payment?.method))
        ? venta.payment
        : null);
    const existingStatus = normalizeStatus(
      existingPayment?.status || venta?.payment?.status,
    );

    if (existingPayment?.orderId && isActivePaymentStatus(existingStatus)) {
      return res.status(200).json({
        ok: true,
        reused: true,
        orderId: String(existingPayment.orderId),
        paymentId: existingPayment?.paymentId
          ? String(existingPayment.paymentId)
          : null,
        amount: Number(existingPayment?.amount || total),
      });
    }

    if (existingPayment?.orderId && existingStatus === "approved") {
      return res.status(409).json({
        error: "La venta ya tiene un pago de Mercado Pago aprobado",
      });
    }
  }

  if (!chargeAmount || ventaLines.length === 0) {
    return res.status(400).json({
      error: "La venta no tiene total o items válidos para cobrar",
    });
  }

  const amount = toAmount(chargeAmount);
  const externalReference = buildExternalReference(chunkDocId, ventaKey, splitId);

  const orderBody = {
    type: "qr",
    total_amount: amount,
    description: buildDescription(ventaLines),
    external_reference: externalReference,
    expiration_time: process.env.MP_QR_EXPIRATION_TIME || "PT15M",
    config: {
      qr: {
        external_pos_id: externalPosId,
        mode: "static",
      },
    },
    transactions: {
      payments: [{ amount }],
    },
    items: ventaLines.map((line) => ({
      title: String(line.name || "Producto").slice(0, 100),
      unit_price: toAmount(line.unitPrice),
      quantity: Number(line.qty || 0),
      unit_measure: "unit",
      external_code: String(line.sku || line.productId || "").slice(0, 100),
    })),
  };

  const mpRes = await fetch("https://api.mercadopago.com/v1/orders", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-Idempotency-Key": `create-order-${externalReference}`,
    },
    body: JSON.stringify(orderBody),
  });

  if (!mpRes.ok) {
    const errText = await mpRes.text();
    console.error("[create-order] Error MP:", errText);
    return res.status(500).json({ error: `MP error: ${errText}` });
  }

  const result = await mpRes.json();
  const payment = result?.transactions?.payments?.[0] || {};
  const now = Timestamp.now();

  await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ventaDocRef);
    const docData = snap.data() || {};
    const currentVenta = docData[ventaKey] || {};
    const currentPayments = Array.isArray(currentVenta.payments)
      ? currentVenta.payments
      : [];
    const liveBreakdown = Array.isArray(currentVenta.paymentBreakdown)
      ? currentVenta.paymentBreakdown
      : [];

    const pendingEntry = {
      paymentId: payment?.id ? String(payment.id) : null,
      orderId: result?.id ? String(result.id) : null,
      status: "pending",
      statusDetail: payment?.status_detail || result?.status_detail || null,
      amount: Number(payment?.amount || chargeAmount),
      currencyId: result?.currency || "ARS",
      method: "mercadago",
      provider: "mercadopago",
      splitId: splitId || null,
      paymentMethodId: payment?.payment_method_id || null,
      paymentTypeId: payment?.payment_type_id || null,
      mpOrderStatus: result?.status || "created",
      mpPaymentStatus: payment?.status || "created",
      createdAt: now,
      paidAt: null,
      updatedAt: now,
    };

    const existingIndex = currentPayments.findIndex(
      (entry) =>
        (pendingEntry.paymentId && entry?.paymentId === pendingEntry.paymentId) ||
        (pendingEntry.orderId && entry?.orderId === pendingEntry.orderId),
    );

    const updatedPayments =
      existingIndex >= 0
        ? currentPayments.map((entry, entryIdx) =>
            entryIdx === existingIndex ? { ...entry, ...pendingEntry } : entry,
          )
        : [...currentPayments, pendingEntry];

    let updatedBreakdown = liveBreakdown;
    if (splitId) {
      updatedBreakdown = liveBreakdown.map((entry) =>
        String(entry?.id || "") === String(splitId)
          ? {
              ...entry,
              method: "mercadago",
              provider: "mercadopago",
              status: "pending",
              orderId: pendingEntry.orderId,
              paymentId: pendingEntry.paymentId,
              paymentMethodId: pendingEntry.paymentMethodId,
              paymentTypeId: pendingEntry.paymentTypeId,
              statusDetail: pendingEntry.statusDetail,
              mpOrderStatus: pendingEntry.mpOrderStatus,
              mpPaymentStatus: pendingEntry.mpPaymentStatus,
              updatedAt: now,
            }
          : entry,
      );
    }

    const paymentSummary = computeVentaPaymentSummary({
      ...currentVenta,
      payments: updatedPayments,
      paymentBreakdown: updatedBreakdown,
    });

    tx.update(ventaDocRef, {
      [`${ventaKey}.payments`]: updatedPayments,
      [`${ventaKey}.paymentBreakdown`]: updatedBreakdown,
      [`${ventaKey}.payment.method`]: paymentSummary.method,
      [`${ventaKey}.payment.provider`]: paymentSummary.provider,
      [`${ventaKey}.payment.status`]: paymentSummary.status,
      [`${ventaKey}.payment.approvedAmount`]: paymentSummary.approvedAmount,
      [`${ventaKey}.payment.pendingAmount`]: paymentSummary.pendingAmount,
      [`${ventaKey}.payment.totalAmount`]: paymentSummary.totalAmount,
      [`${ventaKey}.payment.splitMode`]: paymentSummary.splitMode,
      [`${ventaKey}.payment.methods`]: paymentSummary.methods,
      [`${ventaKey}.payment.orderId`]: pendingEntry.orderId,
      [`${ventaKey}.payment.paymentId`]: pendingEntry.paymentId,
      [`${ventaKey}.payment.externalReference`]: externalReference,
      [`${ventaKey}.payment.mpOrderStatus`]: pendingEntry.mpOrderStatus,
      [`${ventaKey}.payment.mpPaymentStatus`]: pendingEntry.mpPaymentStatus,
      [`${ventaKey}.payment.statusDetail`]: pendingEntry.statusDetail,
      [`${ventaKey}.payment.updatedAt`]: FieldValue.serverTimestamp(),
      [`${ventaKey}.status`]: getVentaStatus(paymentSummary.status),
      [`${ventaKey}.stockReservationActive`]: paymentSummary.pendingAmount > 0,
    });
  });

  return res.status(200).json({
    ok: true,
    orderId: result?.id ? String(result.id) : null,
    paymentId: payment?.id ? String(payment.id) : null,
    amount: chargeAmount,
  });
}
