const DeliveryPartner = require("../models/DeliveryPartner");

const listDeliveryPartners = async (_req, res) => {
  try {
    const partners = await DeliveryPartner.find().sort({ createdAt: -1 }).lean();
    res.json(partners.map((partner) => ({ ...partner, id: partner._id.toString() })));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const createDeliveryPartner = async (req, res) => {
  try {
    const partner = await DeliveryPartner.create(req.body);
    res.status(201).json({ ...partner.toObject(), id: partner._id.toString() });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

const updateDeliveryPartner = async (req, res) => {
  try {
    const partner = await DeliveryPartner.findByIdAndUpdate(req.params.id, req.body, { new: true }).lean();
    if (!partner) return res.status(404).json({ message: 'Delivery partner not found' });
    res.json({ ...partner, id: partner._id.toString() });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

module.exports = { listDeliveryPartners, createDeliveryPartner, updateDeliveryPartner };
