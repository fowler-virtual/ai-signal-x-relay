import crypto from 'node:crypto';
import OAuth from 'oauth-1.0a';

const DEFAULT_HANDLES = [
  'OpenAI',
  'OpenAIDevs',
  'OpenAINewsroom',
  'AnthropicAI',
  'claudeai',
  'perplexity_ai',
  'AskPerplexity',
  'cursor_ai',
  'AIatMeta',
  'openclaw',
];

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function createOAuthClient() {
  return new OAuth({
    consumer: {
      key: process.env.X_CONSUMER_KEY,
      secret: process.env.X_CONSUMER_SECRET,
    },
    signature_method: 'HMAC-SHA1',
    hash_function(baseString, key) {
      return crypto.createHmac('sha1', key).update(baseString).digest('base64');
    },
  });
}

function buildHeaders(url, method = 'GET') {
  const oauth = createOAuthClient();
  const token = {
    key: process.env.X_ACCESS_TOKEN,
    secret: process.env.X_ACCESS_TOKEN_SECRET,
  };
  const auth = oauth.authorize({ url, method }, token);
  return oauth.toHeader(auth);
}

async function xGet(url) {
  const response = await fetch(url, {
    method: 'GET',
    headers: buildHeaders(url, 'GET'),
  });
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!response.ok) {
    throw new Error(body?.detail || body?.title || `X GET failed: ${response.status}`);
  }
  return body;
}

function getHandles() {
  const raw = process.env.X_OFFICIAL_SIGNAL_HANDLES || '';
  const handles = raw
    .split(',')
    .map(item => item.trim().replace(/^@/, ''))
    .filter(Boolean);
  return handles.length > 0 ? handles : DEFAULT_HANDLES;
}

function mapPostToSignal(tweet, user) {
  const username = user?.username || 'unknown';
  const name = user?.name || username;
  const id = tweet?.id || `${username}-${Date.now()}`;
  const text = typeof tweet?.text === 'string' ? tweet.text.replace(/\s+/g, ' ').trim() : '';
  return {
    id: `official-${id}`,
    title: text.slice(0, 160),
    text,
    url: `https://x.com/${username}/status/${id}`,
    canonicalUrl: `https://x.com/${username}/status/${id}`,
    source: {
      kind: 'official',
      name,
      handle: `@${username}`,
    },
    published_at: tweet?.created_at || new Date().toISOString(),
    tags: [],
    engagement: {
      score: Number(tweet?.public_metrics?.like_count || 0) + Number(tweet?.public_metrics?.retweet_count || 0),
      likes: Number(tweet?.public_metrics?.like_count || 0),
      reposts: Number(tweet?.public_metrics?.retweet_count || 0),
      replies: Number(tweet?.public_metrics?.reply_count || 0),
      quotes: Number(tweet?.public_metrics?.quote_count || 0),
    },
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return json(res, 405, {
      success: false,
      error: 'method_not_allowed',
    });
  }

  const missing = [
    'X_CONSUMER_KEY',
    'X_CONSUMER_SECRET',
    'X_ACCESS_TOKEN',
    'X_ACCESS_TOKEN_SECRET',
  ].filter(key => !process.env[key]);

  if (missing.length > 0) {
    return json(res, 500, {
      success: false,
      error: 'missing_env',
      detail: missing,
    });
  }

  try {
    const handles = getHandles();
    const userLookupUrl = `https://api.x.com/2/users/by?usernames=${encodeURIComponent(handles.join(','))}&user.fields=name,username`;
    const userLookup = await xGet(userLookupUrl);
    const users = Array.isArray(userLookup?.data) ? userLookup.data : [];

    const allSignals = [];
    for (const user of users) {
      const tweetsUrl = `https://api.x.com/2/users/${user.id}/tweets?max_results=5&exclude=retweets,replies&tweet.fields=created_at,public_metrics`;
      const tweetsResponse = await xGet(tweetsUrl);
      const tweets = Array.isArray(tweetsResponse?.data) ? tweetsResponse.data : [];
      for (const tweet of tweets) {
        allSignals.push(mapPostToSignal(tweet, user));
      }
    }

    allSignals.sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime());

    return json(res, 200, {
      success: true,
      source: 'official',
      count: allSignals.length,
      items: allSignals,
    });
  } catch (error) {
    return json(res, 502, {
      success: false,
      error: 'x_fetch_failed',
      detail: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
