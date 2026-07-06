const test = require("node:test");
const assert = require("node:assert/strict");
const ExcelJS = require("exceljs");

const {
  parseAffiliateExcelBuffer,
  extractAsin,
  normalizeUrl,
} = require("../services/affiliateExcelCatalog");

async function workbookBuffer(rows) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Products");
  const headers = Array.from(rows.reduce((set, row) => {
    Object.keys(row).forEach((key) => set.add(key));
    return set;
  }, new Set()));
  worksheet.addRow(headers);
  rows.forEach((row) => worksheet.addRow(headers.map((header) => row[header] ?? "")));
  return workbook.xlsx.writeBuffer();
}

test("affiliate excel parser supports clean Pink Paisa template columns", async () => {
  const buffer = await workbookBuffer([
    {
      product_title: "Rose Quartz Face Roller",
      affiliate_url: "www.amazon.in/dp/B0CTVGPLQX",
      image_url: "https://cdn.example.com/roller.jpg",
      marketplace: "amazon_in",
      asin: "B0CTVGPLQX",
      category: "Beauty",
      subcategory: "Skincare",
      short_description: "A calming skincare tool.",
      pros: "Easy to use | Giftable",
      cons: "Check seller details on Amazon",
      seo_title: "Rose Quartz Face Roller",
      seo_description: "Curated skincare pick from Pink Paisa.",
      sku: "AMZ-B0CTVGPLQX",
      external_id: "B0CTVGPLQX",
      brand: "Example Brand",
      full_description: "A calming skincare tool.",
    },
  ]);

  const result = await parseAffiliateExcelBuffer(buffer, { fileName: "template.xlsx" });

  assert.equal(result.errors.length, 0);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].title, "Rose Quartz Face Roller");
  assert.equal(result.items[0].source_url, "https://www.amazon.in/dp/B0CTVGPLQX");
  assert.equal(result.items[0].image_url, "https://cdn.example.com/roller.jpg");
  assert.equal(result.items[0].affiliate_marketplace, "amazon_in");
  assert.equal(result.items[0].affiliate_asin, "B0CTVGPLQX");
  assert.equal(result.items[0].category, "Beauty");
  assert.equal(result.items[0].subcategory, "Skincare");
  assert.equal(result.items[0].short_description, "A calming skincare tool.");
  assert.equal(result.items[0].buying_intent, null);
  assert.equal(result.items[0].campaign_label, null);
  assert.equal(result.items[0].external_id, "B0CTVGPLQX");
  assert.equal(result.items[0].brand, "Example Brand");
});

test("affiliate excel parser rejects Amazon-style export rows missing manual fields", async () => {
  const buffer = await workbookBuffer([
    {
      "a-link-normal href": "/Some-Product/dp/B0D1234567/ref=sxin",
      "s-image src": "https://m.media-amazon.com/images/I/product.jpg",
      "a-size-base-plus": "Amazon Export Product",
      "a-size-small": "4.1 out of 5 stars",
      "Sale Price": "Rs.499",
      Price: "Rs.799",
    },
  ]);

  const result = await parseAffiliateExcelBuffer(buffer, { fileName: "amazon.xlsx" });

  assert.equal(result.items.length, 0);
  assert.equal(result.errors.length, 1);
  assert.ok(result.errors[0].errors.includes("Marketplace is required"));
  assert.ok(result.errors[0].errors.includes("Category is required"));
  assert.ok(result.errors[0].errors.includes("Short description is required"));
});

test("affiliate excel parser returns row errors for missing affiliate URLs", async () => {
  const buffer = await workbookBuffer([
    {
      product_title: "Missing Link Product",
      image_url: "https://cdn.example.com/product.jpg",
      price: 299,
    },
  ]);

  const result = await parseAffiliateExcelBuffer(buffer, { fileName: "invalid.xlsx" });

  assert.equal(result.items.length, 0);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].row, 2);
  assert.ok(result.errors[0].errors.includes("Affiliate URL with tag is required"));
});

test("affiliate excel URL and ASIN helpers normalize common Amazon inputs", () => {
  assert.equal(normalizeUrl("/dp/B0CTVGPLQX"), "https://www.amazon.in/dp/B0CTVGPLQX");
  assert.equal(normalizeUrl("amzn.to/example"), "https://amzn.to/example");
  assert.equal(extractAsin("https://www.amazon.in/gp/product/B0CTVGPLQX?th=1"), "B0CTVGPLQX");
});
