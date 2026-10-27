export default function siteLocale(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Vary", "x-vercel-ip-country");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Vercel supplies this country code at the edge. Never accept a country
  // supplied by the browser, and do not expose or store the visitor's IP.
  const country = String(req.headers["x-vercel-ip-country"] || "").trim().toUpperCase();
  const countryCode = /^[A-Z]{2}$/.test(country) ? country : null;
  return res.status(200).json({ countryCode });
}
