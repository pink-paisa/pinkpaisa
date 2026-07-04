const Workshop = require("../models/Workshop");
const { applyQueryParams } = require("./orderController");

const toFlat = (doc) => ({ ...doc, id: doc._id.toString() });

const getWorkshops = async (req, res) => {
  try {
    let q = Workshop.find();
    if (req.query.status) q = q.where("status").equals(req.query.status);
    else if (req.query.all !== "true") q = q.where("status").equals("active");
    q = applyQueryParams(q, req);
    if (!req.query._sort) q = q.sort({ sort_order: 1 });
    const workshops = await q.lean();
    res.json(workshops.map(toFlat));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getWorkshop = async (req, res) => {
  try {
    let workshop = null;
    if (req.params.slug.match(/^[0-9a-fA-F]{24}$/)) {
      workshop = await Workshop.findById(req.params.slug).lean();
    }
    if (!workshop) workshop = await Workshop.findOne({ slug: req.params.slug }).lean();
    if (!workshop) return res.status(404).json({ message: "Workshop not found" });
    res.json(toFlat(workshop));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const createWorkshop = async (req, res) => {
  try {
    const workshop = await Workshop.create(req.body);
    res.status(201).json(toFlat(workshop.toObject()));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

const updateWorkshop = async (req, res) => {
  try {
    const workshop = await Workshop.findByIdAndUpdate(req.params.id, req.body, { new: true }).lean();
    if (!workshop) return res.status(404).json({ message: "Workshop not found" });
    res.json(toFlat(workshop));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

const deleteWorkshop = async (req, res) => {
  try {
    const workshop = await Workshop.findByIdAndDelete(req.params.id);
    if (!workshop) return res.status(404).json({ message: "Workshop not found" });
    res.json({ message: "Workshop deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = { getWorkshops, getWorkshop, createWorkshop, updateWorkshop, deleteWorkshop };
