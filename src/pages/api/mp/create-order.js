import crypto from "node:crypto";
import admin from "firebase-admin";
import { adminDb } from "@/servicios/firebaseAdmin";
import { requirePanelCaller } from "@/lib/server/mpAdmin";

const FieldValue = admin.firestore.FieldValue;
const Timestamp = admin.firestore.Timestamp;

function toAmount(value) {
  return Number(value || 0).toFixed(2);
}

function buildExternalReference(chunkDocId, ventaKey) {
  return `${String(chunkDocId || "").trim()}_${String(ventaKey || "").trim()}`;
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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { ventaKey, chunkDocId } = req.body || {};
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
  if (!total || ventaLines.length === 0) {
    return res.status(400).json({
      error: "La venta no tiene total o items válidos para cobrar",
    });
  }

  const amount = toAmount(total);
  const externalReference = buildExternalReference(chunkDocId, ventaKey);

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
      "X-Idempotency-Key": crypto.randomUUID(),
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
    const current = Array.isArray(currentVenta.payments)
      ? currentVenta.payments
      : [];

    const pendingEntry = {
      paymentId: payment?.id ? String(payment.id) : null,
      orderId: result?.id ? String(result.id) : null,
      status: "pending",
      statusDetail: payment?.status_detail || result?.status_detail || null,
      amount: Number(payment?.amount || total),
      currencyId: result?.currency || "ARS",
      paymentMethodId: payment?.payment_method_id || null,
      paymentTypeId: payment?.payment_type_id || null,
      mpOrderStatus: result?.status || "created",
      mpPaymentStatus: payment?.status || "created",
      createdAt: now,
      paidAt: null,
      updatedAt: now,
    };

    const idx = current.findIndex(
      (entry) =>
        (pendingEntry.paymentId && entry?.paymentId === pendingEntry.paymentId) ||
        (pendingEntry.orderId && entry?.orderId === pendingEntry.orderId),
    );

    const updatedPayments =
      idx >= 0
        ? current.map((entry, entryIdx) =>
            entryIdx === idx ? { ...entry, ...pendingEntry } : entry,
          )
        : [...current, pendingEntry];

    tx.update(ventaDocRef, {
      [`${ventaKey}.payments`]: updatedPayments,
      [`${ventaKey}.payment.status`]: "pending",
      [`${ventaKey}.payment.orderId`]: result?.id ? String(result.id) : null,
      [`${ventaKey}.payment.externalReference`]: externalReference,
      [`${ventaKey}.payment.mpOrderStatus`]: result?.status || "created",
      [`${ventaKey}.payment.mpPaymentStatus`]: payment?.status || "created",
      [`${ventaKey}.payment.updatedAt`]: FieldValue.serverTimestamp(),
      [`${ventaKey}.status`]: "payment_pending",
    });
  });

  return res.status(200).json({
    ok: true,
    orderId: result?.id ? String(result.id) : null,
    paymentId: payment?.id ? String(payment.id) : null,
  });
}

