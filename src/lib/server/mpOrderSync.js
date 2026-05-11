import crypto from "node:crypto";
import admin from "firebase-admin";
import { adminDb } from "@/servicios/firebaseAdmin";

const FieldValue = admin.firestore.FieldValue;
const Timestamp = admin.firestore.Timestamp;

export const APPROVED_STATUSES = new Set(["approved", "processed"]);
export const RELEASE_STATUSES = new Set(["canceled", "expired", "rejected"]);

export function normalizeExternalReference(externalReference) {
  const raw = String(externalReference || "").trim();
  const match = raw.match(/^([A-Za-z0-9]+)_(v_\d+)$/);

  if (match) {
    return { chunkDocId: match[1], ventaKey: match[2] };
  }

  if (/^v_\d+$/.test(raw)) {
    return { chunkDocId: null, ventaKey: raw };
  }

  return { chunkDocId: null, ventaKey: null };
}

export function getOrderPayment(order) {
  return order?.transactions?.payments?.[0] || {};
}

export function getNormalizedPaymentStatus(order) {
  const orderStatus = String(order?.status || "").toLowerCase();
  const paymentStatus = String(getOrderPayment(order)?.status || "").toLowerCase();

  if (
    APPROVED_STATUSES.has(orderStatus) ||
    APPROVED_STATUSES.has(paymentStatus)
  ) {
    return "approved";
  }

  if (
    RELEASE_STATUSES.has(orderStatus) ||
    RELEASE_STATUSES.has(paymentStatus)
  ) {
    return orderStatus === "expired" || paymentStatus === "expired"
      ? "expired"
      : "canceled";
  }

  if (paymentStatus === "rejected") return "rejected";
  if (orderStatus === "failed") return "rejected";
  if (orderStatus === "refunded") return "refunded";

  return "pending";
}

export function getVentaStatus(paymentStatus) {
  if (paymentStatus === "approved") return "paid";
  if (paymentStatus === "expired") return "payment_expired";
  if (paymentStatus === "canceled") return "payment_canceled";
  if (paymentStatus === "rejected") return "payment_rejected";
  if (paymentStatus === "refunded") return "refunded";
  return "payment_pending";
}

export async function fetchMPOrder(orderId, accessToken) {
  const token = accessToken || process.env.MP_ACCESS_TOKEN;
  const res = await fetch(`https://api.mercadopago.com/v1/orders/${orderId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw new Error(`MP API ${res.status}: ${await res.text()}`);
  }

  return res.json();
}

export async function cancelMPOrder(orderId, accessToken) {
  const token = accessToken || process.env.MP_ACCESS_TOKEN;
  const res = await fetch(`https://api.mercadopago.com/v1/orders/${orderId}/cancel`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Idempotency-Key": crypto.randomUUID(),
    },
  });

  if (!res.ok) {
    throw new Error(`MP API ${res.status}: ${await res.text()}`);
  }

  return res.json();
}

export async function findVentaChunk(ventaKey, chunkDocId) {
  if (chunkDocId) {
    const directRef = adminDb.doc(`ventas/${chunkDocId}`);
    const directSnap = await directRef.get();
    if (directSnap.exists && directSnap.data()?.[ventaKey]) {
      return directRef;
    }
  }

  const snap = await adminDb.collection("ventas").get();
  for (const chunkDoc of snap.docs) {
    if (chunkDoc.data()?.[ventaKey]) return chunkDoc.ref;
  }
  return null;
}

export function buildPaymentEntry(order) {
  const payment = getOrderPayment(order);
  const paymentStatus = getNormalizedPaymentStatus(order);
  const now = Timestamp.now();

  return {
    paymentId: payment?.id ? String(payment.id) : null,
    orderId: order?.id ? String(order.id) : null,
    status: paymentStatus,
    statusDetail: payment?.status_detail || order?.status_detail || null,
    amount: Number(payment?.amount || order?.total_amount || 0),
    currencyId: order?.currency || "ARS",
    paymentMethodId: payment?.payment_method_id || null,
    paymentTypeId: payment?.payment_type_id || null,
    mpOrderStatus: order?.status || null,
    mpPaymentStatus: payment?.status || null,
    paidAt: paymentStatus === "approved" ? now : null,
    updatedAt: now,
  };
}

