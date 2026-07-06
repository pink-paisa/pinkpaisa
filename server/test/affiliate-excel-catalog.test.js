const test = require("node:test");
const assert = require("node:assert/strict");
const ExcelJS = require("exceljs");

const {
  parseAffiliateExcelBuffer,
  extractAsin,
  normalizeUrl,
} = require("../services/affiliateExcelCatalog");
const Product = require("../models/Product");
const ProductCategory = require("../models/ProductCategory");
const ProductSubcategory = require("../models/ProductSubcategory");
const AdminSettings = require("../models/AdminSettings");
const affiliateProductController = require("../controllers/affiliateProductController");
const affiliateProductPrivate = affiliateProductController._private;

function queryResult(value) {
  return {
    select() { return this; },
    sort() { return this; },
    skip() { return this; },
    limit() { return this; },
    lean() { return Promise.resolve(value); },
    then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
    catch(reject) { return Promise.resolve(value).catch(reject); },
  };
}

function createListQuery(value, tracker = {}) {
  return {
    sort(value) { tracker.sort = value; return this; },
    skip(value) { tracker.skip = value; return this; },
    limit(value) { tracker.limit = value; return this; },
    lean() { return Promise.resolve(value); },
  };
}

async function withAffiliateImportMocks(callback) {
  const originalEnv = {
    AMAZON_ASSOCIATE_TAG_IN: process.env.AMAZON_ASSOCIATE_TAG_IN,
    AMAZON_ASSOCIATE_TAG_US: process.env.AMAZON_ASSOCIATE_TAG_US,
  };
  const originals = {
    productFindOne: Product.findOne,
    productFind: Product.find,
    productCreate: Product.create,
    productCountDocuments: Product.countDocuments,
    categoryFindOne: ProductCategory.findOne,
    categoryFindById: ProductCategory.findById,
    subcategoryFindOne: ProductSubcategory.findOne,
    subcategoryFindById: ProductSubcategory.findById,
  };

  const category = { _id: "category-id", name: "Beauty", slug: "beauty" };
  const subcategory = { _id: "subcategory-id", category_id: "category-id", name: "Skincare", slug: "skincare" };
  const existingProduct = {
    _id: "existing-product-id",
    title: "Existing Affiliate Product",
    is_affiliate: true,
    source_type: "admin",
    affiliate_marketplace: "amazon_in",
    affiliate_asin: "B0D1234567",
    affiliate_url: "https://www.amazon.in/dp/B0D1234567?tag=pinkpaisa-21",
    attributes: {},
    toObject() {
      return { ...this };
    },
    async save() {
      this.__saved = true;
    },
  };
  const createdDocs = [];

  try {
    process.env.AMAZON_ASSOCIATE_TAG_IN = "pinkpaisa-21";
    process.env.AMAZON_ASSOCIATE_TAG_US = "";

    Product.findOne = (query = {}) => {
      if (
        query.is_affiliate
        && query.source_type === "admin"
        && query.affiliate_marketplace === "amazon_in"
        && query.affiliate_asin === "B0D1234567"
        && !query._id
      ) {
        return queryResult(existingProduct);
      }
      return queryResult(null);
    };
    Product.find = () => queryResult([...createdDocs, existingProduct].map((doc) => ({ ...doc, id: doc._id })));
    Product.countDocuments = async () => createdDocs.length + 1;
    Product.create = async (doc) => {
      const created = { ...doc, _id: `created-${createdDocs.length + 1}` };
      createdDocs.push(created);
      return created;
    };
    ProductCategory.findOne = (query = {}) => {
      const name = String(query.name || "");
      return queryResult(name.includes("Beauty") ? category : null);
    };
    ProductCategory.findById = (id) => queryResult(String(id) === "category-id" ? category : null);
    ProductSubcategory.findOne = (query = {}) => {
      const name = String(query.name || "");
      const categoryMatches = String(query.category_id) === "category-id";
      return queryResult(categoryMatches && name.includes("Skincare") ? subcategory : null);
    };
    ProductSubcategory.findById = (id) => queryResult(String(id) === "subcategory-id" ? subcategory : null);

    return await callback({ existingProduct, createdDocs });
  } finally {
    process.env.AMAZON_ASSOCIATE_TAG_IN = originalEnv.AMAZON_ASSOCIATE_TAG_IN;
    process.env.AMAZON_ASSOCIATE_TAG_US = originalEnv.AMAZON_ASSOCIATE_TAG_US;
    Product.findOne = originals.productFindOne;
    Product.find = originals.productFind;
    Product.create = originals.productCreate;
    Product.countDocuments = originals.productCountDocuments;
    ProductCategory.findOne = originals.categoryFindOne;
    ProductCategory.findById = originals.categoryFindById;
    ProductSubcategory.findOne = originals.subcategoryFindOne;
    ProductSubcategory.findById = originals.subcategoryFindById;
  }
}

