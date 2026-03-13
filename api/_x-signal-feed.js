import crypto from 'node:crypto';
import OAuth from 'oauth-1.0a';

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
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

function getHandles(envKey, defaults) {
  const raw = process.env[envKey] || '';
  const handles = raw
    .split(',')
    .map(item => item.trim().replace(/^@/, ''))
    .filter(Boolean);
  return handles.length > 0 ? handles : defaults;
}

function mapPostToSignal(tweet, user, sourceKind) {
  const username = user?.username || 'unknown';
  const name = user?.name || username;
  const id = tweet?.id || `${username}-${Date.now()}`;
  const text = typeof tweet?.text === 'string' ? tweet.text.replace(/\s+/g, ' ').trim() : '';
  const quotedId = Array.isArray(tweet?.referenced_tweets)
    ? tweet.referenced_tweets.find(item => item?.type === 'quoted')?.id
    : undefined;
  const retweetedId = Array.isArray(tweet?.referenced_tweets)
    ? tweet.referenced_tweets.find(item => item?.type === 'retweeted')?.id
    : undefined;
  const repliedId = Array.isArray(tweet?.referenced_tweets)
    ? tweet.referenced_tweets.find(item => item?.type === 'replied_to')?.id
    : undefined;
  const canonicalUrl = `https://x.com/${username}/status/${id}`;
  const referencedUrl = quotedId
    ? `https://x.com/i/web/status/${quotedId}`
    : retweetedId
      ? `https://x.com/i/web/status/${retweetedId}`
      : repliedId
        ? `https://x.com/i/web/status/${repliedId}`
        : undefined;

  return {
    id: `${sourceKind}-${id}`,
    title: text.slice(0, 160),
    text,
    url: canonicalUrl,
    canonicalUrl,
    referencedUrl,
    source: {
      kind: sourceKind,
      name,
      handle: `@${username}`,
    },
    published_at: tweet?.created_at || new Date().toISOString(),
    tags: [],
    engagement: {
      score: Number(tweet?.public_metrics?.like_count || 0)
        + Number(tweet?.public_metrics?.retweet_count || 0)
        + Number(tweet?.public_metrics?.quote_count || 0),
      likes: Number(tweet?.public_metrics?.like_count || 0),
      reposts: Number(tweet?.public_metrics?.retweet_count || 0),
      replies: Number(tweet?.public_metrics?.reply_count || 0),
      quotes: Number(tweet?.public_metrics?.quote_count || 0),
    },
  };
}

export async function handleSignalFeed(req, res, options) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.end();
    return;
  }

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
    const handles = getHandles(options.handlesEnvKey, options.defaultHandles);
    const userLookupUrl = `https://api.x.com/2/users/by?usernames=${encodeURIComponent(handles.join(','))}&user.fields=name,username`;
    const userLookup = await xGet(userLookupUrl);
    const users = Array.isArray(userLookup?.data) ? userLookup.data : [];

    const allSignals = [];
    for (const user of users) {
      const tweetsUrl = `https://api.x.com/2/users/${user.id}/tweets?max_results=5&exclude=retweets,replies&tweet.fields=created_at,public_metrics,referenced_tweets`;
      const tweetsResponse = await xGet(tweetsUrl);
      const tweets = Array.isArray(tweetsResponse?.data) ? tweetsResponse.data : [];
      for (const tweet of tweets) {
        allSignals.push(mapPostToSignal(tweet, user, options.sourceKind));
      }
    }

    allSignals.sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime());

    return json(res, 200, {
      success: true,
      source: options.sourceKind,
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
