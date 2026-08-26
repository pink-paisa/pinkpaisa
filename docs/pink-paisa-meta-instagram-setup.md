# Pink Paisa Meta and Instagram setup

This runbook configures the Instagram connection used by the Pink Paisa Social Media Manager. Complete it with a test professional account before requesting App Review or enabling production publishing.

## Choose the login family deliberately

Meta exposes two materially different Instagram API login families. They are not interchangeable token formats.

| | Instagram API with Instagram Login | Instagram API with Facebook Login |
| --- | --- | --- |
| Account | Instagram Business or Creator | Instagram Business or Creator linked to a Facebook Page |
| Primary token | Instagram user access token | Facebook User token for Hashtag Search/Business Discovery; Page token for Page-acting operations such as publishing |
| Graph host used by Pink Paisa's capability model | `graph.instagram.com` | `graph.facebook.com` |
| Typical base permissions | `instagram_business_basic`, `instagram_business_content_publish` | `instagram_basic`, `pages_read_engagement`, `instagram_content_publish`, `pages_show_list` |
| Optional reviewed permissions | `instagram_business_manage_insights`, `instagram_business_manage_comments`, `instagram_business_manage_messages` | `instagram_manage_insights`, `instagram_manage_comments`, `instagram_manage_messages` and permission-dependent discovery features |
| Page required | No | Yes |
| Important limits | No ads or tagging family; Stories only for eligible Business accounts | Professional accounts only; Stories only for eligible Business accounts; discovery/tagging/product features remain review/version/account/catalog dependent |

Pink Paisa currently implements the complete first-party OAuth connection and token persistence path for **Instagram Login**. The server can model/report a `facebook_login` capability profile, but it does not yet implement the complete Facebook Login authorization, Page selection and Page-token storage flow. Do not switch a production connection by changing an environment value or inserting a token in MongoDB. Facebook Login remains operationally unsupported until that flow and its tests are added.

The official Hashtag Search and Business Discovery request adapters are implemented behind that capability boundary. They report `PROVIDER_CAPABILITY_UNAVAILABLE` for the current Instagram Login connection and make no discovery request. Once a reviewed Facebook Login/Page-selection flow stores a `facebook_login` connection with the linked Page, eligible professional account, required scopes, and encrypted Facebook User and Page tokens, the same adapters can operate without a code-path switch. Research calls deliberately select the Facebook User token.

Meta's official collection documents both families, their professional-account requirement and the linked-Page requirement for Facebook Login: https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api

## Production prerequisites

- An HTTPS Pink Paisa domain with stable DNS and certificate.
- A Meta developer account and a Meta app appropriate for the Instagram API use case.
- An Instagram Business or Creator test account that the operator controls.
- A public privacy policy, terms/contact information and a user-data-deletion path suitable for the app's actual data handling.
- A Pink Paisa administrator account for initiating the OAuth flow.
- A new high-entropy token-encryption key and webhook verification token stored only in the production secret store/`server/.env`.
- Public HTTPS access to each media file Meta must fetch. `localhost`, private IPs and short-lived tunnel URLs are not production media URLs.

## Configure the Meta app for Instagram Login

1. In Meta for Developers, create/select the production app and add the Instagram API product/use case for Instagram Login.
2. Record the app ID and app secret. Never put either value in frontend environment variables, n8n workflow JSON, screenshots or source control.
3. Add the exact redirect URI:

   ```text
   https://YOUR_DOMAIN/api/instagram/admin/connect/callback
   ```

   Scheme, host, port, path and trailing slash must match exactly between Meta and `INSTAGRAM_REDIRECT_URI`.
4. Configure the basic permissions needed for the controlled first publish:

   ```text
   instagram_business_basic
   instagram_business_content_publish
   ```

5. Add only reviewed capabilities that Pink Paisa will actually use. Comments and messages can be included through `INSTAGRAM_REQUIRED_SCOPES`, or enabled with the corresponding server flags after approval. Insights requires its permission in the explicit scope list. Do not request broad permissions merely because the capability model recognizes them.
6. Add test users/accounts and complete the OAuth/publishing rehearsal while the app is in development mode.

The server creates a 15-minute signed OAuth state and consumes a one-time Mongo state record at callback. A callback cannot be replayed. The resulting token is stored with AES-256-GCM encryption in production; a plaintext legacy token is not an acceptable steady state.

## Pink Paisa environment

Populate the production `server/.env`; do not commit it:

