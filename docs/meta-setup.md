# Meta setup

Observed public app IDs: Instagram `908467498979280` (`content-publisher-IG`), Facebook `876096402024366` (`content-publisher`). Configure runtime with the intended app; never copy App Secrets into this document.

Instagram Login requests instagram_business_basic and instagram_business_content_publish. Facebook Pages requests pages_show_list, pages_read_engagement and pages_manage_posts. No messaging, comments, ads, insights, WhatsApp or business_management scopes are added.

Register exact callback origins and paths:

- https://publisher.tikocloud.com/auth/instagram/callback
- https://publisher.tikocloud.com/auth/facebook/callback
- Corresponding deauthorization: /meta/instagram/deauthorize and /meta/facebook/deauthorize
- Data deletion: /meta/instagram/data-deletion and /meta/facebook/data-deletion
- Tiko privacy: https://tikocloud.com/privacidad
- Tiko deletion information: https://tikocloud.com/eliminacion-de-datos

Use each app's own secret for signed_request callbacks. Verify callback eligibility/requirements in the selected product; these paths are supported by this service, not asserted universally mandatory. Configure test app/roles and designated assets before production. Facebook Login for Business config_id is not fabricated or added: confirm if the actual product requires it; that product-specific configuration remains a rollout gate.

OAuth callbacks always use PUBLIC_BASE_URL, never external forwarded headers. Declined or incomplete permissions fail authorization; pages require CREATE_CONTENT/MANAGE-compatible tasks. Check real consent and `/me/permissions` behavior for each configured app before promotion.

Official references: [Instagram Login](https://www.postman.com/meta/instagram/folder/6raa77c/instagram-api-with-instagram-login), [Facebook API](https://www.postman.com/meta/facebook/documentation/r56bjfd/facebook-api). Reviewed 2026-10-07; live calls and panel evidence have not been performed in this work.
