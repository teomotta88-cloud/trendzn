# ScrapeCreators API Research

## Current Status (As of 2026-08-27)

### Known Information

**What we know:**
- Currently using ScrapeCreators `/v1/tiktok/search/hashtag` endpoint
- Free tier: 100 credits, 1 credit per call (not per result)
- Used as fallback when Apify (clockworks/tiktok-hashtag-scraper) exhausts budget
- Generates randomized tracking parameters in share_url that need normalization
- More cost-effective than Apify for high-volume requests

**Current usage:**
```javascript
const url = `https://api.scrapecreators.com/v1/tiktok/search/hashtag?hashtag=${encodeURIComponent(tag)}`;
const res = await fetch(url, { headers: { "x-api-key": scrapeCreatorsKey } });
```

---

## Research Questions

### 1. Multi-Platform Support
**Question:** Does ScrapeCreators support Instagram, Facebook, and X/Twitter scraping?

**Status:** UNCONFIRMED

**How to verify:**
- [ ] Check official API documentation at https://scrapecreators.com/api-docs (if public)
- [ ] Attempt test calls to hypothetical endpoints:
  - `https://api.scrapecreators.com/v1/instagram/search/hashtag`
  - `https://api.scrapecreators.com/v1/facebook/search/page`
  - `https://api.scrapecreators.com/v1/x/search/hashtag`
- [ ] Contact ScrapeCre ators support for capabilities list
- [ ] Search GitHub issues/discussions for usage examples

**If NOT supported:**
- Continue with current DIY scrapers (Playwright for FB/IG, rettiwt for X)
- These are already in place and working reliably

**If supported:**
- Implement `backfill-instagram-hashtag.mjs`, `backfill-facebook-page.mjs`, `backfill-x-hashtag.mjs`
- Follow same cascade pattern as TikTok (Apify → ScrapeCreators for each platform)
- Update GitHub workflow to support all platforms

---

### 2. Pricing & Rate Limits

**Questions:**
- Are credit costs the same across platforms (1 credit/call)?
- Do free credits apply to all platforms or TikTok-only?
- Rate limit per minute across all platforms?
- Bulk request support?

**Status:** UNCONFIRMED

---

### 3. Data Quality

**Questions:**
- URL stability (do share URLs have tracking params like TikTok)?
- Content completeness (caption, engagement metrics, author info)?
- Date extraction (published_at field)?
- Media URLs included?

**Status:** UNCONFIRMED (TikTok working well, others unknown)

---

## Implementation Plan (Contingent)

### If ScrapeCreators Supports Multi-Platform:

**Files to create:**
- `scripts/backfill-instagram-hashtag.mjs` (parallel to TikTok)
- `scripts/backfill-facebook-page.mjs` (parallel to TikTok)
- `scripts/backfill-x-hashtag.mjs` (parallel to TikTok)

**Workflow updates:**
- `backfill-instagram-hashtag.yml`
- `backfill-facebook-hashtag.yml`
- `backfill-x-hashtag.yml`

**Common changes:**
- Import/extend openrouter.mjs for multi-source cascade logic
- Handle URL normalization per platform
- Map response fields to AccountRef schema
- Integrate with bluserena-monitoring.json sync

### If ScrapeCreators Does NOT Support Multi-Platform:

**Action:** Keep existing scrapers
- Instagram: `discover-instagram-hashtag-content.mjs` (Playwright + RSS-Bridge)
- X: `sync-x-posts.mjs` (rettiwt-api)
- Facebook: `sync-facebook-posts.mjs` (Playwright)

**Optimization opportunity:**
- Add retry logic and session caching to reduce rate-limit blocking
- Improve engagement data extraction accuracy

---

## Timeline for Research

**When to do this:**
- After Phase 4 baseline implementation (COMPLETE)
- Before implementing additional backfill scripts
- Dedicate 1-2 hours to API testing and documentation review

**Who should do this:**
- Backend engineer with API integration experience
- Has SCRAPECREATORS_API_KEY for testing

---

## References

- Current TikTok implementation: `scripts/backfill-tiktok-hashtag.mjs` (line 260-279)
- API key location: GitHub secrets → `SCRAPECREATORS_API_KEY`
- Usage in CI: `.github/workflows/backfill-tiktok-hashtag.yml`
