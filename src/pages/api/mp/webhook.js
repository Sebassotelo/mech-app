import {
  fetchMPOrder,
  reconcileOrder,
} from "@/lib/server/mpOrderSync";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  res.status(200).json({ ok: true });

  try {
    const topic = String(req.body?.type || req.query?.type || "").toLowerCase();
    if (topic && topic !== "order") return;

    const orderId = req.body?.data?.id || req.query?.id || null;
    if (!orderId) {
      console.warn("[webhook] sin orderId");
      return;
    }

    const order = await fetchMPOrder(orderId);
    await reconcileOrder(order);
  } catch (err) {
    console.error("[webhook] error:", err.message, err.stack);
  }
}
