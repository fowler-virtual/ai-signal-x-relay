# ai-signal-x-relay

Minimal Vercel relay for `bird-dashboard` X posting.

## Route

- `POST /api/x-post`

## Required Vercel Environment Variables

- `RELAY_TOKEN`
- `X_CONSUMER_KEY`
- `X_CONSUMER_SECRET`
- `X_ACCESS_TOKEN`
- `X_ACCESS_TOKEN_SECRET`

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
- Uses the relay's X app credentials to fetch recent posts from official AI accounts.
- Optional env:
  - `X_OFFICIAL_SIGNAL_HANDLES` as a comma-separated list like `OpenAI,AnthropicAI,claudeai`

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
        "name": "OpenAI",
        "handle": "@OpenAI"
      },
      "published_at": "2026-03-12T10:00:00.000Z",
      "engagement": {
        "score": 120,
        "likes": 100,
        "reposts": 10,
        "replies": 5,
        "quotes": 5
      }
    }
  ]
}
```
