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
      price: "999",
      sale_price: "699",
      rating: "4.4 out of 5 stars",
      sku: "AMZ-B0CTVGPLQX",
      external_id: "B0CTVGPLQX",
      brand: "Example Brand",
      description: "A calming skincare tool.",
    },
  ]);

  const result = await parseAffiliateExcelBuffer(buffer, { fileName: "template.xlsx" });

  assert.equal(result.errors.length, 0);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].title, "Rose Quartz Face Roller");
  assert.equal(result.items[0].source_url, "https://www.amazon.in/dp/B0CTVGPLQX");
  assert.equal(result.items[0].image_url, "https://cdn.example.com/roller.jpg");
  assert.equal(result.items[0].list_price, 999);
  assert.equal(result.items[0].sale_price, 699);
  assert.equal(result.items[0].external_id, "B0CTVGPLQX");
  assert.equal(result.items[0].brand, "Example Brand");
});

test("affiliate excel parser supports Amazon-style export headers", async () => {
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

  assert.equal(result.errors.length, 0);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].title, "Amazon Export Product");
  assert.equal(result.items[0].source_url, "https://www.amazon.in/Some-Product/dp/B0D1234567/ref=sxin");
  assert.equal(result.items[0].sku, "AMZ-B0D1234567");
  assert.equal(result.items[0].external_id, "B0D1234567");
  assert.equal(result.items[0].list_price, 799);
  assert.equal(result.items[0].sale_price, 499);
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
  assert.deepEqual(result.errors[0].errors, ["Affiliate URL is required"]);
});

test("affiliate excel URL and ASIN helpers normalize common Amazon inputs", () => {
  assert.equal(normalizeUrl("/dp/B0CTVGPLQX"), "https://www.amazon.in/dp/B0CTVGPLQX");
  assert.equal(normalizeUrl("amzn.to/example"), "https://amzn.to/example");
  assert.equal(extractAsin("https://www.amazon.in/gp/product/B0CTVGPLQX?th=1"), "B0CTVGPLQX");
});
