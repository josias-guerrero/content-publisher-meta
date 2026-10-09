# External endpoints

Configured Graph version is META_GRAPH_API_VERSION (default v21.0 retained from existing service). Do not interpret that default as certification of current support. Official source collections were consulted on 2026-10-07; some rendered pages provide only a JavaScript shell. All version/product-specific details require designated-account confirmation before enabling a format.

| Host/path | Method | Credential | Purpose/parameters | Result |
|---|---|---|---|---|
| api.instagram.com/oauth/access_token | POST | app secret + code | client_id, client_secret, grant_type, redirect_uri, code | short token, user ID |
| graph.instagram.com/access_token | GET | app secret + short token | ig_exchange_token | token, expires_in |
| graph.instagram.com/refresh_access_token | GET | Instagram token | ig_refresh_token | token, expires_in |
| graph.instagram.com/{version}/me | GET | Instagram | user_id, username, account_type | identity |
| graph.instagram.com/{version}/me/permissions | GET | Instagram | granted permission inspection | permissions/status |
| graph.instagram.com/{version}/{user}/media | POST | Instagram | image_url/video_url, media_type, children, is_carousel_item, caption, thumb_offset, cover_url as applicable | container ID |
| graph.instagram.com/{version}/{container} | GET | Instagram | fields=status_code | processing status |
| graph.instagram.com/{version}/{user}/media_publish | POST | Instagram | creation_id | final media ID |
| graph.facebook.com/{version}/oauth/access_token | GET | Facebook app/user | code exchange or fb_exchange_token | user token, expiry |
| graph.facebook.com/{version}/me | GET | user or page | fields=id | subject identity |
| graph.facebook.com/{version}/me/permissions | GET | user | permission inspection | grants |
| graph.facebook.com/{version}/me/accounts | GET | user | id,name,access_token,tasks; cursor pagination | page grants/tokens |
| graph.facebook.com/{version}/{page}/photos | POST | page | url, caption, published=false for draft | photo ID, post_id if published |
| graph.facebook.com/{version}/{page}/feed | POST | page | ordered attached_media and message | post ID |
| graph.facebook.com/{version}/{page}/videos | POST | page | file_url, description | asynchronous video ID |
| graph.facebook.com/{version}/{page}/video_reels | POST | page | start → upload → finish (PUBLISHED) | upload session/video ID |
| graph.facebook.com/{version}/{page}/photo_stories | POST | page | unpublished photo_id | post_id |
| graph.facebook.com/{version}/{page}/video_stories | POST | page | start → upload → finish | video ID/status |
| rupload.facebook.com (returned upload URL) | POST | page OAuth header | file_url header | accepted upload |
| graph.facebook.com/{version}/{video} | GET | page | fields=status | publishing phase |

Instagram publication uses instagram_business_content_publish, identity uses instagram_business_basic. Facebook discovery uses pages_show_list and eligible page tasks; publishing uses pages_manage_posts and applicable pages_read_engagement. Multiple scopes in one token do not prove each permission was exercised.

Client requests have per-call timeout and no implicit network retries for mutations. Non-JSON, auth, permission, rate, content and network failures are classified without logging returned messages containing secrets. Upload host is restricted to rupload.facebook.com. OAuth/token exchange host paths are not mechanically versioned.

Sources: [Meta Instagram collection](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api), [Meta Facebook collection](https://www.postman.com/meta/facebook/documentation/r56bjfd/facebook-api), [Create Reel](https://www.postman.com/meta/facebook/request/rgkn91u/1-create-reel), [Meta official PHP Page SDK](https://github.com/facebook/facebook-php-business-sdk/blob/main/src/FacebookAds/Object/Page.php). Real endpoint and permission evidence remains pending.
