# App Review evidence

No Meta submit, permission approval, real publishing call, reviewer account or screencast was created in this implementation. Mocks are engineering evidence only. Keep unpublished formats disabled until all applicable checks pass.

| App/mode | Permission | Product operation | Endpoint family | Evidence needed |
|---|---|---|---|---|
| Instagram Login | instagram_business_basic | identify/select professional account | me | actual app ID, grant, timestamp, response trace |
| Instagram Login | instagram_business_content_publish | publish selected media format | media, media_publish | final media ID, real visible content, trace |
| Facebook Pages | pages_show_list | discover eligible pages | me/accounts | multiple-page discovery and explicit selection |
| Facebook Pages | pages_read_engagement | permitted page identity/read used by product | relevant approved read | panel attribution, response evidence |
| Facebook Pages | pages_manage_posts | photo/multiple/video/reel/story | photos/feed/videos/video_reels/stories | final accepted content and resource type |

For each execution capture app ID (public), mode, configured API version, permission/operation, timestamp, sanitized response/request trace, designated asset ID and final resource ID. Verify the permission panel window independently; do not infer use of every scope in a token. Separate permission evidence from format evidence.

Reviewer journey: login as a dedicated Tiko reviewer, select authorized client, connect Instagram or Facebook, accept scopes, select account/page, choose an enabled format, upload designated media, schedule, observe pending → publishing → published, open the actual social content. Also show cancellation and useful reconnection errors. Deliver reviewer credentials via a secure channel, not this repo. The video must not require a private team session.

Before submit, complete privacy region/providers/retention/backups, independent staging restore, real format eligibility, current Graph version support and product-specific callback settings. Do not request messaging/comments/ads/insights/WhatsApp permissions to justify capabilities outside this scope.