async function withAffiliateBulkMocks(callback) {
  const originalEnv = {
    AMAZON_ASSOCIATE_TAG_IN: process.env.AMAZON_ASSOCIATE_TAG_IN,
    AMAZON_ASSOCIATE_TAG_US: process.env.AMAZON_ASSOCIATE_TAG_US,
  };
  const originals = {
    productFindOne: Product.findOne,
    productDeleteOne: Product.deleteOne,
    categoryFindById: ProductCategory.findById,
    subcategoryFindById: ProductSubcategory.findById,
    adminSettingsFindOne: AdminSettings.findOne,
    adminSettingsCreate: AdminSettings.create,
  };

  const objectIdLike = (value) => ({ toString: () => value });
  const makeProduct = (id, overrides = {}) => ({
    _id: id,
    id,
    title: `Affiliate ${id}`,
    slug: `affiliate-${id}`,
    is_affiliate: true,
    source_type: "admin",
    affiliate_url: `https://www.amazon.in/dp/${overrides.affiliate_asin || "B0BULK0001"}?tag=pinkpaisa-21`,
    affiliate_asin: overrides.affiliate_asin || "B0BULK0001",
    affiliate_marketplace: "amazon_in",
    affiliate_data_source: "manual",
    category_id: "category-id",
    subcategory_id: "subcategory-id",
    category: "Beauty",
    subcategory: "Skincare",
    short_description: "Curated affiliate product.",
    pros: ["Useful"],
    cons: ["Check seller details"],
    seo_title: `Affiliate ${id}`,
    seo_description: `Curated affiliate product ${id}.`,
    status: "draft",
    is_visible: false,
    featured: false,
    is_featured_affiliate: false,
    affiliate_is_instagram_pick: false,
    attributes: {},
    ...overrides,
    toObject() {
      return { ...this };
    },
    async save() {
      this.__saved = true;
      return this;
    },
  });

  const docs = new Map([
    ["valid", makeProduct("valid", { affiliate_asin: "B0BULK0001" })],
    ["invalid", makeProduct("invalid", {
      affiliate_asin: "B0BULK0002",
      affiliate_url: "https://www.amazon.in/dp/B0BULK0002?tag=wrongtag-21",
    })],
    ["active", makeProduct("active", {
      affiliate_asin: "B0BULK0003",
      status: "active",
      is_visible: true,
    })],
    ["draft", makeProduct("draft", { affiliate_asin: "B0BULK0004" })],
    ["objectid", makeProduct("objectid", {
      _id: objectIdLike("objectid"),
      affiliate_asin: "B0BULK0005",
    })],
  ]);
  const deletedIds = [];

  try {
    process.env.AMAZON_ASSOCIATE_TAG_IN = "pinkpaisa-21";
    process.env.AMAZON_ASSOCIATE_TAG_US = "";

    Product.findOne = (query = {}) => {
      if (query._id && query.is_affiliate && query.source_type === "admin") {
        return queryResult(docs.get(String(query._id)) || null);
      }
      return queryResult(null);
    };
    Product.deleteOne = async (query = {}) => {
      deletedIds.push(String(query._id));
      docs.delete(String(query._id));
      return { deletedCount: 1 };
    };
    ProductCategory.findById = (id) => queryResult(String(id) === "category-id-2" ? { _id: "category-id-2", name: "Fitness", slug: "fitness" } : null);
    ProductSubcategory.findById = (id) => queryResult(String(id) === "subcategory-id-2" ? { _id: "subcategory-id-2", category_id: "category-id-2", name: "Equipment", slug: "equipment" } : null);
    AdminSettings.findOne = () => queryResult({
      key: "affiliate-data",
      affiliate_data_mode: "creators_api",
      affiliate_data_marketplaces: ["amazon_in"],
      affiliate_creators_api_health_status: "ok",
    });
    AdminSettings.create = async () => ({
      toObject() {
        return {
          key: "affiliate-data",
          affiliate_data_mode: "manual_only",
          affiliate_data_marketplaces: ["amazon_in"],
          affiliate_creators_api_health_status: "unchecked",
        };
      },
    });

    return await callback({ docs, deletedIds });
  } finally {
    process.env.AMAZON_ASSOCIATE_TAG_IN = originalEnv.AMAZON_ASSOCIATE_TAG_IN;
    process.env.AMAZON_ASSOCIATE_TAG_US = originalEnv.AMAZON_ASSOCIATE_TAG_US;
    Product.findOne = originals.productFindOne;
    Product.deleteOne = originals.productDeleteOne;
    ProductCategory.findById = originals.categoryFindById;
    ProductSubcategory.findById = originals.subcategoryFindById;
    AdminSettings.findOne = originals.adminSettingsFindOne;
    AdminSettings.create = originals.adminSettingsCreate;
  }
}

