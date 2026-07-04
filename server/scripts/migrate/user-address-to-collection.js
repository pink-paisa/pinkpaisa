const mongoose = require("mongoose");
const User = require("../../models/User");
const UserAddress = require("../../models/UserAddress");

async function run() {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || process.env.MONGO_URL;
  if (!mongoUri) {
    throw new Error("Set MONGO_URI, MONGODB_URI, or MONGO_URL before running this migration");
  }

  await mongoose.connect(mongoUri);

  const users = await User.find({
    $or: [
      { address: { $nin: [null, ""] } },
      { city: { $nin: [null, ""] } },
      { state: { $nin: [null, ""] } },
      { pincode: { $nin: [null, ""] } },
    ],
  }).lean();

  let createdCount = 0;

  for (const user of users) {
    const existing = await UserAddress.findOne({ user_id: user._id }).lean();
    if (existing) continue;

    const line1 = String(user.address || "").trim();
    const city = String(user.city || "").trim();
    const state = String(user.state || "").trim();
    const pincode = String(user.pincode || "").trim();

    if (!line1 || !city || !state || !/^\d{6}$/.test(pincode)) continue;

    await UserAddress.create({
      user_id: user._id,
      label: "Default",
      full_name: String(user.full_name || user.email || "Customer").trim(),
      phone: String(user.phone || "").trim() || "0000000000",
      line1,
      city,
      state,
      pincode,
      country: "India",
      address_type: "home",
      is_default_shipping: true,
      is_default_billing: true,
    });

    createdCount += 1;
  }

  console.log(`Created ${createdCount} default address records.`);
  await mongoose.disconnect();
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
