import crypto from "node:crypto";
import admin from "firebase-admin";
import { adminDb } from "@/servicios/firebaseAdmin";

const FieldValue = admin.firestore.FieldValue;
const Timestamp = admin.firestore.Timestamp;

export const APPROVED_STATUSES = new Set(["approved", "processed"]);
export const RELEASE_STATUSES = new Set(["canceled", "expired", "rejected"]);
export const PENDING_STATUSES = new Set(["pending", "preparing"]);

function normalizeMethod(method) {
  const value = String(method || "").trim().toLowerCase();
  return value === "mercadopago" ? "mercadago" : value;
}

function isMercadoPagoMethod(method) {
  return normalizeMethod(method) === "mercadago";
}

export function normalizeExternalReference(externalReference) {
  const raw = String(externalReference || "").trim();
  const match = raw.match(/^([A-Za-z0-9]+)_(v_\d+)(?:_(.+))?$/);

  if (match) {
    return {
      chunkDocId: match[1],
      ventaKey: match[2],
      splitId: match[3] || null,
    };
  }

  if (/^v_\d+$/.test(raw)) {
    return { chunkDocId: null, ventaKey: raw, splitId: null };
  }

  return { chunkDocId: null, ventaKey: null, splitId: null };
}

export function buildExternalReference(chunkDocId, ventaKey, splitId = "") {
  const base = `${String(chunkDocId || "").trim()}_${String(ventaKey || "").trim()}`;
  return splitId ? `${base}_${String(splitId).trim()}` : base;
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

  if (paymentStatus === "rejected" || orderStatus === "rejected") {
    return "rejected";
  }
  if (orderStatus === "failed") return "rejected";
  if (orderStatus === "refunded") return "refunded";

  if (
    RELEASE_STATUSES.has(orderStatus) ||
    RELEASE_STATUSES.has(paymentStatus)
  ) {
    return orderStatus === "expired" || paymentStatus === "expired"
      ? "expired"
      : "canceled";
  }

  return "pending";
}

export function getVentaStatus(paymentStatus) {
  if (paymentStatus === "approved") return "paid";
  if (paymentStatus === "partial_pending") return "partial_pending";
  if (paymentStatus === "partial_canceled") return "partial_canceled";
  if (paymentStatus === "partial_expired") return "partial_expired";
  if (paymentStatus === "partial_rejected") return "partial_rejected";
  if (paymentStatus === "partial_error") return "partial_error";
  if (paymentStatus === "expired") return "payment_expired";
  if (paymentStatus === "canceled") return "payment_canceled";
  if (paymentStatus === "rejected") return "payment_rejected";
  if (paymentStatus === "error") return "payment_error";
  if (paymentStatus === "refunded") return "refunded";
  return "payment_pending";
}

export function getVentaPaymentBreakdown(venta) {
  return (Array.isArray(venta?.paymentBreakdown) ? venta.paymentBreakdown : []).filter(
    (entry) => Number(entry?.amount || 0) > 0,
  );
}

