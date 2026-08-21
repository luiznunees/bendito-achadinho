// ============================================================
// Autenticação básica (usuário/senha do navegador) pras rotas do
// painel de admin. Usuário pode ser qualquer coisa — só a senha
// (ADMIN_PASSWORD) importa.
// ============================================================

function requireAdminAuth(req, res) {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    res.status(500).json({ error: "ADMIN_PASSWORD não configurado" });
    return false;
  }

  const header = req.headers.authorization || "";
  const [scheme, encoded] = header.split(" ");

  if (scheme === "Basic" && encoded) {
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    const sepIndex = decoded.indexOf(":");
    const suppliedPassword = sepIndex === -1 ? decoded : decoded.slice(sepIndex + 1);
    if (suppliedPassword === password) return true;
  }

  res.setHeader("WWW-Authenticate", 'Basic realm="painel"');
  res.status(401).end();
  return false;
}

module.exports = { requireAdminAuth };
