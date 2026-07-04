const VENDOR_BANK_PAYOUT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

function hasCompleteVendorBankDetails(vendor) {
  return Boolean(
    vendor?.bank_details?.account_holder_name &&
    vendor?.bank_details?.account_number &&
    vendor?.bank_details?.ifsc_code &&
    vendor?.bank_details?.bank_name
  );
}

function getVendorBankCooldownEndsAt(vendor) {
  if (!vendor?.bank_changed_at) return null;
  const changedAt = new Date(vendor.bank_changed_at);
  if (Number.isNaN(changedAt.getTime())) return null;
  return new Date(changedAt.getTime() + VENDOR_BANK_PAYOUT_COOLDOWN_MS);
}

function getVendorBankPayoutBlockReason(vendor, now = new Date()) {
  if (!hasCompleteVendorBankDetails(vendor)) {
    return "Complete your payout bank details before Pink Paisa can release settlements.";
  }

  if (!vendor?.bank_verified) {
    return "Payouts are paused because your bank details are awaiting admin verification.";
  }

  const cooldownEndsAt = getVendorBankCooldownEndsAt(vendor);
  if (cooldownEndsAt && cooldownEndsAt.getTime() > now.getTime()) {
    return `Payouts are paused for 24 hours after a bank change. Cooldown ends on ${cooldownEndsAt.toLocaleString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })}.`;
  }

  return null;
}

function hasVerifiedVendorBank(vendor, now = new Date()) {
  return !getVendorBankPayoutBlockReason(vendor, now);
}

module.exports = {
  VENDOR_BANK_PAYOUT_COOLDOWN_MS,
  hasCompleteVendorBankDetails,
  getVendorBankCooldownEndsAt,
  getVendorBankPayoutBlockReason,
  hasVerifiedVendorBank,
};
