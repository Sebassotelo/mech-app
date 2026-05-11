import { fetchMpUser, requireAdminCaller } from "@/lib/server/mpAdmin";

export const config = { api: { bodyParser: true } };

export default async function handler(req, res) {
  if (req.method !== "GET") {
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

    const user = await fetchMpUser(accessToken);
    return res.status(200).json({
      ok: true,
      account: {
        id: user?.id ? String(user.id) : null,
        nickname: user?.nickname || null,
        firstName: user?.first_name || null,
        lastName: user?.last_name || null,
        email: user?.email || null,
        siteId: user?.site_id || null,
      },
    });
  } catch (e) {
    console.error("[mp/account] error:", e?.message || e);
    return res
      .status(500)
      .json({ code: "E_MP_ACCOUNT", error: e?.message || "MP account failed" });
  }
}