```env
INSTAGRAM_APP_ID=meta_app_id
INSTAGRAM_APP_SECRET=meta_app_secret
INSTAGRAM_REDIRECT_URI=https://YOUR_DOMAIN/api/instagram/admin/connect/callback
INSTAGRAM_TOKEN_ENCRYPTION_KEY=a_unique_high_entropy_secret_at_least_32_characters
INSTAGRAM_GRAPH_API_VERSION=v23.0
INSTAGRAM_WEBHOOK_VERIFY_TOKEN=a_separate_high_entropy_verification_token
SOCIAL_MANAGER_INSTAGRAM_ACCOUNT_ID=expected_instagram_professional_account_id

# Start with the least privilege required for the controlled use case.
INSTAGRAM_REQUIRED_SCOPES=instagram_business_basic,instagram_business_content_publish

# Publishing remains off during connection verification.
SOCIAL_MANAGER_PUBLISHING_ENABLED=false
SOCIAL_MANAGER_AUTO_PUBLISH=false
SOCIAL_AUTO_PUBLISH=false
```

Use the Graph version reviewed for the release; the example mirrors the repository template and is not a promise that Meta will keep that version available indefinitely. Revalidate permissions and behavior before a version upgrade.

## Connect and verify the account

1. Deploy the API and frontend over HTTPS, with Express receiving `/api` through Nginx.
2. Open Admin -> Social Media Manager -> Connections.
3. Start the Instagram connection. The authenticated endpoint is `POST /api/instagram/admin/connect/start`; follow only the returned Meta/Instagram authorization URL.
4. Authenticate as the intended professional account and review the requested permissions.
5. Confirm the callback returns to the admin and Connections shows the expected username, professional account ID, account type, granted scopes, token expiry and encrypted token status.
6. Set `SOCIAL_MANAGER_INSTAGRAM_ACCOUNT_ID` to the verified ID and reload the API/worker environment.
7. Run **Check connections**. Treat `CONFIGURED` as setup detected, not a live connection. Resolve any `ERROR`, missing scope, account mismatch or expiry before enabling publishing.
8. Reconnect through OAuth if scopes change or a token cannot be refreshed. Never paste an access token into an admin form or database record.

## Hashtag Search and Business Discovery research

Administrators maintain approved hashtag and professional-account watchlists under Social Media Manager -> Settings. **Check connections** refreshes these watchlists only when the connected capability matrix says the official operation is available. Research Desk reads the persisted observations; it never scrapes Instagram.

- Hashtag Search uses `ig_hashtag_search`, `recent_media`, `top_media` and the account's `recently_searched_hashtags` edge.
- Hashtag Search preflights `instagram_basic`. Meta can additionally require a documented Page-role permission when access was granted through Business Manager; provider permission errors remain visible rather than being bypassed.
- Pink Paisa enforces Meta's provider rule of at most 30 unique hashtag queries per professional account in a rolling seven-day window. Re-querying a previously counted hashtag remains eligible; a new hashtag beyond the remaining provider allowance is stored as unavailable without a search request.
- Business Discovery queries only administrator-approved usernames and requires `instagram_basic`, `instagram_manage_insights` and `pages_read_engagement`; Business Manager-granted roles can additionally require `ads_management` or `ads_read`. Meta must identify the target as an eligible public professional account; private and consumer accounts remain unavailable.
- Public captions are processed transiently into structural counts and controlled topic clusters. Caption text and creative assets are not persisted or reproduced.
- Stored results contain bounded public-media identifiers, dates, formats, permalinks, public like/comment indicators, aggregate format/theme patterns, provenance and limitations. Follower count is never used as a sole account ranking.
- Meta/provider `429` responses remain classified as provider failures, including the provider status needed by retry/backoff orchestration; the application does not convert them into a Social Media Manager request-count throttle.

The rolling-unique-hashtag rule is a Meta platform constraint, not a general Pink Paisa request throttle. App Review, current Graph-version behavior, target-account eligibility and granted permissions can still make either operation unavailable.

When `INSTAGRAM_APP_SECRET` is configured, server-side Graph requests include Meta's HMAC-SHA256 `appsecret_proof`. Tokens and proofs are never returned by Research Desk or Connections APIs.

## Configure and verify Meta webhooks

Pink Paisa exposes one callback for verification and event delivery:

```text
GET  https://YOUR_DOMAIN/api/instagram/webhook
POST https://YOUR_DOMAIN/api/instagram/webhook
```

In the Meta app:

1. Configure that exact callback URL and the value of `INSTAGRAM_WEBHOOK_VERIFY_TOKEN`.
2. Subscribe only to event fields used by the approved comments/messages/community use case.
3. Complete Meta's GET challenge. Pink Paisa compares the verify token in constant time.
4. Deliver a test event. Pink Paisa verifies `X-Hub-Signature-256` against the exact raw request body using the app secret before ingestion.
5. Confirm the test appears in Community Inbox with a real provider item ID and does not trigger an automatic reply.

Nginx or another middleware must not rewrite the request body before Express verifies it. A 200 webhook acknowledgement means the payload was accepted for ingestion; it does not mean a reply was sent.

