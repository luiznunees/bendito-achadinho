const { requireAdminAuth } = require("../../lib/adminAuth");
const { getAllSettings, updateSettings } = require("../../lib/settings");

module.exports = async function handler(req, res) {
  if (!requireAdminAuth(req, res)) return;

  if (req.method === "GET") {
    try {
      const settings = await getAllSettings();
      res.status(200).json(settings);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
    return;
  }

  if (req.method === "PATCH") {
    try {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      await updateSettings(body);
      const settings = await getAllSettings();
      res.status(200).json(settings);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
    return;
  }

  res.status(405).end();
};
