# ai-signal-x-relay

Minimal Vercel relay for `bird-dashboard`.

Current role:
- `POST /api/x-post` for live X posting
- `GET /api/official-signals` for low-cost official research feeds
- `GET /api/curator-signals` for low-cost curator research feeds

## Route

- `POST /api/x-post`
- `GET /api/official-signals`
- `GET /api/curator-signals`

## Required Vercel Environment Variables

- `RELAY_TOKEN`
- `X_CONSUMER_KEY`
- `X_CONSUMER_SECRET`
- `X_ACCESS_TOKEN`
- `X_ACCESS_TOKEN_SECRET`

These X credentials are required only for `POST /api/x-post`.

The research feed routes do not require X API credentials when using the current RSS/public-feed path.

## Optional Vercel Environment Variables

- `X_SIGNAL_RSS_BASE_URL`
  - Base RSS feed provider used for `official-signals` and `curator-signals`
  - Default: `https://rsshub.app/twitter/user`

- `X_OFFICIAL_SIGNAL_HANDLES`
  - Comma-separated X handles for official sources
  - Example: `OpenAI,OpenAIDevs,AnthropicAI`

- `X_CURATOR_SIGNAL_HANDLES`
  - Comma-separated X handles for curator/commentary sources
  - Example: `rowancheung,TheRundownAI,swyx`

- `X_OFFICIAL_SIGNAL_HANDLES_FEEDS`
  - Optional explicit feed URLs for official sources
  - If set, these override handle-based RSS URL construction

- `X_CURATOR_SIGNAL_HANDLES_FEEDS`
  - Optional explicit feed URLs for curator sources
  - If set, these override handle-based RSS URL construction

## Request contract

```json
{
  "endpoint": "/2/tweets",
  "method": "POST",
  "headers": {
    "Content-Type": "application/json",
    "X-Relay-Token": "optional"
  },
  "body": {
    "text": "tweet body"
  },
  "meta": {
    "title": "dashboard title",
    "hashtags": ["tag1", "tag2"],
    "cta": "call to action",
    "format_notes": "format notes"
  }
}
```

- The relay currently posts only `body.text`.
- If `body.text` is empty, it falls back to `meta.title + hashtags + cta`.

## Success response

```json
{
  "success": true,
  "external_post_id": "tweet-id",
  "posted_at": "2026-03-12T10:00:00.000Z",
  "external_post_url": "https://x.com/i/web/status/tweet-id",
  "raw_response": {}
}
```

## Error response

```json
{
  "success": false,
  "error_code": "rate_limit",
  "error_message": "Retry after 15 minutes",
  "retryable": true,
  "raw_response": {}
}
```

## Local development

```bash
npm install
vercel dev
```

## Deployment notes

1. Import this repo into Vercel.
2. Add the required environment variables.
3. Deploy.
4. Copy the deployment URL into `bird-dashboard` as `VITE_X_POST_RELAY_URL`.
5. Copy `RELAY_TOKEN` into `bird-dashboard` as `VITE_X_POST_RELAY_TOKEN`.

## Official signal feed

- `GET /api/official-signals`
- Uses public RSS/public-feed ingestion to fetch recent posts from official AI accounts.
- Optional env:
  - `X_OFFICIAL_SIGNAL_HANDLES` as a comma-separated list like `OpenAI,AnthropicAI,claudeai`
  - `X_OFFICIAL_SIGNAL_HANDLES_FEEDS` as explicit feed URLs when handle-based construction is not desirable
  - `X_SIGNAL_RSS_BASE_URL` to override the default RSS provider

Response shape:

```json
{
  "success": true,
  "source": "official",
  "count": 10,
  "items": [
    {
      "id": "official-123",
      "title": "tweet text",
      "text": "tweet text",
      "url": "https://x.com/OpenAI/status/123",
      "canonicalUrl": "https://x.com/OpenAI/status/123",
      "source": {
        "kind": "official",
        "name": "@OpenAI",
        "handle": "@OpenAI"
      },
      "published_at": "2026-03-12T10:00:00.000Z",
      "engagement": {
        "score": 0,
        "likes": 0,
        "reposts": 0,
        "replies": 0,
        "quotes": 0
      }
    }
  ]
}
```

## Curator signal feed

- `GET /api/curator-signals`
- Uses public RSS/public-feed ingestion to fetch recent posts from curator/commentary accounts.
- Optional env:
  - `X_CURATOR_SIGNAL_HANDLES` as a comma-separated list like `rowancheung,TheRundownAI,swyx`
  - `X_CURATOR_SIGNAL_HANDLES_FEEDS` as explicit feed URLs when handle-based construction is not desirable
  - `X_SIGNAL_RSS_BASE_URL` to override the default RSS provider

Response shape is the same as `official-signals`, but `source.kind` is `curator`.
