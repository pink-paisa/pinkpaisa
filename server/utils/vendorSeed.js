const Vendor = require("../models/Vendor");
const VendorProduct = require("../models/VendorProduct");
const VendorUploadLog = require("../models/VendorUploadLog");
const { publishVendorProduct } = require("./vendorProductSync");

async function seedVendorDemoData() {
  const vendorCount = await Vendor.countDocuments();
  if (vendorCount > 0) return;

  const created = await Vendor.create([
    {
      owner_name: "Ananya Mehra",
      mobile: "9876543210",
      email: "ananya.vendor@pinkpaisa.in",
      password_hash: "Vendor@123",
      business_name: "Anaya Wellness Private Limited",
      shop_name: "Anaya Glow",
      business_type: "Wellness Brand",
      gstin: "27ABCDE1234F1Z5",
      pan: "ABCDE1234F",
      address: "Bandra Kurla Complex",
      city: "Mumbai",
      state: "Maharashtra",
      pincode: "400051",
      website: "https://instagram.com/anayaglow",
      status: "verified",
      admin_notes: "Demo verified vendor account.",
      verified_at: new Date(),
      max_products_allowed: 25,
      commission_percent: 20,
      kyc_verified: false,
      bank_verified: false,
      bank_details: { account_holder_name: "Rhea Kapoor", account_number: "987654321098", ifsc_code: "ICIC0004567", bank_name: "ICICI Bank", branch_name: "Andheri", upi_id: "rhea@upi" },
      commission_percent: 20,
      kyc_verified: true,
      bank_verified: true,
      bank_details: { account_holder_name: "Ananya Mehra", account_number: "123456789012", ifsc_code: "HDFC0001234", bank_name: "HDFC Bank", branch_name: "BKC", upi_id: "anaya@upi" },
    },
    {
      owner_name: "Rhea Kapoor",
      mobile: "9123456789",
      email: "rhea.pending@pinkpaisa.in",
      password_hash: "Vendor@123",
      business_name: "Rhea Naturals LLP",
      shop_name: "Rhea Botanica",
      business_type: "Personal Care",
      gstin: "27ABCDE1234F2Z4",
      pan: "ABCDE1234G",
      address: "Andheri West",
      city: "Mumbai",
      state: "Maharashtra",
      pincode: "400058",
      website: "https://www.rheanaturals.com",
      status: "pending",
      max_products_allowed: 25,
    },
  ]);

  const verifiedVendor = created.find((vendor) => vendor.status === "verified");
  if (!verifiedVendor) return;

  const vendorProducts = await VendorProduct.create([
    {
      vendor_id: verifiedVendor._id,
      title: "Rose Quartz Gua Sha",
      slug: "rose-quartz-gua-sha",
      price: 1299,
      sale_price: 999,
      sku: "ANAYA-GUA-001",
      stock_quantity: 26,
      category: "Beauty Tools",
      short_description: "Cooling facial sculpting tool",
      full_description: "Premium rose quartz gua sha crafted for a calming self-care ritual.",
      tags: ["gua sha", "wellness", "beauty"],
      weight: "120g",
      dimensions: "9x6x1 cm",
      status: "active",
      upload_status: "uploaded",
      approval_status: "approved",
      approved_at: new Date(),
      returnable: true,
      return_window_days: 7,
      return_liability: "vendor",
      returnable: true,
      return_window_days: 7,
      return_liability: "vendor",
      featured: false,
      bestseller: false,
      sort_order: 1,
      featured_image: "https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?auto=format&fit=crop&w=900&q=80",
      additional_images: [],
    },
    {
      vendor_id: verifiedVendor._id,
      title: "Botanical Sleep Mist",
      slug: "botanical-sleep-mist",
      price: 899,
      sale_price: 749,
      sku: "ANAYA-SLEEP-002",
      stock_quantity: 0,
      category: "Aromatherapy",
      short_description: "Bedtime pillow mist",
      full_description: "Lavender-led calming mist designed to elevate your nightly wind-down routine.",
      tags: ["sleep", "mist"],
      weight: "200ml",
      dimensions: "18x4x4 cm",
      status: "active",
      upload_status: "uploaded",
      approval_status: "pending_approval",
      approved_at: null,
      featured: false,
      bestseller: false,
      sort_order: 2,
      featured_image: "https://images.unsplash.com/photo-1515377905703-c4788e51af15?auto=format&fit=crop&w=900&q=80",
      additional_images: [],
    },
  ]);

  const approved = vendorProducts.find((product) => product.approval_status === "approved");
  if (approved) {
    const publicProduct = await publishVendorProduct(approved);
    approved.published_product_id = publicProduct._id;
    await approved.save();
  }

  await VendorUploadLog.create({
    vendor_id: verifiedVendor._id,
    file_name: "anaya-demo-upload.xlsx",
    total_rows: 2,
    success_rows: 2,
    failed_rows: 0,
    upload_status: "completed",
    error_json: [],
  });

  console.log("Vendor demo data seeded");
}

module.exports = { seedVendorDemoData };