export async function releaseReservedStock(tx, venta) {
  const stockField = venta?.location === "pv2" ? "stockPv2" : "stockPv1";
  const groups = {};

  for (const line of venta?.lines || []) {
    const chunkId = line?.chunkDoc;
    if (!chunkId || !line?.productId) continue;
    if (!groups[chunkId]) groups[chunkId] = [];
    groups[chunkId].push(line);
  }

  for (const [chunkId, chunkLines] of Object.entries(groups)) {
    const ref = adminDb.doc(`productos/${chunkId}`);
    const snap = await tx.get(ref);

    if (!snap.exists) continue;

    const data = snap.data() || {};
    const updates = {};

    for (const line of chunkLines) {
      const field = `p_${line.productId}`;
      const product = data[field];
      if (!product) continue;

      const current = parseInt(product?.[stockField] ?? 0, 10);
      const next = current + Number(line.qty || 0);
      updates[`${field}.${stockField}`] = next;
      updates[`${field}.updatedAt`] = FieldValue.serverTimestamp();
    }

    if (Object.keys(updates).length > 0) {
      tx.update(ref, updates);
    }
  }
}

export async function reconcileOrder(order) {
  const { chunkDocId, ventaKey } = normalizeExternalReference(
    order?.external_reference,
  );

  if (!ventaKey) {
    console.warn("[mpOrderSync] order sin external_reference valido");
    return { ok: false, reason: "missing_external_reference" };
  }

  const ventaDocRef = await findVentaChunk(ventaKey, chunkDocId);
  if (!ventaDocRef) {
    console.warn(`[mpOrderSync] Venta no encontrada: ${ventaKey}`);
    return { ok: false, reason: "sale_not_found", ventaKey, chunkDocId };
  }

  await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ventaDocRef);
    const docData = snap.data() || {};
    const venta = docData[ventaKey] || null;

    if (!venta) {
      console.warn(`[mpOrderSync] Venta vacia: ${ventaKey}`);
      return;
    }

    const paymentEntry = buildPaymentEntry(order);
    const paymentStatus = paymentEntry.status;
    const current = Array.isArray(venta.payments) ? venta.payments : [];

    const idx = current.findIndex(
      (entry) =>
        (paymentEntry.paymentId && entry?.paymentId === paymentEntry.paymentId) ||
        (paymentEntry.orderId && entry?.orderId === paymentEntry.orderId),
    );

    const updatedPayments =
      idx >= 0
        ? current.map((entry, entryIdx) =>
            entryIdx === idx ? { ...entry, ...paymentEntry } : entry,
          )
        : [...current, paymentEntry];

    const shouldReleaseStock =
      RELEASE_STATUSES.has(paymentStatus) &&
      venta?.stockReservationActive === true &&
      !venta?.stockReleasedAt;

    if (shouldReleaseStock) {
      await releaseReservedStock(tx, venta);
    }

    const updates = {
      [`${ventaKey}.payments`]: updatedPayments,
      [`${ventaKey}.payment.status`]: paymentStatus,
      [`${ventaKey}.payment.orderId`]: paymentEntry.orderId,
      [`${ventaKey}.payment.mpOrderStatus`]: paymentEntry.mpOrderStatus,
      [`${ventaKey}.payment.mpPaymentStatus`]: paymentEntry.mpPaymentStatus,
      [`${ventaKey}.payment.statusDetail`]: paymentEntry.statusDetail,
      [`${ventaKey}.payment.updatedAt`]: FieldValue.serverTimestamp(),
      [`${ventaKey}.status`]: getVentaStatus(paymentStatus),
      [`${ventaKey}.stockReservationActive`]:
        paymentStatus === "pending" ? true : false,
    };

    if (paymentStatus === "approved" && !venta?.paidAt) {
      updates[`${ventaKey}.paidAt`] = FieldValue.serverTimestamp();
      updates[`${ventaKey}.payment.paidAt`] = FieldValue.serverTimestamp();
    }

    if (shouldReleaseStock) {
      updates[`${ventaKey}.stockReleasedAt`] = FieldValue.serverTimestamp();
    }

    tx.update(ventaDocRef, updates);
  });

  return { ok: true, ventaKey, chunkDocId };
}
