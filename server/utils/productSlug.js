const Product = require("../models/Product");
const { slugify } = require("./taxonomy");

async function ensureUniqueProductSlug(baseValue, excludeId = null) {
  const safeBase = slugify(baseValue || "product") || "product";
  let candidate = safeBase;
  let counter = 2;

  while (true) {
    const existing = await Product.findOne({
      slug: candidate,
      ...(excludeId ? { _id: { $ne: excludeId } } : {}),
    }).lean();

    if (!existing) return candidate;
    candidate = `${safeBase}-${counter}`;
    counter += 1;
  }
}

module.exports = { ensureUniqueProductSlug };
