const Order = require("../models/Order");
const Product = require("../models/Product");
const VirtualProduct = require("../models/VirtualProduct");
const Workshop = require("../models/Workshop");
const WorkshopBooking = require("../models/WorkshopBooking");
const WorkshopSession = require("../models/WorkshopSession");
const QuoteRequest = require("../models/QuoteRequest");
const Poll = require("../models/Poll");
const Blog = require("../models/Blog");
const AffiliateEvent = require("../models/AffiliateEvent");
const AmazonReportRow = require("../models/AmazonReportRow");

function parseDateRange(from, to) {
  const range = {};

  if (from) {
    const fromDate = new Date(`${from}T00:00:00.000Z`);
    if (!Number.isNaN(fromDate.getTime())) {
      range.$gte = fromDate;
    }
  }

  if (to) {
    const toDate = new Date(`${to}T23:59:59.999Z`);
    if (!Number.isNaN(toDate.getTime())) {
      range.$lte = toDate;
    }
  }

  return Object.keys(range).length ? range : null;
}

const getAdminAnalytics = async (req, res) => {
  try {
    const from = String(req.query.from || "").trim();
    const to = String(req.query.to || "").trim();
    const createdAtRange = parseDateRange(from, to);
    const createdAtMatch = createdAtRange ? { createdAt: createdAtRange } : {};
    const sessionDateMatch = createdAtRange ? { session_date: createdAtRange } : {};
    const reportDateMatch = createdAtRange ? { report_date: createdAtRange } : {};

    const [
      orderStats,
      bookingStats,
      mostBookedRows,
      totalWorkshops,
      activeWorkshops,
      totalVirtualProducts,
      totalPhysicalProducts,
      lowStock,
      outOfStock,
      pollStats,
      totalBlogs,
      publishedBlogs,
      upcomingSessions,
      completedSessions,
      quoteRequests,
      convertedQuotes,
      affiliateEventStats,
      topAffiliateProducts,
      topAffiliateCategories,
      topAffiliateCampaigns,
      instagramAffiliateEvents,
      recentAffiliateClicks,
      affiliateExperimentStats,
      amazonReportSummary,
      topAmazonReportProducts,
    ] = await Promise.all([
      Order.aggregate([
        { $match: createdAtMatch },
        {
          $group: {
            _id: null,
            total_orders: { $sum: 1 },
            order_revenue: {
              $sum: {
                $cond: [{ $ne: ["$status", "cancelled"] }, "$total", 0],
              },
            },
          },
        },
      ]),
      WorkshopBooking.aggregate([
        { $match: createdAtMatch },
        {
          $group: {
            _id: null,
            total_bookings: { $sum: 1 },
            paid_bookings: {
              $sum: {
                $cond: [{ $eq: ["$payment_status", "paid"] }, 1, 0],
              },
            },
            booking_revenue: {
              $sum: {
                $cond: [{ $eq: ["$payment_status", "paid"] }, "$total", 0],
              },
            },
          },
        },
      ]),
      WorkshopBooking.aggregate([
        { $match: createdAtMatch },
        { $group: { _id: "$workshop_title", count: { $sum: 1 } } },
        { $sort: { count: -1, _id: 1 } },
        { $limit: 10 },
      ]),
      Workshop.countDocuments(createdAtMatch),
      Workshop.countDocuments({ ...createdAtMatch, status: "active" }),
      VirtualProduct.countDocuments(createdAtMatch),
      Product.countDocuments(createdAtMatch),
      Product.countDocuments({ stock_quantity: { $gt: 0, $lte: 5 } }),
      Product.countDocuments({ stock_quantity: 0 }),
      Poll.aggregate([
        { $match: createdAtMatch },
        {
          $group: {
            _id: null,
            total_polls: { $sum: 1 },
            total_votes: { $sum: { $add: ["$yes_count", "$no_count"] } },
          },
        },
      ]),
      Blog.countDocuments(createdAtMatch),
      Blog.countDocuments({ ...createdAtMatch, status: "published" }),
      WorkshopSession.countDocuments({ ...sessionDateMatch, status: { $in: ["planned", "confirmed"] } }),
      WorkshopSession.countDocuments({ ...sessionDateMatch, status: "completed" }),
      QuoteRequest.countDocuments(createdAtMatch),
      QuoteRequest.countDocuments({ ...createdAtMatch, status: "converted" }),
      AffiliateEvent.aggregate([
        { $match: createdAtMatch },
        {
          $group: {
            _id: "$event_type",
            count: { $sum: { $cond: ["$is_bot", 0, 1] } },
            bot_count: { $sum: { $cond: ["$is_bot", 1, 0] } },
          },
        },
      ]),
      AffiliateEvent.aggregate([
        { $match: { ...createdAtMatch, is_bot: false, product_id: { $ne: null } } },
        { $group: { _id: "$product_id", clicks: { $sum: { $cond: [{ $eq: ["$event_type", "outbound_click"] }, 1, 0] } }, views: { $sum: { $cond: [{ $eq: ["$event_type", "product_view"] }, 1, 0] } } } },
        { $sort: { clicks: -1, views: -1 } },
        { $limit: 10 },
        { $lookup: { from: "products", localField: "_id", foreignField: "_id", as: "product" } },
        { $unwind: { path: "$product", preserveNullAndEmptyArrays: true } },
        { $project: { product_id: "$_id", title: "$product.title", slug: "$product.slug", asin: "$product.affiliate_asin", marketplace: "$product.affiliate_marketplace", clicks: 1, views: 1 } },
      ]),
      AffiliateEvent.aggregate([
        { $match: { ...createdAtMatch, is_bot: false, category: { $nin: [null, ""] } } },
        { $group: { _id: "$category", clicks: { $sum: { $cond: [{ $eq: ["$event_type", "outbound_click"] }, 1, 0] } }, views: { $sum: { $cond: [{ $eq: ["$event_type", "product_view"] }, 1, 0] } } } },
        { $sort: { clicks: -1, views: -1, _id: 1 } },
        { $limit: 10 },
      ]),
      AffiliateEvent.aggregate([
        { $match: { ...createdAtMatch, is_bot: false, $or: [{ campaign_label: { $nin: [null, ""] } }, { utm_campaign: { $nin: [null, ""] } }] } },
        { $group: { _id: { $ifNull: ["$campaign_label", "$utm_campaign"] }, clicks: { $sum: { $cond: [{ $eq: ["$event_type", "outbound_click"] }, 1, 0] } }, views: { $sum: { $cond: [{ $eq: ["$event_type", "product_view"] }, 1, 0] } } } },
        { $sort: { clicks: -1, views: -1, _id: 1 } },
        { $limit: 10 },
      ]),
      AffiliateEvent.countDocuments({ ...createdAtMatch, is_bot: false, utm_source: /instagram/i }),
      AffiliateEvent.find({ ...createdAtMatch, event_type: "outbound_click" })
        .sort({ createdAt: -1 })
        .limit(10)
        .populate("product_id", "title slug affiliate_asin affiliate_marketplace")
        .lean(),
      AffiliateEvent.aggregate([
        { $match: { ...createdAtMatch, is_bot: false, experiment_name: { $nin: [null, ""] } } },
        {
          $group: {
            _id: { name: "$experiment_name", variant: "$experiment_variant" },
            views: { $sum: { $cond: [{ $eq: ["$event_type", "product_view"] }, 1, 0] } },
            clicks: { $sum: { $cond: [{ $eq: ["$event_type", "outbound_click"] }, 1, 0] } },
          },
        },
        { $sort: { "_id.name": 1, "_id.variant": 1 } },
      ]),
      AmazonReportRow.aggregate([
        { $match: reportDateMatch },
        {
          $group: {
            _id: null,
            rows: { $sum: 1 },
            ordered_items: { $sum: "$ordered_items" },
            shipped_items: { $sum: "$shipped_items" },
            returned_items: { $sum: "$returned_items" },
            revenue: { $sum: "$revenue" },
            commission: { $sum: "$commission" },
          },
        },
      ]),
      AmazonReportRow.aggregate([
        { $match: reportDateMatch },
        {
          $group: {
            _id: { product_id: "$product_id", asin: "$asin", marketplace: "$marketplace" },
            ordered_items: { $sum: "$ordered_items" },
            shipped_items: { $sum: "$shipped_items" },
            revenue: { $sum: "$revenue" },
            commission: { $sum: "$commission" },
          },
        },
        { $sort: { commission: -1, revenue: -1, shipped_items: -1 } },
        { $limit: 10 },
        { $lookup: { from: "products", localField: "_id.product_id", foreignField: "_id", as: "product" } },
        { $unwind: { path: "$product", preserveNullAndEmptyArrays: true } },
        { $project: { product_id: "$_id.product_id", title: "$product.title", slug: "$product.slug", asin: "$_id.asin", marketplace: "$_id.marketplace", ordered_items: 1, shipped_items: 1, revenue: 1, commission: 1 } },
      ]),
    ]);

    const orderSummary = orderStats[0] || {};
    const bookingSummary = bookingStats[0] || {};
    const pollSummary = pollStats[0] || {};
    const affiliateSummary = affiliateEventStats.reduce((acc, row) => {
      acc[row._id] = Number(row.count || 0);
      acc.bot_events += Number(row.bot_count || 0);
      return acc;
    }, { product_view: 0, cta_click: 0, outbound_click: 0, bot_events: 0 });
    const affiliateViews = Number(affiliateSummary.product_view || 0);
    const affiliateOutboundClicks = Number(affiliateSummary.outbound_click || 0);
    const amazonSummary = amazonReportSummary[0] || {};

    res.json({
      from: from || null,
      to: to || null,
      generated_at: new Date().toISOString(),
      order_revenue: Number(orderSummary.order_revenue || 0),
      booking_revenue: Number(bookingSummary.booking_revenue || 0),
      total_orders: Number(orderSummary.total_orders || 0),
      total_bookings: Number(bookingSummary.total_bookings || 0),
      paid_bookings: Number(bookingSummary.paid_bookings || 0),
      total_workshops: Number(totalWorkshops || 0),
      active_workshops: Number(activeWorkshops || 0),
      total_products: Number(totalVirtualProducts || 0) + Number(totalPhysicalProducts || 0),
      low_stock: Number(lowStock || 0),
      out_of_stock: Number(outOfStock || 0),
      total_polls: Number(pollSummary.total_polls || 0),
      total_votes: Number(pollSummary.total_votes || 0),
      total_blogs: Number(totalBlogs || 0),
      published_blogs: Number(publishedBlogs || 0),
      upcoming_sessions: Number(upcomingSessions || 0),
      completed_sessions: Number(completedSessions || 0),
      quote_requests: Number(quoteRequests || 0),
      converted_quotes: Number(convertedQuotes || 0),
      affiliate_disclaimer: "Site click data only. Amazon sales/commission data is not included.",
      amazon_report_disclaimer: "Imported Amazon Associates report data only. It is not inferred from site clicks.",
      affiliate_product_views: affiliateViews,
      affiliate_cta_clicks: Number(affiliateSummary.cta_click || 0),
      affiliate_outbound_clicks: affiliateOutboundClicks,
      affiliate_bot_events: Number(affiliateSummary.bot_events || 0),
      affiliate_ctr: affiliateViews > 0 ? Number(((affiliateOutboundClicks / affiliateViews) * 100).toFixed(2)) : 0,
      affiliate_instagram_events: Number(instagramAffiliateEvents || 0),
      affiliate_experiments: affiliateExperimentStats.map((row) => {
        const views = Number(row.views || 0);
        const clicks = Number(row.clicks || 0);
        return {
          experiment_name: row._id?.name || "Unknown experiment",
          experiment_variant: row._id?.variant || "unknown",
          views,
          clicks,
          ctr: views > 0 ? Number(((clicks / views) * 100).toFixed(2)) : 0,
        };
      }),
      amazon_report_summary: {
        rows: Number(amazonSummary.rows || 0),
        ordered_items: Number(amazonSummary.ordered_items || 0),
        shipped_items: Number(amazonSummary.shipped_items || 0),
        returned_items: Number(amazonSummary.returned_items || 0),
        revenue: Number(amazonSummary.revenue || 0),
        commission: Number(amazonSummary.commission || 0),
      },
      top_amazon_report_products: topAmazonReportProducts.map((row) => ({
        product_id: row.product_id?.toString?.() || null,
        title: row.title || "Unmatched Amazon report row",
        slug: row.slug || null,
        asin: row.asin || null,
        marketplace: row.marketplace || null,
        ordered_items: Number(row.ordered_items || 0),
        shipped_items: Number(row.shipped_items || 0),
        revenue: Number(row.revenue || 0),
        commission: Number(row.commission || 0),
      })),
      top_affiliate_products: topAffiliateProducts.map((row) => ({
        product_id: row.product_id?.toString?.() || null,
        title: row.title || "Unknown product",
        slug: row.slug || null,
        asin: row.asin || null,
        marketplace: row.marketplace || null,
        views: Number(row.views || 0),
        clicks: Number(row.clicks || 0),
        ctr: Number(row.views || 0) > 0 ? Number(((Number(row.clicks || 0) / Number(row.views || 0)) * 100).toFixed(2)) : 0,
      })),
      top_affiliate_categories: topAffiliateCategories.map((row) => ({
        category: row._id || "Uncategorized",
        views: Number(row.views || 0),
        clicks: Number(row.clicks || 0),
      })),
      top_affiliate_campaigns: topAffiliateCampaigns.map((row) => ({
        campaign: row._id || "Unlabeled",
        views: Number(row.views || 0),
        clicks: Number(row.clicks || 0),
      })),
      recent_affiliate_clicks: recentAffiliateClicks.map((row) => ({
        id: row._id.toString(),
        created_at: row.createdAt,
        product_title: row.product_id?.title || "Unknown product",
        product_slug: row.product_id?.slug || null,
        asin: row.product_id?.affiliate_asin || row.asin || null,
        marketplace: row.product_id?.affiliate_marketplace || row.marketplace || null,
        utm_source: row.utm_source || null,
        utm_campaign: row.utm_campaign || null,
        is_bot: Boolean(row.is_bot),
      })),
      most_booked: mostBookedRows.map((row) => ({
        workshop_title: row._id || "Untitled workshop",
        count: Number(row.count || 0),
      })),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = { getAdminAnalytics };