export function computeVentaPaymentSummary(venta) {
  const breakdown = getVentaPaymentBreakdown(venta).map((entry) => ({
    ...entry,
    method: normalizeMethod(entry?.method),
    provider: isMercadoPagoMethod(entry?.method)
      ? "mercadopago"
      : String(entry?.provider || "manual").toLowerCase(),
    amount: Number(entry?.amount || 0),
    status: String(entry?.status || "").toLowerCase(),
  }));

  if (breakdown.length === 0) {
    const payment = venta?.payment || {};
    return {
      method: normalizeMethod(payment?.method) || "",
      provider: String(payment?.provider || "manual").toLowerCase(),
      status: String(payment?.status || "").toLowerCase(),
      approvedAmount: Number(payment?.approvedAmount || 0),
      pendingAmount: Number(payment?.pendingAmount || 0),
      totalAmount: Number(venta?.totals?.total || payment?.totalAmount || 0),
      splitMode: String(payment?.splitMode || "single"),
      methods: Array.isArray(payment?.methods)
        ? payment.methods.map((method) => normalizeMethod(method)).filter(Boolean)
        : [],
    };
  }

  const totalAmount = Number(
    venta?.totals?.total || venta?.payment?.totalAmount || 0,
  );
  const approvedAmount = breakdown
    .filter((entry) => APPROVED_STATUSES.has(entry.status))
    .reduce((acc, entry) => acc + entry.amount, 0);
  const pendingAmount = breakdown
    .filter((entry) => PENDING_STATUSES.has(entry.status))
    .reduce((acc, entry) => acc + entry.amount, 0);
  const hasMercadoPago = breakdown.some((entry) =>
    isMercadoPagoMethod(entry.method),
  );
  const hasManual = breakdown.some(
    (entry) => !isMercadoPagoMethod(entry.method),
  );
  const methods = Array.from(
    new Set(breakdown.map((entry) => normalizeMethod(entry.method)).filter(Boolean)),
  );
  const statusSet = new Set(breakdown.map((entry) => entry.status));

  let status = "approved";
  if (pendingAmount > 0) {
    status = approvedAmount > 0 ? "partial_pending" : "pending";
  } else if (approvedAmount >= totalAmount && totalAmount > 0) {
    status = "approved";
  } else if (approvedAmount > 0 && hasMercadoPago) {
    if (statusSet.has("error")) status = "partial_error";
    else if (statusSet.has("expired")) status = "partial_expired";
    else if (statusSet.has("rejected")) status = "partial_rejected";
    else if (statusSet.has("canceled")) status = "partial_canceled";
    else status = "approved";
  } else if (statusSet.has("error")) {
    status = "error";
  } else if (statusSet.has("expired")) {
    status = "expired";
  } else if (statusSet.has("rejected")) {
    status = "rejected";
  } else if (statusSet.has("canceled")) {
    status = "canceled";
  }

  return {
    method: breakdown.length > 1 ? "multiple" : breakdown[0]?.method || "",
    provider: hasMercadoPago ? (hasManual ? "mixed" : "mercadopago") : "manual",
    status,
    approvedAmount: Math.round(approvedAmount * 100) / 100,
    pendingAmount: Math.round(pendingAmount * 100) / 100,
    totalAmount,
    splitMode:
      breakdown.length > 1
        ? hasMercadoPago
          ? "mixed_with_mp"
          : "manual_multiple"
        : "single",
    methods,
  };
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

export function buildPaymentEntry(order, { splitId = null } = {}) {
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
    method: "mercadago",
    provider: "mercadopago",
    splitId: splitId || null,
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
  const { chunkDocId, ventaKey, splitId } = normalizeExternalReference(
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

    const paymentEntry = buildPaymentEntry(order, { splitId });
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

    const currentBreakdown = getVentaPaymentBreakdown(venta);
    let updatedBreakdown = currentBreakdown;

    if (splitId) {
      const breakdownIdx = currentBreakdown.findIndex(
        (entry) => String(entry?.id || "") === String(splitId),
      );
      const nextBreakdownEntry = {
        ...(breakdownIdx >= 0 ? currentBreakdown[breakdownIdx] : {}),
        id: splitId,
        method: "mercadago",
        provider: "mercadopago",
        amount:
          breakdownIdx >= 0
            ? Number(currentBreakdown[breakdownIdx]?.amount || paymentEntry.amount || 0)
            : Number(paymentEntry.amount || 0),
        status: paymentStatus,
        orderId: paymentEntry.orderId,
        paymentId: paymentEntry.paymentId,
        paymentMethodId: paymentEntry.paymentMethodId,
        paymentTypeId: paymentEntry.paymentTypeId,
        statusDetail: paymentEntry.statusDetail,
        mpOrderStatus: paymentEntry.mpOrderStatus,
        mpPaymentStatus: paymentEntry.mpPaymentStatus,
        updatedAt: paymentEntry.updatedAt,
        paidAt: paymentEntry.paidAt || null,
      };

      updatedBreakdown =
        breakdownIdx >= 0
          ? currentBreakdown.map((entry, entryIdx) =>
              entryIdx === breakdownIdx ? nextBreakdownEntry : entry,
            )
          : [...currentBreakdown, nextBreakdownEntry];
    }

    const paymentSummary = splitId
      ? computeVentaPaymentSummary({
          ...venta,
          payments: updatedPayments,
          paymentBreakdown: updatedBreakdown,
        })
      : {
          method: "mercadago",
          provider: "mercadopago",
          status: paymentStatus,
          approvedAmount: APPROVED_STATUSES.has(paymentStatus)
            ? Number(paymentEntry.amount || venta?.totals?.total || 0)
            : 0,
          pendingAmount: PENDING_STATUSES.has(paymentStatus)
            ? Number(paymentEntry.amount || venta?.totals?.total || 0)
            : 0,
          totalAmount: Number(venta?.totals?.total || paymentEntry.amount || 0),
          splitMode: "single",
          methods: ["mercadago"],
        };
    const latestMpBreakdown =
      [...updatedBreakdown]
        .reverse()
        .find((entry) => isMercadoPagoMethod(entry?.method)) || null;

    const shouldReleaseStock =
      RELEASE_STATUSES.has(paymentStatus) &&
      venta?.stockReservationActive === true &&
      paymentSummary.pendingAmount <= 0 &&
      paymentSummary.approvedAmount <= 0 &&
      !venta?.stockReleasedAt;

    if (shouldReleaseStock) {
      await releaseReservedStock(tx, venta);
    }

    const updates = {
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
      [`${ventaKey}.payment.orderId`]:
        latestMpBreakdown?.orderId || paymentEntry.orderId,
      [`${ventaKey}.payment.paymentId`]:
        latestMpBreakdown?.paymentId || paymentEntry.paymentId,
      [`${ventaKey}.payment.mpOrderStatus`]:
        latestMpBreakdown?.mpOrderStatus || paymentEntry.mpOrderStatus,
      [`${ventaKey}.payment.mpPaymentStatus`]:
        latestMpBreakdown?.mpPaymentStatus || paymentEntry.mpPaymentStatus,
      [`${ventaKey}.payment.statusDetail`]: paymentEntry.statusDetail,
      [`${ventaKey}.payment.updatedAt`]: FieldValue.serverTimestamp(),
      [`${ventaKey}.status`]: getVentaStatus(paymentSummary.status),
      [`${ventaKey}.stockReservationActive`]: paymentSummary.pendingAmount > 0,
    };

    if (paymentSummary.status === "approved" && !venta?.paidAt) {
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
