const PLACEHOLDER_EMAILS = new Set([
  "example@gmail.com",
]);

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function hasVerifiedContact(listing = {}) {
  const email = normalizeEmail(listing.email);
  return Boolean(email && !PLACEHOLDER_EMAILS.has(email));
}

function isPublicPinkPagesListing(listing = {}) {
  return listing.status === "active"
    && listing.verified === true
    && hasVerifiedContact(listing);
}

module.exports = {
  PLACEHOLDER_EMAILS,
  hasVerifiedContact,
  isPublicPinkPagesListing,
};
