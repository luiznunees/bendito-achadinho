const { requireAdminAuth } = require("../../lib/adminAuth");
const { getAllTemplates, insertTemplate, updateTemplate, deleteTemplate } = require("../../lib/db");

module.exports = async function handler(req, res) {
  if (!requireAdminAuth(req, res)) return;

  if (req.method === "GET") {
    try {
      const templates = await getAllTemplates();
      res.status(200).json(templates);
    } catch (err) {
      console.error("admin/templates GET: falha:", err);
      res.status(500).json({ error: err.message });
    }
    return;
  }

  if (req.method === "POST") {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const { timeSlot, category, hookType, templateText } = body || {};

    if (!timeSlot || !category || !hookType || !templateText) {
      res.status(400).json({ error: "Envie timeSlot, category, hookType e templateText." });
      return;
    }

    try {
      const saved = await insertTemplate({ timeSlot, category, hookType, templateText });
      res.status(200).json(saved);
    } catch (err) {
      console.error("admin/templates POST: falha:", err);
      res.status(500).json({ error: err.message });
    }
    return;
  }

  if (req.method === "PATCH") {
    const id = req.query.id;
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    if (!id) {
      res.status(400).json({ error: "Envie ?id=... na URL." });
      return;
    }

    try {
      const saved = await updateTemplate(id, {
        templateText: body?.templateText,
        isActive: body?.isActive,
      });
      res.status(200).json(saved);
    } catch (err) {
      console.error("admin/templates PATCH: falha:", err);
      res.status(500).json({ error: err.message });
    }
    return;
  }

  if (req.method === "DELETE") {
    const id = req.query.id;
    if (!id) {
      res.status(400).json({ error: "Envie ?id=... na URL." });
      return;
    }

    try {
      await deleteTemplate(id);
      res.status(200).json({ ok: true });
    } catch (err) {
      console.error("admin/templates DELETE: falha:", err);
      res.status(500).json({ error: err.message });
    }
    return;
  }

  res.status(405).end();
};
