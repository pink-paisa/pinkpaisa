const ExcelJS = require("exceljs");
const AMAZON_BASE_URL = "https://www.amazon.in";

const TEMPLATE_COLUMNS = [
  "product_title",
  "affiliate_url",
  "image_url",
  "marketplace",
  "asin",
  "category",
  "subcategory",
  "short_description",
  "buying_intent",
  "pros",
  "cons",
  "seo_title",
  "seo_description",
  "campaign_label",
  "sku",
  "brand",
  "tags",
  "full_description",
  "external_id",
];

const HEADER_ALIASES = {
  title: ["product title", "product_title", "a-size-base-plus", "title", "name"],
  affiliateUrl: ["affiliate url", "affiliate_url", "product url", "product_url", "source url", "source_url", "a-link-normal href", "a-link-normal href 2", "href"],
  imageUrl: ["image url", "image_url", "product image", "product_image", "s-image src", "image"],
  asin: ["asin", "affiliate asin", "affiliate_asin"],
  category: ["category", "category name", "category_name"],
  subcategory: ["subcategory", "sub category", "subcategory name", "subcategory_name"],
  shortDescription: ["short description", "short_description", "summary"],
  price: ["price", "mrp", "list price", "list_price"],
  salePrice: ["sale price", "sale_price", "selling price", "selling_price"],
  rating: ["rating", "a-size-small", "stars"],
  sku: ["sku"],
  externalId: ["external id", "external_id", "product id", "product_id"],
  marketplace: ["marketplace", "affiliate marketplace", "affiliate_marketplace", "amazon marketplace"],
  brand: ["brand", "brand name", "brand_name"],
  fullDescription: ["full description", "full_description", "description", "product description", "product_description"],
  tags: ["tags", "tag list", "tag_list"],
  buyingIntent: ["buying intent", "buying_intent", "intent"],
  campaignLabel: ["campaign label", "campaign_label", "campaign"],
  pros: ["pros", "benefits"],
  cons: ["cons", "considerations"],
  seoTitle: ["seo title", "seo_title", "meta title", "seo_meta_title"],
  seoDescription: ["seo description", "seo_description", "meta description", "seo_meta_description"],
};

const MAX_IMPORT_ROWS = 1000;
const MAX_IMPORT_COLUMNS = 60;
const KNOWN_HEADERS = new Set(Object.values(HEADER_ALIASES).flat().map(normalizeHeader));

