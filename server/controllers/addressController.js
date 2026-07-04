const UserAddress = require("../models/UserAddress");

const ADDRESS_TYPES = new Set(["home", "work", "other"]);

const serializeAddress = (address) => ({
  id: address._id?.toString?.() || address.id,
  user_id: address.user_id?._id?.toString?.() || address.user_id?.toString?.() || address.user_id,
  label: address.label || "Default",
  full_name: address.full_name || null,
  phone: address.phone || null,
  line1: address.line1 || null,
  line2: address.line2 || null,
  landmark: address.landmark || null,
  city: address.city || null,
  state: address.state || null,
  pincode: address.pincode || null,
  country: address.country || "India",
  address_type: address.address_type || "home",
  is_default_shipping: Boolean(address.is_default_shipping),
  is_default_billing: Boolean(address.is_default_billing),
  created_at: address.createdAt || address.created_at || null,
  updated_at: address.updatedAt || address.updated_at || null,
});

const normalizeAddressPayload = (payload = {}) => {
  const label = String(payload.label || "").trim() || "Default";
  const addressType = String(payload.address_type || "home").trim().toLowerCase();

  return {
    label,
    full_name: String(payload.full_name || "").trim(),
    phone: String(payload.phone || "").trim(),
    line1: String(payload.line1 || "").trim(),
    line2: String(payload.line2 || "").trim() || null,
    landmark: String(payload.landmark || "").trim() || null,
    city: String(payload.city || "").trim(),
    state: String(payload.state || "").trim(),
    pincode: String(payload.pincode || "").trim(),
    country: String(payload.country || "India").trim() || "India",
    address_type: ADDRESS_TYPES.has(addressType) ? addressType : "home",
    is_default_shipping: Boolean(payload.is_default_shipping),
    is_default_billing: Boolean(payload.is_default_billing),
  };
};

const validateAddressPayload = (payload) => {
  const requiredFields = [
    ["full_name", "Full name is required"],
    ["phone", "Phone is required"],
    ["line1", "Address line 1 is required"],
    ["city", "City is required"],
    ["state", "State is required"],
    ["pincode", "Pincode is required"],
  ];

  for (const [field, message] of requiredFields) {
    if (!payload[field]) {
      const error = new Error(message);
      error.status = 400;
      throw error;
    }
  }

  if (!/^\d{6}$/.test(String(payload.pincode || ""))) {
    const error = new Error("Enter a valid 6-digit pincode");
    error.status = 400;
    throw error;
  }
};

const clearDefaultFlags = async (userId, excludeId = null) => {
  const filter = { user_id: userId };
  if (excludeId) filter._id = { $ne: excludeId };
  await UserAddress.updateMany(filter, { $set: { is_default_shipping: false } });
};

const listAddresses = async (req, res) => {
  try {
    const addresses = await UserAddress.find({ user_id: req.user._id })
      .sort({ is_default_shipping: -1, createdAt: -1 })
      .lean();
    res.json(addresses.map(serializeAddress));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const createAddress = async (req, res) => {
  try {
    const payload = normalizeAddressPayload(req.body);
    validateAddressPayload(payload);

    const existingCount = await UserAddress.countDocuments({ user_id: req.user._id });
    const shouldBeDefault = existingCount === 0 || payload.is_default_shipping;

    const address = await UserAddress.create({
      ...payload,
      user_id: req.user._id,
      is_default_shipping: shouldBeDefault,
      is_default_billing: payload.is_default_billing || shouldBeDefault,
    });

    if (shouldBeDefault) {
      await clearDefaultFlags(req.user._id, address._id);
    }

    const fresh = await UserAddress.findById(address._id).lean();
    res.status(201).json(serializeAddress(fresh));
  } catch (err) {
    res.status(Number(err.status) || 400).json({ message: err.message });
  }
};

const updateAddress = async (req, res) => {
  try {
    const address = await UserAddress.findOne({ _id: req.params.id, user_id: req.user._id });
    if (!address) return res.status(404).json({ message: "Address not found" });

    const payload = normalizeAddressPayload({
      ...address.toObject(),
      ...req.body,
      is_default_shipping: req.body.is_default_shipping != null ? req.body.is_default_shipping : address.is_default_shipping,
      is_default_billing: req.body.is_default_billing != null ? req.body.is_default_billing : address.is_default_billing,
    });
    validateAddressPayload(payload);

    Object.assign(address, payload);
    await address.save();

    if (address.is_default_shipping) {
      await clearDefaultFlags(req.user._id, address._id);
    }

    const fresh = await UserAddress.findById(address._id).lean();
    res.json(serializeAddress(fresh));
  } catch (err) {
    res.status(Number(err.status) || 400).json({ message: err.message });
  }
};

const deleteAddress = async (req, res) => {
  try {
    const address = await UserAddress.findOne({ _id: req.params.id, user_id: req.user._id }).lean();
    if (!address) return res.status(404).json({ message: "Address not found" });

    await UserAddress.deleteOne({ _id: address._id, user_id: req.user._id });

    if (address.is_default_shipping) {
      const nextAddress = await UserAddress.findOne({ user_id: req.user._id }).sort({ createdAt: 1 });
      if (nextAddress) {
        nextAddress.is_default_shipping = true;
        await nextAddress.save();
      }
    }

    res.json({ message: "Address deleted" });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

const setDefaultAddress = async (req, res) => {
  try {
    const address = await UserAddress.findOne({ _id: req.params.id, user_id: req.user._id });
    if (!address) return res.status(404).json({ message: "Address not found" });

    address.is_default_shipping = true;
    if (!address.is_default_billing) address.is_default_billing = true;
    await address.save();
    await clearDefaultFlags(req.user._id, address._id);

    const fresh = await UserAddress.findById(address._id).lean();
    res.json(serializeAddress(fresh));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

module.exports = {
  listAddresses,
  createAddress,
  updateAddress,
  deleteAddress,
  setDefaultAddress,
  serializeAddress,
};