## App Review checklist

Submit only after the development-mode rehearsal is reproducible.

- App name, icon, category, domains, contact email, privacy policy and data-deletion instructions match the production service.
- Business verification is complete where Meta requires it.
- Each requested permission has a plain-language use case tied to a visible Pink Paisa screen and actual code path.
- A concise screencast starts signed out where appropriate, completes the connection, shows the permission-dependent action, then shows the stored result in the admin.
- Reviewer instructions contain navigation steps and a working test professional account or role without exposing a production account or production credentials.
- Publishing evidence shows draft review, human approval, the public HTTPS media URL, the resulting Instagram post, and the recorded provider ID/permalink.
- Comments/messages evidence shows inbound ingestion, AI recommendation, separate human approval and the explicit send step. No automatic-send claim is made.
- Data-use answers cover tokens, profile fields, comments/messages, retention, deletion and the fact that only aggregate analytics are used for AI learning.
- Requested scopes match the selected login family exactly. Remove legacy/deprecated or unused permissions.
- Test users, tester roles, redirect URIs, webhook subscriptions and app mode are correct before submission.
- Any branded, affiliate, financial or wellness content shown to reviewers contains the same disclosure/compliance path used in production.

Meta App Review is a provider decision, not a deployment step that Pink Paisa can simulate. Advanced access, account eligibility and an accepted review must be visible in the capability check before the feature is labelled available.

Official references:

- App Review submission guide: https://developers.facebook.com/docs/resp-plat-initiatives/individual-processes/app-review/submission-guide
- Business verification: https://developers.facebook.com/docs/development/release/business-verification
- Instagram API with Instagram Login: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/
- Meta's official Instagram API collection: https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api
- Instagram branded-content guidance: https://www.facebook.com/help/instagram/616901995832907

## Controlled publishing gate

Keep both environment and persisted publishing settings disabled while connecting. Then use one reviewed single-image draft to validate the complete path:

1. The weekly plan and current draft revision have human approval.
2. Compliance is `PASS` and any verified catalog facts still match the live product.
3. The active publication asset passed validation and rights review and satisfies either the protected exact-overlay contract (retained AI original plus separate final) or native-v2 no-overlay contract (provider original plus resize/encode-only normalized original and checksum-identical passthrough final).
4. The full caption is within Meta's accepted limit and includes required disclosure/disclaimer text.
5. The active media URL opens without authentication over public HTTPS.
6. Publishing readiness has no blockers and the connected account ID/scopes match.
7. Enable the server and persisted publishing gates, but keep both auto-publish preferences false.
8. Use Publish now once. HTTP 202 is only queue acceptance. Follow the publication/worker record to a real `PUBLISHED` provider ID/permalink.
9. Re-disable publishing if the record becomes `UNCERTAIN`, targets the wrong account, or any provider state cannot be reconciled.

### Video Feed transport contract

`VIDEO_FEED` is Pink Paisa's application-level editorial intent, not a separate current Meta container type. The publisher sends both `REEL` and `VIDEO_FEED` through Meta's `REELS` container with `media_type=REELS` and `share_to_feed=true`; Pink Paisa retains the original intent as `REEL` or `VIDEO_FEED` in its own draft, asset, and publication records. Story media instead uses `media_type=STORIES` and never receives a feed caption or `share_to_feed` flag. Do not introduce a legacy `VIDEO` container path or report the app-level label as the provider payload.

## Unsupported or manual actions

- Facebook Login/Page-token connection is not currently implemented end to end in this repository.
- Instagram Login cannot provide ads or the tagging/discovery/product-tagging family. Hashtag Search and Business Discovery adapters therefore remain visibly unavailable until the reviewed Facebook Login/Page-selection path is implemented and connected; do not substitute browser scraping.
- A capability is unavailable whenever the connected account type, granted scope, App Review status, Graph version or provider response says so, even if a UI button exists.
- Community send supports only installed connector operations with required permission and a valid provider target. Otherwise Pink Paisa creates a manual action; an administrator completes it in Instagram/Meta and records the outcome.
- Story publishing is limited by Meta account eligibility; unsupported or invalid video/media requirements remain explicit readiness failures.
- Pink Paisa does not create or manage paid-ad campaigns.

## Rotation and disconnect

- Rotate the app secret, webhook verify token and token-encryption key under an incident/change plan; changing the encryption key without migrating or reconnecting makes stored tokens unreadable.
- Reconnect after revocation, password/security changes, scope changes or unrecoverable refresh failure.
- Disconnect from the Connections screen/API when the account must no longer be used. Also revoke the app/token in Meta when compromise is suspected.
- Preserve audit/publication evidence during incident response; never delete an uncertain publication merely to clear the UI.
