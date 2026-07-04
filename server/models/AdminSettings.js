const mongoose = require("mongoose");

const AdminSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    warehouse_name: { type: String, default: "PinkPaisa Warehouse" },
    warehouse_address: { type: String, default: null },
    warehouse_city: { type: String, default: null },
    warehouse_state: { type: String, default: null },
    warehouse_pincode: { type: String, default: null },
    warehouse_phone: { type: String, default: null },
    warehouse_email: { type: String, default: null },
    campaign_mode: { type: String, enum: ["manual", "automatic"], default: "manual" },
    campaign_batch_hour_ist: { type: Number, default: 9, min: 0, max: 23 },
    campaign_batch_minute_ist: { type: Number, default: 0, min: 0, max: 59 },
    campaign_creative_mode: { type: String, enum: ["template", "ai_generated", "ai_assisted", "ai_full"], default: "template" },
    campaign_ai_provider: { type: String, enum: ["openai", "google", "openrouter"], default: "openai" },
    campaign_ai_model: { type: String, default: null },
    campaign_ai_image_quality: { type: String, enum: ["low", "medium", "high"], default: "medium" },
    campaign_ai_prompt_template: { type: String, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("AdminSettings", AdminSettingsSchema);