test("affiliate product list keeps legacy array response without pagination params", async () => {
  const originalFind = Product.find;
  const originalCountDocuments = Product.countDocuments;
  const docs = [
    {
      _id: { toString: () => "affiliate-1" },
      title: "Legacy Affiliate",
      category_id: { toString: () => "category-1" },
      subcategory_id: { toString: () => "subcategory-1" },
    },
  ];
  let countCalled = false;

  try {
    Product.find = (query) => {
      assert.deepEqual(query, { is_affiliate: true, source_type: "admin" });
      return queryResult(docs);
    };
    Product.countDocuments = async () => {
      countCalled = true;
      return 0;
    };

    let payload = null;
    await affiliateProductController.listAffiliateProducts(
      { query: {} },
      {
        json(value) {
          payload = value;
        },
        status() {
          throw new Error("Legacy affiliate list should not fail");
        },
      },
    );

    assert.equal(countCalled, false);
    assert.equal(Array.isArray(payload), true);
    assert.equal(payload[0].id, "affiliate-1");
    assert.equal(payload[0].category_id, "category-1");
  } finally {
    Product.find = originalFind;
    Product.countDocuments = originalCountDocuments;
  }
});

test("affiliate product list returns paginated response with clamped limit and counts", async () => {
  const originalFind = Product.find;
  const originalCountDocuments = Product.countDocuments;
  const tracker = {};
  const docs = [
    {
      _id: { toString: () => "affiliate-2" },
      title: "Wireless Mouse",
      category_id: null,
      subcategory_id: null,
      affiliate_compliance_status: "needs_review",
    },
  ];
  const countQueries = [];

  try {
    Product.find = (query) => {
      assert.equal(query.is_affiliate, true);
      assert.equal(query.source_type, "admin");
      assert.equal(query.affiliate_compliance_status.$ne, "compliant");
      assert.ok(query.$or.some((item) => item.title instanceof RegExp));
      return createListQuery(docs, tracker);
    };
    Product.countDocuments = async (query) => {
      countQueries.push(query);
      return 42;
    };

    let payload = null;
    await affiliateProductController.listAffiliateProducts(
      { query: { page: "2", limit: "500", search: "mouse", quick_filter: "needs_review" } },
      {
        json(value) {
          payload = value;
        },
        status() {
          throw new Error("Paginated affiliate list should not fail");
        },
      },
    );

    assert.equal(tracker.skip, 100);
    assert.equal(tracker.limit, 100);
    assert.equal(payload.items[0].id, "affiliate-2");
    assert.deepEqual(payload.pagination, { page: 2, limit: 100, total: 42, total_pages: 1 });
    assert.equal(payload.counts.all, 42);
    assert.equal(payload.counts.needs_review, 42);
    assert.ok(countQueries.length >= 2);
  } finally {
    Product.find = originalFind;
    Product.countDocuments = originalCountDocuments;
  }
});

function mockResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

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

test("vendor product uniqueness ignores admin and affiliate products without vendor links", () => {
  const vendorProductIndex = Product.schema.indexes().find(([fields]) => fields.vendor_product_id === 1);

  assert.ok(vendorProductIndex, "vendor_product_id index should exist");
  assert.equal(vendorProductIndex[1].unique, true);
  assert.deepEqual(vendorProductIndex[1].partialFilterExpression, {
    vendor_product_id: { $type: "objectId" },
  });
});

