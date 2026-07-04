const crypto = require("crypto");
const AmazonReportRow = require("../models/AmazonReportRow");
const Product = require("../models/Product");

const MAX_REPORT_ROWS = 5000;

function normalizeHeader(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function parseCsvLine(line) {
  const cells = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === "\"" && inQuotes && next === "\"") {
      current += "\"";
      index += 1;
    } else if (char === "\"") {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  cells.push(current);
  return cells.map((cell) => cell.trim());
}

function parseCsvBuffer(buffer) {
  const content = buffer.toString("utf8").replace(/^\uFEFF/, "");
  const lines = content.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]).map(normalizeHeader);
  const rows = [];

  for (const line of lines.slice(1)) {
    const values = parseCsvLine(line);
    const row = {};
    headers.forEach((header, index) => {
      if (header) row[header] = values[index] || "";
    });
    rows.push(row);
    if (rows.length > MAX_REPORT_ROWS) {
      const error = new Error(`Amazon report imports are limited to ${MAX_REPORT_ROWS} rows`);
      error.status = 400;
      throw error;
    }
  }

  return rows;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hashValue(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function hashReportRows(rows) {
  return hashValue(stableStringify(rows));
}

function pick(row, names) {
  for (const name of names) {
    const value = row[normalizeHeader(name)];
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return null;
}

function parseNumber(value) {
  const normalized = String(value || "").replace(/[,₹$]/g, "").trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeMarketplace(value, currency) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["amazon_in", "in", "india", "amazon.in"].includes(normalized)) return "amazon_in";
  if (["amazon_us", "amazon_com", "us", "usa", "amazon.com"].includes(normalized)) return "amazon_us";
  const normalizedCurrency = String(currency || "").trim().toUpperCase();
  if (normalizedCurrency === "INR") return "amazon_in";
  if (normalizedCurrency === "USD") return "amazon_us";
  return null;
}

function normalizeCurrency(value) {
  const raw = String(value || "").trim().toUpperCase();
  if (raw) return raw;
  return null;
}

async function buildReportDocuments(rows, body = {}, sourceFileHash) {
  const importBatchId = crypto.randomUUID();
  const documents = [];
  let matchedProducts = 0;

  for (const [index, row] of rows.entries()) {
    const asin = pick(row, ["asin", "ASIN", "product asin"]);
    const currency = normalizeCurrency(pick(row, ["currency", "Currency"]));
    const marketplace = normalizeMarketplace(pick(row, ["marketplace", "Marketplace"]), currency)
      || normalizeMarketplace(body.marketplace, currency);
    const trackingId = pick(row, ["tracking id", "tracking_id", "associate id", "subtag", "sub tag"]);
    const reportDate = parseDate(pick(row, ["date", "report date", "order date", "shipped date"]));
    const campaignLabel = pick(row, ["campaign", "campaign_label", "subtag", "sub tag"]);

    let product = null;
    if (asin) {
      product = await Product.findOne({
        is_affiliate: true,
        affiliate_asin: asin.toUpperCase(),
        ...(marketplace ? { affiliate_marketplace: marketplace } : {}),
      }).select("_id").lean();
      if (product) matchedProducts += 1;
    }

    documents.push({
      report_source: "amazon_associates_csv",
      report_date: reportDate,
      marketplace,
      asin: asin ? asin.toUpperCase() : null,
      tracking_id: trackingId,
      campaign_label: campaignLabel,
      product_id: product?._id || null,
      title: pick(row, ["title", "product title", "item name", "name"]),
      ordered_items: parseNumber(pick(row, ["ordered items", "orders", "items ordered"])),
      shipped_items: parseNumber(pick(row, ["shipped items", "items shipped", "shipped"])),
      returned_items: parseNumber(pick(row, ["returned items", "returns", "returned"])),
      revenue: parseNumber(pick(row, ["revenue", "sales", "shipped revenue", "items shipped revenue"])),
      commission: parseNumber(pick(row, ["commission", "earnings", "advertising fees", "fees"])),
      currency,
      raw: row,
      import_batch_id: importBatchId,
      source_file_hash: sourceFileHash,
      source_row_number: index + 2,
      row_hash: hashValue(stableStringify(row)),
    });
  }

  return { documents, importBatchId, matchedProducts };
}

const uploadAmazonReport = async (req, res) => {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({ message: "CSV report file is required" });
    }

    const rows = parseCsvBuffer(req.file.buffer);
    if (!rows.length) {
      return res.status(400).json({ message: "CSV report file has no data rows" });
    }

    const sourceFileHash = hashReportRows(rows);
    const existingRows = await AmazonReportRow.countDocuments({ source_file_hash: sourceFileHash });
    if (existingRows > 0) {
      return res.status(409).json({
        message: "This Amazon report has already been imported.",
        rows_existing: existingRows,
      });
    }

    const { documents, importBatchId, matchedProducts } = await buildReportDocuments(rows, req.body, sourceFileHash);
    await AmazonReportRow.insertMany(documents, { ordered: false });

    res.status(201).json({
      message: "Amazon report imported",
      import_batch_id: importBatchId,
      rows_imported: documents.length,
      matched_products: matchedProducts,
      note: "Amazon report rows are stored separately from site click analytics.",
    });
  } catch (err) {
    res.status(Number(err.status) || 400).json({ message: err.message });
  }
};

module.exports = {
  uploadAmazonReport,
  _private: {
    parseCsvBuffer,
    parseCsvLine,
    hashReportRows,
    stableStringify,
  },
};
