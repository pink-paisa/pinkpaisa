# Pink Paisa monetisation launch runbook

This release makes affiliate handoffs and consented quiz leads the only immediate revenue paths. It does not infer revenue from clicks and it does not enable direct payments, paid Pink Pages entitlements, digital downloads, or automatic social approval.

## Customer funnel

The canonical bio destination is `/start-here`:

1. Wealthness Quiz
2. Calculators
3. Curated Picks
4. Workshop Quote

`/instagram` redirects to `/start-here`. The product grid remains available at `/instagram/picks`.

Promoted product surfaces require all of the following:

- affiliate product is active and publicly visible;
- affiliate compliance is approved;
- `affiliate_is_instagram_pick=true`;
- latest link-health state is `ok`.

The public UI must show no general-catalog fallback when the curated set is empty. An administrator must fix the flags or link health explicitly.

## Quiz lead contract

The visitor receives the quiz result before any contact form is shown. The optional roadmap form stores only:

- result type;
- email/name and optionally WhatsApp number;
- separate email and WhatsApp consent evidence;
- consent version and timestamps;
- first-touch and last-touch attribution snapshots.

The twenty quiz answers are never sent to or stored by the lead API. Roadmap delivery uses a durable email outbox. Every email includes an unsubscribe path.

## Measurement truth

GA4 remains off unless a public measurement ID is supplied and analytics consent is granted. Website events are distinct:

- `view_item` records a product-detail view;
- `affiliate_cta_click` records an on-site CTA interaction;
- `affiliate_outbound_click` records the retailer redirect;
- `generate_lead` records a persisted consented lead;
- `purchase` records only an authoritative paid transaction.

Amazon clicks and imported Amazon commission remain separate. Do not label estimated click value as revenue.

## Direct-payment safety gate

PhonePe checkout is enabled only when both values are explicit:

```dotenv
PHONEPE_ENV=PRODUCTION
DIRECT_PAYMENTS_ENABLED=true
```

Keep `DIRECT_PAYMENTS_ENABLED=false` until production credentials, callback authentication, one real low-value payment, one failed payment, one refund, and receipt delivery have all been verified end to end.

Every PhonePe checkout creates a separate 256-bit payment-verification capability. Only its SHA-256 hash is stored on `PendingPayment`; the raw capability is returned once to the checkout page, retained in same-tab `sessionStorage`, and sent to `/api/phonepe/verify-payment` in `X-Payment-Verification-Secret`. Never place this capability, the merchant order ID, or a receipt token in a new return URL, analytics event, referrer, support screenshot or application log.

The verification endpoint accepts only an authenticated payment owner, an administrator, or the exact capability bound to that pending payment. A merchant order ID alone is not authorization. Legacy pending payments without a capability remain recoverable by their authenticated owner or an administrator; unauthenticated legacy guests must rely on the provider callback and confirmation email rather than exposing order data.

Cash-on-delivery order creation is unpaid and must never emit `purchase`. Wallet and PhonePe flows emit `purchase` only after the server reports an authoritative paid result.

Keep `DIGITAL_PRODUCTS_ENABLED=false` until digital-only checkout, entitlements, secure downloads, refunds and transactional fulfilment have been implemented and tested. Existing digital-product records remain available to administrators but are not public inventory.

## Public-form security

Configure a Cloudflare Turnstile widget and matching server secret:

```dotenv
# Frontend
NEXT_PUBLIC_TURNSTILE_SITE_KEY=...

# Server
CAPTCHA_PROVIDER=turnstile
TURNSTILE_SECRET=...
TURNSTILE_VERIFY_URL=https://challenges.cloudflare.com/turnstile/v0/siteverify
TURNSTILE_ALLOWED_HOSTNAMES=pinkpaisa.in,www.pinkpaisa.in
CAPTCHA_ALLOW_UNCONFIGURED=false
```

Production form submissions fail closed if the Turnstile secret is missing, the verified action does not match the form, or the hostname is not allowlisted. `CAPTCHA_ALLOW_UNCONFIGURED=true` is development-only.

Workshop confirmations require either authenticated ownership, administrator access, or a signed guest receipt token. A raw MongoDB identifier is not sufficient.

## Social cadence and approvals

The normal schedule is five feed posts and seven Story packages each week:

- Monday 11:00 IST
- Tuesday 18:00 IST
- Wednesday 11:00 IST
- Thursday 18:00 IST
- Friday 11:00 IST
- Saturday standalone Story
- Sunday standalone Story

Each weekday feed draft may have one companion Story. The feed and its companion are reviewed and scheduled together. Saturday and Sunday Stories require separate final approval. No draft is automatically approved or published.

Legacy Campaign Automation is also draft-only for this launch. Single-post and carousel automation may prepare reviewable drafts, but the server treats old `direct_publish` settings as `require_approval` and only considers products with `affiliate_is_instagram_pick=true` and link health `ok`.

## Required business confirmations

Before sending traffic, record answers to:

1. Is `@pinkpaisaofficial` the final public Instagram handle?
2. Is the Amazon Associates India account and `pinkpaisa07-21` tracking tag active and approved?
3. Which six to ten products are approved as flagship recommendations?
4. Is the primary audience all Indian women, or specifically women aged 35/40+?
5. Who may appear authentically on camera and how many clips can they record weekly?
6. Are all homepage “Trusted By” logos approved for public use?
7. Which sender address and team member owns lead follow-up?
8. What verified contact replaces the placeholder Pink Pages listing contact?

Before direct revenue is enabled, also record:

9. Are PhonePe production credentials approved?
10. Which finished digital product exists, with its file, price, rights and refund policy?
11. Which workshop can be delivered now, including owner, format, duration, price and cancellation terms?
12. Is Pink Pages ₹999/year approved, and which advertised benefits are operational?

## Release gate

Before deployment:

1. Run the complete server test suite.
2. Run frontend Vitest, TypeScript, ESLint and the production build.
3. Verify `/`, `/start-here`, `/instagram`, `/instagram/picks`, `/quiz`, `/workshops`, and `/pink-pages` at desktop and mobile widths.
4. Confirm retired Instagram handles do not occur in rendered HTML or JSON-LD.
5. Confirm curated product queries return only healthy Instagram picks.
6. Confirm quiz result rendering works without submitting a lead.
7. Confirm duplicate lead submissions are idempotent and unsubscribe works.
8. Confirm no PhonePe checkout starts while `DIRECT_PAYMENTS_ENABLED=false`.
9. Confirm no social draft can publish without final human approval.
