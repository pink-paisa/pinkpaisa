const DeliveryPartner = require("../models/DeliveryPartner");

async function seedCommerceData() {
  const count = await DeliveryPartner.countDocuments();
  if (count > 0) return;
  await DeliveryPartner.insertMany([
    { name: 'BlueDart Express', company_name: 'BlueDart', phone: '+91 90000 11111', email: 'ops@bluedart.example', status: 'active' },
    { name: 'Delhivery Prime', company_name: 'Delhivery', phone: '+91 90000 22222', email: 'ops@delhivery.example', status: 'active' },
  ]);
}

module.exports = { seedCommerceData };
