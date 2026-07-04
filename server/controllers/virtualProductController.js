const VirtualProduct = require("../models/VirtualProduct");
const { applyQueryParams } = require("./orderController");

const toFlat = (doc) => ({ ...doc, id: doc._id.toString() });

const getProducts = async (req, res) => {
  try {
    let q = VirtualProduct.find();
    // Support is_active and status filters
    if (req.query.is_active !== undefined) q = q.where("is_active").equals(req.query.is_active === "true");
    if (req.query.status) q = q.where("status").equals(req.query.status);
    q = applyQueryParams(q, req);
    if (!req.query._sort) q = q.sort({ sort_order: 1 });
    const products = await q.lean();
    res.json(products.map(toFlat));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getProduct = async (req, res) => {
  try {
    const p = await VirtualProduct.findById(req.params.id).lean();
    if (!p) return res.status(404).json({ message: "Product not found" });
    res.json(toFlat(p));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const createProduct = async (req, res) => {
  try {
    if (Array.isArray(req.body)) {
      const products = await VirtualProduct.insertMany(req.body, { ordered: false });
      return res.status(201).json(products.map((p) => toFlat(p.toObject())));
    }
    const p = await VirtualProduct.create(req.body);
    res.status(201).json(toFlat(p.toObject()));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

const updateProduct = async (req, res) => {
  try {
    const p = await VirtualProduct.findByIdAndUpdate(req.params.id, req.body, { new: true }).lean();
    if (!p) return res.status(404).json({ message: "Product not found" });
    res.json(toFlat(p));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

const deleteProduct = async (req, res) => {
  try {
    const p = await VirtualProduct.findByIdAndDelete(req.params.id);
    if (!p) return res.status(404).json({ message: "Product not found" });
    res.json({ message: "Product deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = { getProducts, getProduct, createProduct, updateProduct, deleteProduct };