test("affiliate excel preview classifies create update and duplicate rows without writing products", async () => {
  const buffer = await workbookBuffer([
    {
      product_title: "New Affiliate Product",
      affiliate_url: "https://www.amazon.in/dp/B0CTVGPLQX?tag=pinkpaisa-21",
      image_url: "https://cdn.example.com/new.jpg",
      marketplace: "amazon_in",
      asin: "B0CTVGPLQX",
      category: "Beauty",
      subcategory: "Skincare",
      short_description: "A new curated pick.",
      pros: "Useful | Giftable",
      cons: "Check seller details",
      seo_title: "New Affiliate Product",
      seo_description: "Curated affiliate pick.",
    },
    {
      product_title: "Existing Affiliate Product",
      affiliate_url: "https://www.amazon.in/dp/B0D1234567?tag=pinkpaisa-21",
      image_url: "https://cdn.example.com/existing.jpg",
      marketplace: "amazon_in",
      asin: "B0D1234567",
      category: "Beauty",
      subcategory: "Skincare",
      short_description: "Existing curated pick.",
      pros: "Known fit | Easy to explain",
      cons: "Check seller details",
      seo_title: "Existing Affiliate Product",
      seo_description: "Existing affiliate pick.",
    },
    {
      product_title: "Duplicate Affiliate Product",
      affiliate_url: "https://www.amazon.in/dp/B0CTVGPLQX?tag=pinkpaisa-21",
      image_url: "https://cdn.example.com/duplicate.jpg",
      marketplace: "amazon_in",
      asin: "B0CTVGPLQX",
      category: "Beauty",
      subcategory: "Skincare",
      short_description: "Duplicate curated pick.",
      pros: "Useful",
      cons: "Duplicate",
      seo_title: "Duplicate Affiliate Product",
      seo_description: "Duplicate affiliate pick.",
    },
    {
      product_title: "Wrong Tag Affiliate Product",
      affiliate_url: "https://www.amazon.in/dp/B0BADTAG99?tag=wrongtag-21",
      image_url: "https://cdn.example.com/wrong-tag.jpg",
      marketplace: "amazon_in",
      asin: "B0BADTAG99",
      category: "Beauty",
      subcategory: "Skincare",
      short_description: "Wrong tag curated pick.",
      pros: "Useful",
      cons: "Wrong affiliate tag",
      seo_title: "Wrong Tag Affiliate Product",
      seo_description: "Wrong tag affiliate pick.",
    },
  ]);

  await withAffiliateImportMocks(async ({ existingProduct, createdDocs }) => {
    const originalCreate = Product.create;
    Product.create = async () => {
      throw new Error("Preview must not create products");
    };

    const analysis = await affiliateProductPrivate.analyzeAffiliateExcelImportBuffer(buffer, { fileName: "preview.xlsx" });

    Product.create = originalCreate;
    assert.equal(analysis.summary.total_rows, 4);
    assert.equal(analysis.summary.valid_rows, 2);
    assert.equal(analysis.summary.invalid_rows, 2);
    assert.equal(analysis.summary.create_count, 1);
    assert.equal(analysis.summary.update_count, 1);
    assert.equal(analysis.previewRows.find((row) => row.asin === "B0CTVGPLQX" && row.status === "valid").action, "create");
    assert.equal(analysis.previewRows.find((row) => row.asin === "B0D1234567").action, "update");
    assert.ok(analysis.previewRows.find((row) => row.status === "invalid").errors.join(" ").includes("Duplicate ASIN"));
    assert.ok(analysis.previewRows.find((row) => row.asin === "B0BADTAG99").errors.join(" ").includes("amazon_affiliate_tag_mismatch"));
    assert.equal(createdDocs.length, 0);
    assert.equal(existingProduct.__saved, undefined);
  });
});

