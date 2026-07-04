const express = require("express");
const router = express.Router();
const AdminSettings = require("../models/AdminSettings");
const { protect, adminOnly } = require("../middleware/auth");
const { CAMPAIGN_SETTINGS_KEY, normaliseCampaignSettings } = require("../utils/campaignSettings");
const { buildImageProviderRegistryResponse } = require("../services/imageProviders");

const WAREHOUSE_KEY = "warehouse";

// GET /api/admin/settings/warehouse
router.get("/settings/warehouse", protect, adminOnly, async (req, res) => {
  try {
    let settings = await AdminSettings.findOne({ key: WAREHOUSE_KEY }).lean();
    if (!settings) {
      settings = await AdminSettings.create({ key: WAREHOUSE_KEY });
      settings = settings.toObject();
    }
    res.json({
      warehouse_name: settings.warehouse_name || "",
      warehouse_address: settings.warehouse_address || "",
      warehouse_city: settings.warehouse_city || "",
      warehouse_state: settings.warehouse_state || "",
      warehouse_pincode: settings.warehouse_pincode || "",
      warehouse_phone: settings.warehouse_phone || "",
      warehouse_email: settings.warehouse_email || "",
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/admin/settings/warehouse
router.put("/settings/warehouse", protect, adminOnly, async (req, res) => {
  try {
    const { warehouse_name, warehouse_address, warehouse_city, warehouse_state, warehouse_pincode, warehouse_phone, warehouse_email } = req.body;
    const updates = {};
    if (warehouse_name !== undefined) updates.warehouse_name = String(warehouse_name).trim();
    if (warehouse_address !== undefined) updates.warehouse_address = String(warehouse_address).trim();
    if (warehouse_city !== undefined) updates.warehouse_city = String(warehouse_city).trim();
    if (warehouse_state !== undefined) updates.warehouse_state = String(warehouse_state).trim();
    if (warehouse_pincode !== undefined) updates.warehouse_pincode = String(warehouse_pincode).trim();
    if (warehouse_phone !== undefined) updates.warehouse_phone = String(warehouse_phone).trim();
    if (warehouse_email !== undefined) updates.warehouse_email = String(warehouse_email).trim();

    const settings = await AdminSettings.findOneAndUpdate(
      { key: WAREHOUSE_KEY },
      { $set: updates },
      { new: true, upsert: true, lean: true }
    );

    res.json({
      message: "Warehouse settings updated",
      warehouse_name: settings.warehouse_name || "",
      warehouse_address: settings.warehouse_address || "",
      warehouse_city: settings.warehouse_city || "",
      warehouse_state: settings.warehouse_state || "",
      warehouse_pincode: settings.warehouse_pincode || "",
      warehouse_phone: settings.warehouse_phone || "",
      warehouse_email: settings.warehouse_email || "",
    });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// GET /api/admin/settings/campaigns
router.get("/settings/campaigns", protect, adminOnly, async (_req, res) => {
  try {
    let settings = await AdminSettings.findOne({ key: CAMPAIGN_SETTINGS_KEY }).lean();
    if (!settings) {
      settings = await AdminSettings.create({ key: CAMPAIGN_SETTINGS_KEY });
      settings = settings.toObject();
    }
    res.json(normaliseCampaignSettings(settings));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/admin/settings/campaigns/image-models
router.get("/settings/campaigns/image-models", protect, adminOnly, async (_req, res) => {
  try {
    res.json(await buildImageProviderRegistryResponse());
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/admin/settings/campaigns
router.put("/settings/campaigns", protect, adminOnly, async (req, res) => {
  try {
    const updates = normaliseCampaignSettings(req.body || {});
    const settings = await AdminSettings.findOneAndUpdate(
      { key: CAMPAIGN_SETTINGS_KEY },
      { $set: updates },
      { new: true, upsert: true, lean: true }
    );

    res.json({
      message: "Campaign settings updated",
      ...normaliseCampaignSettings(settings),
    });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

module.exports = router;
