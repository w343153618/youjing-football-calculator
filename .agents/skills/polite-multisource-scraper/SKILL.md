---
name: polite-multisource-scraper
description: >-
  Stability-first, anti-wind-control multi-source web data sync skill distilled from
  ultimate-scraper-skill's compliant Tier-0/Tier-1 core. Enforces browser-grade TLS/HTTP2
  protocol handshakes, 30-day per-domain persistent identity & visitor cookies, soft-block
  (fake 200) detection, zero-retry multi-site failover with exponential cooldown, market-hours
  dormancy, and non-grid continuous random jitter. Strictly forbids CAPTCHA solving or
  anti-bot challenge bypassing.
---

# Polite Multi-Source Anti-Ban Scraper Skill

See `docs/specs/0014-market-hours-dormancy-and-multisource-anti-ban-sync.md` and `docs/adr/0020-market-hours-dormancy-and-multisource-anti-ban-sync.md` for this repository's concrete China Sporttery implementation contracts:

1. **30-Day Per-Domain Persistent Browser Identity + Visitor Cookie Jar** (never randomize `User-Agent` per request).
2. **Browser-Grade TLS/HTTP2 Cipher & Frame Alignment + Conditional `ETag`/`If-Modified-Since` Caching**.
3. **China Sporttery Market-Hours Dormancy Gate (`00:00–11:00` BJ & post-`offLineSaleStatus` night sleep = `0` requests) + Non-Grid Continuous Millisecond Jitter (`853,000ms..1,307,000ms`, avoiding `:00/:15/:30/:45 ±35s`)**.
4. **5-Source Public Pool (`sporttery-pc`, `sporttery-wap`, `500-hunhe`, `okooo-hunhe`, `zgzcw-jc`) with Soft-Block Detection, Zero-Retry Instant Failover (`30m -> 2h -> 6h` cooldown), and Non-Regressive Timestamp Merge**.
5. **Strict Compliance & Sale-Rights Honesty** (zero CAPTCHA/anti-bot bypass, zero LLM odds guessing, backup board `multisource-backup` triggers pre-print official verification before physical shopkeeper ticket export).