test("affiliate excel confirm import creates and updates draft review products only", async () => {
  const buffer = await workbookBuffer([
    {
      product_title: "New Affiliate Product",
      affiliate_url: "https://www.amazon.in/dp/B0CTVGPLQX?tag=pinkpaisa-21",
      image_url: "https://cdn.example.com/new.jpg",
      marketplace: "amazon_in",
      asin: "B0CTVGPLQX",
      category: "Beauty",
      subcategory: "Skincare",
      short_description: "A new curated pick.",
      pros: "Useful | Giftable",
      cons: "Check seller details",
      seo_title: "New Affiliate Product",
      seo_description: "Curated affiliate pick.",
    },
    {
      product_title: "Existing Affiliate Product",
      affiliate_url: "https://www.amazon.in/dp/B0D1234567?tag=pinkpaisa-21",
      image_url: "https://cdn.example.com/existing.jpg",
      marketplace: "amazon_in",
      asin: "B0D1234567",
      category: "Beauty",
      subcategory: "Skincare",
      short_description: "Existing curated pick.",
      pros: "Known fit | Easy to explain",
      cons: "Check seller details",
      seo_title: "Existing Affiliate Product",
      seo_description: "Existing affiliate pick.",
    },
  ]);

  await withAffiliateImportMocks(async ({ existingProduct, createdDocs }) => {
    const res = mockResponse();
    await affiliateProductController.uploadAffiliateProducts({
      file: { buffer, originalname: "import.xlsx" },
    }, res);

    assert.equal(res.statusCode, 201);
    assert.equal(res.body.created, 1);
    assert.equal(res.body.updated, 1);
    assert.equal(res.body.skipped, 0);
    assert.equal(createdDocs.length, 1);
    assert.equal(createdDocs[0].status, "draft");
    assert.equal(createdDocs[0].is_visible, false);
    assert.equal(existingProduct.__saved, true);
    assert.equal(existingProduct.status, "draft");
    assert.equal(existingProduct.is_visible, false);
  });
});

test("affiliate bulk action rejects empty selections and unknown actions", async () => {
  await withAffiliateBulkMocks(async () => {
    await assert.rejects(
      () => affiliateProductPrivate.performAffiliateBulkAction({ productIds: [], action: "publish" }),
      /Select at least one affiliate product/
    );
    await assert.rejects(
      () => affiliateProductPrivate.performAffiliateBulkAction({ productIds: ["valid"], action: "bad_action" }),
      /Unsupported bulk action/
    );
  });
});

test("affiliate bulk publish returns row-level success and compliance failures", async () => {
  await withAffiliateBulkMocks(async ({ docs }) => {
    const summary = await affiliateProductPrivate.performAffiliateBulkAction({
      productIds: ["valid", "invalid"],
      action: "publish",
    });

    assert.equal(summary.requested, 2);
    assert.equal(summary.succeeded, 1);
    assert.equal(summary.failed, 1);
    assert.equal(docs.get("valid").status, "active");
    assert.equal(docs.get("valid").is_visible, true);
    assert.equal(summary.results.find((result) => result.id === "invalid").ok, false);
    assert.match(summary.results.find((result) => result.id === "invalid").message, /not publishable|amazon_affiliate_tag_mismatch/);
  });
});

test("affiliate bulk delete blocks published products and deletes safe drafts", async () => {
  await withAffiliateBulkMocks(async ({ deletedIds }) => {
    const summary = await affiliateProductPrivate.performAffiliateBulkAction({
      productIds: ["active", "draft"],
      action: "delete",
    });

    assert.equal(summary.succeeded, 1);
    assert.equal(summary.failed, 1);
    assert.deepEqual(deletedIds, ["draft"]);
    assert.equal(summary.results.find((result) => result.id === "active").message, "Unpublish before deleting");
  });
});

test("affiliate bulk assign category validates taxonomy and updates selected products", async () => {
  await withAffiliateBulkMocks(async ({ docs }) => {
    const summary = await affiliateProductPrivate.performAffiliateBulkAction({
      productIds: ["valid", "draft"],
      action: "assign_category",
      payload: {
        category_id: "category-id-2",
        subcategory_id: "subcategory-id-2",
      },
    });

    assert.equal(summary.succeeded, 2);
    assert.equal(summary.failed, 0);
    assert.equal(docs.get("valid").category, "Fitness");
    assert.equal(docs.get("valid").subcategory, "Equipment");
    assert.equal(docs.get("draft").category_id, "category-id-2");
  });
});

test("affiliate bulk refresh passes the loaded product document to the creators service", async () => {
  await withAffiliateBulkMocks(async ({ docs }) => {
    const summary = await affiliateProductPrivate.performAffiliateBulkAction({
      productIds: ["objectid"],
      action: "refresh_api",
    });

    assert.equal(summary.requested, 1);
    assert.equal(summary.succeeded, 0);
    assert.equal(summary.failed, 1);
    assert.equal(summary.results[0].id, "objectid");
    assert.match(summary.results[0].message, /Creators API product refresh is not implemented/);
    assert.equal(docs.get("objectid").__saved, true);
  });
});