function normalizeHeader(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\s+/g, " ");
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function cellToValue(cell) {
  if (cell == null) return "";
  if (cell.text != null) return cell.text;
  const value = cell.value;
  if (value == null) return "";
  if (typeof value === "object") {
    if (value.text != null) return value.text;
    if (value.hyperlink != null) return value.hyperlink;
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text || "").join("");
    if (value.result != null) return value.result;
  }
  return value;
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const match = String(value).replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeAffiliateUrl(value) {
  const raw = normalizeText(value);
  if (!raw) return null;
  if (raw.startsWith("//")) return `https:${raw}`;
  if (raw.startsWith("/")) return `${AMAZON_BASE_URL}${raw}`;
  if (!/^https?:\/\//i.test(raw)) return `https://${raw}`;
  return raw;
}

function normalizeImageUrl(value) {
  const raw = normalizeText(value);
  if (!raw) return null;
  if (raw.startsWith("/uploads/")) return raw;
  if (raw.startsWith("//")) return `https:${raw}`;
  if (!/^https?:\/\//i.test(raw)) return `https://${raw}`;
  return raw;
}

function extractAsin(url) {
  if (!url) return null;
  const normalizedUrl = String(url);
  const pathMatch = normalizedUrl.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?#]|$)/i);
  if (pathMatch) return pathMatch[1].toUpperCase();
  const queryMatch = normalizedUrl.match(/[?&](?:asin|ASIN)=([A-Z0-9]{10})(?:&|$)/);
  return queryMatch ? queryMatch[1].toUpperCase() : null;
}

function pickValue(row, aliases) {
  for (const alias of aliases) {
    const normalizedAlias = normalizeHeader(alias);
    if (row[normalizedAlias] !== undefined && row[normalizedAlias] !== null && row[normalizedAlias] !== "") {
      return row[normalizedAlias];
    }
  }
  return null;
}

function hasAnyValue(row) {
  return Object.values(row).some((value) => normalizeText(value));
}

function normalizeWorkbookRow(row) {
  const cleanRow = {};
  for (const [key, value] of Object.entries(row)) {
    cleanRow[normalizeHeader(key)] = value;
  }
  return cleanRow;
}

function buildCatalogItem(row, index) {
  const rowNumber = index + 2;
  const sourceUrl = normalizeAffiliateUrl(pickValue(row, HEADER_ALIASES.affiliateUrl));
  const imageUrl = normalizeImageUrl(pickValue(row, HEADER_ALIASES.imageUrl));
  const title = normalizeText(pickValue(row, HEADER_ALIASES.title));
  const ratingText = normalizeText(pickValue(row, HEADER_ALIASES.rating)) || null;
  const salePrice = toNumber(pickValue(row, HEADER_ALIASES.salePrice));
  const listPrice = toNumber(pickValue(row, HEADER_ALIASES.price));
  const asin = normalizeText(pickValue(row, HEADER_ALIASES.asin)) || extractAsin(sourceUrl);
  const externalId = normalizeText(pickValue(row, HEADER_ALIASES.externalId)) || asin;
  const marketplace = normalizeText(pickValue(row, HEADER_ALIASES.marketplace)) || null;
  const category = normalizeText(pickValue(row, HEADER_ALIASES.category)) || null;
  const subcategory = normalizeText(pickValue(row, HEADER_ALIASES.subcategory)) || null;
  const sku = normalizeText(pickValue(row, HEADER_ALIASES.sku)) || (asin ? `AMZ-${asin}` : `AFF-${String(index + 1).padStart(5, "0")}`);
  const brand = normalizeText(pickValue(row, HEADER_ALIASES.brand)) || null;
  const shortDescription = normalizeText(pickValue(row, HEADER_ALIASES.shortDescription)) || null;
  const fullDescription = normalizeText(pickValue(row, HEADER_ALIASES.fullDescription)) || null;
  const tags = normalizeText(pickValue(row, HEADER_ALIASES.tags)) || null;
  const buyingIntent = normalizeText(pickValue(row, HEADER_ALIASES.buyingIntent)) || null;
  const campaignLabel = normalizeText(pickValue(row, HEADER_ALIASES.campaignLabel)) || null;
  const pros = normalizeText(pickValue(row, HEADER_ALIASES.pros)) || null;
  const cons = normalizeText(pickValue(row, HEADER_ALIASES.cons)) || null;
  const seoTitle = normalizeText(pickValue(row, HEADER_ALIASES.seoTitle)) || null;
  const seoDescription = normalizeText(pickValue(row, HEADER_ALIASES.seoDescription)) || null;
  const errors = [];

  if (!hasAnyValue(row)) {
    return { item: null, errors: [{ row: rowNumber, errors: ["Empty row skipped"] }] };
  }

  if (!title && !sourceUrl) errors.push("Product title or affiliate URL is required");
  [
    ["Product title", title],
    ["Affiliate URL with tag", sourceUrl],
    ["Marketplace", marketplace],
    ["ASIN", asin],
    ["Category", category],
    ["Subcategory", subcategory],
    ["Short description", shortDescription],
    ["Pros", pros],
    ["Cons", cons],
    ["SEO title", seoTitle],
    ["SEO description", seoDescription],
  ].forEach(([label, value]) => {
    if (!normalizeText(value)) errors.push(`${label} is required`);
  });

  if (errors.length) {
    return {
      item: null,
      errors: [{
        row: rowNumber,
        title: title || null,
        sku: sku || null,
        errors,
      }],
    };
  }

  return {
    item: {
      row_number: rowNumber,
      sku,
      external_id: externalId || null,
      slug: slugify(title || sku || externalId || `affiliate-product-${index + 1}`),
      title: title || `Affiliate Product ${index + 1}`,
      short_title: title ? title.slice(0, 80) : `Affiliate Product ${index + 1}`,
      short_description: shortDescription,
      full_description: fullDescription,
      description: fullDescription,
      brand,
      category,
      subcategory,
      marketplace,
      affiliate_marketplace: marketplace,
      affiliate_asin: asin,
      tags,
      buying_intent: buyingIntent,
      campaign_label: campaignLabel,
      pros,
      cons,
      seo_title: seoTitle,
      seo_description: seoDescription,
      currency: "INR",
      sale_price: salePrice,
      list_price: listPrice,
      discount_percent:
        listPrice && salePrice && listPrice > 0
          ? Number((((listPrice - salePrice) / listPrice) * 100).toFixed(2))
          : null,
      rating_text: ratingText,
      rating_value: toNumber(ratingText),
      image_url: imageUrl,
      source_url: sourceUrl,
      source_platform: "excel-upload",
      raw: row,
    },
    errors: [],
  };
}

async function parseAffiliateExcelBuffer(buffer, { fileName = null } = {}) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    return {
      items: [],
      errors: [{ row: 0, errors: ["Workbook does not contain any sheets"] }],
      meta: { file_name: fileName, sheet_name: null, total_rows: 0, valid_rows: 0, skipped_rows: 0 },
    };
  }

  if (worksheet.columnCount > MAX_IMPORT_COLUMNS) {
    return {
      items: [],
      errors: [{ row: 1, errors: [`Workbook has too many columns. Maximum allowed is ${MAX_IMPORT_COLUMNS}.`] }],
      meta: { file_name: fileName, sheet_name: worksheet.name, total_rows: 0, valid_rows: 0, skipped_rows: 1 },
    };
  }

  const headerRow = worksheet.getRow(1);
  const headers = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    headers[colNumber - 1] = normalizeText(cellToValue(cell));
  });

  const errors = [];
  const items = [];
  const unknownHeaders = headers
    .map((header, index) => ({ header, index }))
    .filter((entry) => entry.header && !KNOWN_HEADERS.has(normalizeHeader(entry.header)));
  if (unknownHeaders.length) {
    errors.push({
      row: 1,
      errors: [`Unknown column(s): ${unknownHeaders.map((entry) => entry.header).join(", ")}`],
    });
  }

  const rows = [];
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1 || rows.length >= MAX_IMPORT_ROWS) return;
    const record = {};
    headers.forEach((header, index) => {
      if (!header) return;
      record[header] = cellToValue(row.getCell(index + 1));
    });
    rows.push(record);
  });

  if (worksheet.actualRowCount > MAX_IMPORT_ROWS + 1) {
    errors.push({
      row: MAX_IMPORT_ROWS + 2,
      errors: [`Only the first ${MAX_IMPORT_ROWS} data rows were processed.`],
    });
  }

  rows.map(normalizeWorkbookRow).forEach((row, index) => {
    const result = buildCatalogItem(row, index);
    if (result.item) items.push(result.item);
    errors.push(...result.errors);
  });

  return {
    items,
    errors,
    meta: {
      file_name: fileName,
      sheet_name: worksheet.name,
      total_rows: rows.length,
      valid_rows: items.length,
      skipped_rows: errors.length,
    },
  };
}

module.exports = {
  TEMPLATE_COLUMNS,
  parseAffiliateExcelBuffer,
  buildCatalogItem,
  extractAsin,
  normalizeHeader,
  normalizeAffiliateUrl,
  normalizeImageUrl,
  normalizeUrl: normalizeAffiliateUrl,
};
