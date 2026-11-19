# LLM note translation

Misskey can translate notes through DeepL or an OpenAI-compatible Chat Completions API. Existing installations continue to use DeepL until an administrator selects LLM translation.

## Setup

1. Build and deploy the updated server and client, applying the new database migration with the normal upgrade procedure (`pnpm migrate`).
2. Open **Control Panel → External services → Translation services**.
3. Select **LLM (OpenAI-compatible API)**.
4. Enter the API base URL, API key, and model, then save.

For OpenAI, use `https://api.openai.com/v1` as the base URL and a Chat Completions model such as `gpt-4o-mini`. Misskey appends `/chat/completions` to the base URL. Do not enter the full completion endpoint or include credentials, query parameters, or fragments in the URL.

For a compatible local server, use its OpenAI-compatible base URL, for example `http://localhost:11434/v1`. The API key can be empty if the server does not require authentication. Misskey's usual outgoing network restrictions still apply: explicitly allow the necessary local network in `allowedPrivateNetworks` in `.config/default.yml`. In a container, `localhost` refers to the Misskey container, not the host machine. Prefer HTTPS for remote providers.

Users use the existing **Translate** note action without an additional confirmation dialog. The `canUseTranslator` role policy and note visibility checks still apply. The endpoint allows up to 10 requests per user per minute. Selecting DeepL restores the existing DeepL integration; provider failures do not automatically send notes to another provider.

## Provider requirements

The provider must support `POST /chat/completions` with `model` and `messages` (system and user roles). No provider-specific SDK or structured-output extension is required. The model is instructed to return a JSON object containing the detected source language (`sourceLang`) and translated text (`text`). Invalid, empty, refused, and truncated responses are rejected. Requests time out after 60 seconds, and HTTP redirects are rejected. Each worker allows at most four in-flight LLM requests, with no waiting queue or retries. Input is limited to 32,768 UTF-16 code units, translated text to 65,536 code units, and HTTP responses to 1 MiB. The request sets `max_tokens: 8192`; choose a model that supports this Chat Completions parameter. These are per-request/per-worker limits, not a global billing quota.

## Privacy and costs

Translation sends the note text and content warning to the configured provider, including non-public notes when a user who can view them requests translation. Review the provider's retention policy and costs before enabling the feature, and inform users of the chosen service. Rate limits do not replace provider-side spending limits. Model instructions ask for preservation of MFM, links, mentions, hashtags, and emoji codes, but translation accuracy and formatting depend on the model.

API credentials are stored with the server settings and exposed only through the existing administrator-only settings API, not public instance metadata. Upstream LLM failures return the generic translation-unavailable error without forwarding provider error bodies or private note text.

## Saved translations

Apply the `NoteTranslation` migration before starting the updated server. Successful LLM translations are saved in PostgreSQL, including translations of restricted notes. Manual and automatic translation share these results across reloads, accounts, and server restarts. Misskey checks the requester’s translator role and access to the note before reading the cache. There is no backfill, and the DeepL integration is unchanged.

The cache keeps one result per note and target language (language codes are case-insensitive). If the note text, content warning, configured API URL, model, or translation logic changes, the next request replaces the old result. Rows do not expire and are deleted with the original note. Existing database backups can still contain translations of restricted or deleted notes; handle those backups as private data. Keep SQL parameter logging off in production so translated text is not written to query logs.

Failed translations are not stored. Matching requests within one worker share a pending request; simultaneous first requests on different workers can still reach the provider separately. The usual endpoint rate limit applies even to cache hits.
