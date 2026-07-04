function formatCurrency(amount) {
  return Number(amount || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function buildCommissionInvoiceHtml({ settlement, vendor }) {
  const vendorName = vendor?.shop_name || vendor?.business_name || vendor?.owner_name || "Vendor";
  const period = `${formatDate(settlement.period_start)} to ${formatDate(settlement.period_end)}`;
  const invoiceNumber = settlement?.invoice?.invoice_number || settlement?.settlement_number || "PP-COM";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${invoiceNumber}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 0; background: #fff9fb; color: #2d1b22; }
    .page { max-width: 920px; margin: 0 auto; padding: 32px; }
    .panel { background: #ffffff; border: 1px solid #efd5dc; border-radius: 20px; padding: 24px; box-shadow: 0 18px 40px rgba(174, 111, 132, 0.08); }
    .muted { color: #7f6470; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
    table { width: 100%; border-collapse: collapse; margin-top: 24px; }
    th, td { border: 1px solid #efd5dc; padding: 10px 12px; text-align: left; }
    th { background: #fff0f4; }
    .totals { width: 360px; margin-left: auto; margin-top: 24px; }
    .totals div { display: flex; justify-content: space-between; padding: 8px 0; }
  </style>
</head>
<body>
  <div class="page">
    <div class="panel">
      <div style="display:flex;justify-content:space-between;gap:20px;align-items:flex-start;">
        <div>
          <p class="muted" style="margin:0 0 8px;text-transform:uppercase;letter-spacing:0.14em;font-size:12px;">Pink Paisa vendor settlement invoice</p>
          <h1 style="margin:0;font-size:30px;">${invoiceNumber}</h1>
          <p class="muted" style="margin:12px 0 0;">Settlement ${settlement.settlement_number}</p>
        </div>
        <div style="text-align:right;">
          <p style="margin:0 0 8px;"><strong>Generated:</strong> ${formatDate(settlement.invoice?.generated_at || settlement.createdAt)}</p>
          <p style="margin:0;"><strong>Settlement period:</strong> ${period}</p>
        </div>
      </div>

      <div class="grid" style="margin-top:24px;">
        <div>
          <h3 style="margin:0 0 8px;">Billed To</h3>
          <p style="margin:0 0 6px;">${vendorName}</p>
          <p class="muted" style="margin:0 0 6px;">${vendor?.email || ""}</p>
          <p class="muted" style="margin:0;">${[vendor?.address, vendor?.city, vendor?.state, vendor?.pincode].filter(Boolean).join(", ")}</p>
        </div>
        <div>
          <h3 style="margin:0 0 8px;">Issued By</h3>
          <p style="margin:0 0 6px;">Pink Paisa</p>
          <p class="muted" style="margin:0 0 6px;">Marketplace commission invoice</p>
          <p class="muted" style="margin:0;">SAC 996319 · GST on marketplace services is shown separately when applicable.</p>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th>Description</th>
            <th>Qty</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Marketplace commission for ${Number(settlement.line_count || 0)} released order item(s) during ${period}</td>
            <td>${Number(settlement.line_count || 0)}</td>
            <td>₹${formatCurrency(settlement.commission_amount)}</td>
          </tr>
          <tr>
            <td>GST on commission</td>
            <td>18%</td>
            <td>₹${formatCurrency(settlement.commission_gst_amount)}</td>
          </tr>
          <tr>
            <td>TDS withheld</td>
            <td>1%</td>
            <td>₹${formatCurrency(settlement.tds_amount)}</td>
          </tr>
          <tr>
            <td>Chargebacks applied</td>
            <td>—</td>
            <td>₹${formatCurrency(settlement.chargeback_amount)}</td>
          </tr>
        </tbody>
      </table>

      <div class="totals">
        <div><span class="muted">Gross sale value</span><strong>₹${formatCurrency(settlement.gross_amount)}</strong></div>
        <div><span class="muted">Commission retained</span><strong>₹${formatCurrency(settlement.commission_amount)}</strong></div>
        <div><span class="muted">GST on commission</span><strong>₹${formatCurrency(settlement.commission_gst_amount)}</strong></div>
        <div><span class="muted">TDS</span><strong>₹${formatCurrency(settlement.tds_amount)}</strong></div>
        <div><span class="muted">Chargebacks</span><strong>₹${formatCurrency(settlement.chargeback_amount)}</strong></div>
        <div style="border-top:1px solid #efd5dc;padding-top:12px;font-size:18px;"><span><strong>Net payable to vendor</strong></span><strong>₹${formatCurrency(settlement.net_payable)}</strong></div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

module.exports = {
  buildCommissionInvoiceHtml,
};
