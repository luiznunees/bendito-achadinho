const { requireAdminAuth } = require("../../lib/adminAuth");
const { getPostsForDate, upsertDailyPost } = require("../../lib/db");

const TIME_SLOTS = ["08h", "10h", "12h", "14h", "16h", "18h", "20h", "22h", "23h"];

module.exports = async function handler(req, res) {
  if (!requireAdminAuth(req, res)) return;

  if (req.method === "GET") {
    const dateStr = req.query.date;
    if (!dateStr) {
      res.status(400).json({ error: "Envie ?date=YYYY-MM-DD." });
      return;
    }

    try {
      let posts = await getPostsForDate(dateStr);

      // Cria slots vazios pra horários que ainda não têm post
      const existingSlots = new Set(posts.map((p) => p.timeSlot));
      const missing = TIME_SLOTS.filter((s) => !existingSlots.has(s));

      for (const timeSlot of missing) {
        const empty = await upsertDailyPost({
          postDate: dateStr,
          timeSlot,
          productId: null,
          caption: "",
          status: "pending",
        });
        posts.push(empty);
      }

      posts.sort((a, b) => a.timeSlot.localeCompare(b.timeSlot));
      res.status(200).json(posts);
    } catch (err) {
      console.error("admin/calendar GET: falha:", err);
      res.status(500).json({ error: err.message });
    }
    return;
  }

  if (req.method === "PATCH") {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const { postDate, timeSlot, productId, caption, status } = body || {};

    if (!postDate || !timeSlot) {
      res.status(400).json({ error: "Envie postDate e timeSlot." });
      return;
    }

    try {
      const saved = await upsertDailyPost({ postDate, timeSlot, productId, caption, status });
      res.status(200).json(saved);
    } catch (err) {
      console.error("admin/calendar PATCH: falha:", err);
      res.status(500).json({ error: err.message });
    }
    return;
  }

  res.status(405).end();
};
