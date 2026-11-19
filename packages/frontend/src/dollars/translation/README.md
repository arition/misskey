# Timeline auto-translation

Opt in through the main timeline's **Options (⋯) → Auto-translate timeline** switch.
The preference defaults to off and is scoped to the current account. Enabling it
requires confirmation that note text and CWs, including non-public notes, are sent
to the instance's configured translation provider and may incur charges.

The switch uses `_timelineTranslation` locale keys. Only the Japanese source
locale is maintained here; other languages use the normal locale fallback until
Crowdin supplies translations. No Crowdin-managed YAML files are edited.

## Behavior

- Only rendered, visible notes on the main timeline or a user profile are
  submitted. This includes pinned notes, the profile overview feed, and the
  Notes tab. Muted, hidden, deleted, plugin-hidden, collapsed-renote, and mock
  notes are excluded. Emoji-only, punctuation-only, and other notes without
  translatable text are skipped without a loading indicator. A one-character
  word or a text CW is still eligible.
- CW-hidden notes are not submitted until the user opens their contents.
- The original text remains visible. An inline parent post above a reply can also
  be translated once its preview is visible and its own CW is open, if present.
- Background tabs and deactivated cached pages stop requesting translations.
- Scrolling offscreen, disabling the switch, and unmounting cancel that note's
  queued subscription. Shared requests stop only when their last subscriber leaves.
- Failures appear inline; the existing per-note Translate action remains available.
  There are no automatic retry loops or provider fallbacks.

## Limits and cache

The client batches lookups for saved LLM translations independently of the provider
queue. Cache hits display together without waiting for new translations. Misses
fall back to a tab-local queue with at least eight seconds between request starts,
leaving headroom under the existing 10/minute endpoint limit.
Other tabs and manual requests still share the server's limit; a server rate-limit
error pauses automatic requests for 65 seconds. The queue is bounded at 40 jobs,
and each outgoing request has a 65-second client timeout.

Successful results (including empty responses) are cached in memory for five
minutes, with at most 100 entries. Keys include account ID, note ID, full text, CW,
and target language, so reposts share results but accounts, languages, and edited
content do not. Failures are suppressed for one minute to avoid repeated requests
while scrolling. No note text or translations are persisted to browser storage.
Provider-setting changes may take up to the cache TTL to affect an existing tab.

Automatic translation uses the server endpoint and its existing visibility and
role checks, regardless of the experimental browser-translation preference. It
does not add OCR, translate media, or automatically translate quotes or full
threads outside those note lists.
The initial source language is detected by the configured provider; notes already
in the target language can still consume a translation request.

## Checks

From the repository root:

```sh
pnpm --filter i18n generate
pnpm --filter i18n build
pnpm --filter frontend test timeline-translation
pnpm --filter frontend typecheck
pnpm --filter frontend build
node scripts/check-shipping.mjs --base 2026.11.0
```

Tests mock all provider calls and do not spend API credits. A production image
build, deployment, application restart, and real-provider smoke test each require
separate approval.
