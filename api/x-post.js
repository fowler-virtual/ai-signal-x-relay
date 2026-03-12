import crypto from 'node:crypto';
import OAuth from 'oauth-1.0a';

const REQUIRED_ENVS = [
  'RELAY_TOKEN',
  'X_CONSUMER_KEY',
  'X_CONSUMER_SECRET',
  'X_ACCESS_TOKEN',
  'X_ACCESS_TOKEN_SECRET',
];

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Relay-Token');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function maskToken(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const head = trimmed.slice(0, 6);
  const tail = trimmed.slice(-4);
  return `${head}…${tail} (${trimmed.length})`;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        reject(new Error('Body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function getMissingEnvs() {
  return REQUIRED_ENVS.filter(key => !process.env[key]);
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

function parseRelayRequest(input) {
  const endpoint = typeof input.endpoint === 'string' ? input.endpoint : '/2/tweets';
  const method = typeof input.method === 'string' ? input.method.toUpperCase() : 'POST';
  const body = input.body && typeof input.body === 'object' ? input.body : {};
  const meta = input.meta && typeof input.meta === 'object' ? input.meta : {};
  return { endpoint, method, body, meta };
}

function buildTweetText(body, meta) {
  if (typeof body.text === 'string' && body.text.trim()) {
    return body.text.trim();
  }

  const title = typeof meta.title === 'string' ? meta.title.trim() : '';
  const hashtags = Array.isArray(meta.hashtags)
    ? meta.hashtags.map(tag => String(tag).replace(/^#/, '').trim()).filter(Boolean)
    : [];
  const cta = typeof meta.cta === 'string' ? meta.cta.trim() : '';

  const parts = [title, hashtags.length > 0 ? hashtags.map(tag => `#${tag}`).join(' ') : '', cta].filter(Boolean);
  return parts.join('\n\n').trim();
}

function buildXUrl(endpoint) {
  const normalized = endpoint.startsWith('http') ? endpoint : `https://api.x.com${endpoint}`;
  return normalized;
}

function parseXSuccess(record) {
  const data = record?.data && typeof record.data === 'object' ? record.data : null;
  const externalPostId = typeof data?.id === 'string' ? data.id : '';
  if (!externalPostId) {
    return {
      success: false,
      error_code: 'invalid_relay_success',
      error_message: 'X response is missing data.id',
      retryable: false,
      raw_response: record,
    };
  }

  const postedAt = new Date().toISOString();
  return {
    success: true,
    external_post_id: externalPostId,
    posted_at: postedAt,
    external_post_url: `https://x.com/i/web/status/${externalPostId}`,
    raw_response: record,
  };
}

function parseXFailure(status, record) {
  const title = typeof record?.title === 'string' ? record.title : '';
  const detail = typeof record?.detail === 'string' ? record.detail : '';
  const errors = Array.isArray(record?.errors) ? record.errors : [];
  const firstError = errors[0] && typeof errors[0] === 'object' ? errors[0] : null;
  const errorCode = typeof firstError?.code === 'string'
    ? firstError.code
    : typeof firstError?.message === 'string'
      ? firstError.message.toLowerCase().replace(/\s+/g, '_')
      : status === 429
        ? 'rate_limit'
        : status >= 500
          ? 'x_server_error'
          : 'x_request_failed';
  const errorMessage = detail || title || (typeof firstError?.message === 'string' ? firstError.message : 'X request failed');
  return {
    success: false,
    error_code: errorCode,
    error_message: errorMessage,
    retryable: status === 429 || status >= 500,
    raw_response: {
      status,
      title,
      detail,
      first_error_code: firstError?.code ?? null,
      first_error_message: typeof firstError?.message === 'string' ? firstError.message : null,
      response: record,
    },
  };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Relay-Token');
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    return json(res, 405, {
      success: false,
      error_code: 'method_not_allowed',
      error_message: 'Use POST',
      retryable: false,
    });
  }

  const relayTokenHeader = req.headers['x-relay-token'];
  const relayToken = Array.isArray(relayTokenHeader) ? relayTokenHeader[0] : relayTokenHeader;
  const expectedRelayToken = process.env.RELAY_TOKEN?.trim();
  if (!expectedRelayToken || typeof relayToken !== 'string' || relayToken.trim() !== expectedRelayToken) {
    return json(res, 401, {
      success: false,
      error_code: 'unauthorized',
      error_message: 'Relay token is invalid',
      retryable: false,
      debug: {
        received: maskToken(relayToken),
        expected: maskToken(expectedRelayToken),
      },
    });
  }

  const missing = getMissingEnvs();
  if (missing.length > 0) {
    return json(res, 500, {
      success: false,
      error_code: 'relay_env_missing',
      error_message: `Missing env: ${missing.join(', ')}`,
      retryable: false,
    });
  }

  let payload;
  try {
    payload = parseRelayRequest(await readBody(req));
  } catch (error) {
    return json(res, 400, {
      success: false,
      error_code: 'invalid_request',
      error_message: error instanceof Error ? error.message : 'Invalid request body',
      retryable: false,
    });
  }

  const tweetText = buildTweetText(payload.body, payload.meta);
  if (!tweetText) {
    return json(res, 400, {
      success: false,
      error_code: 'empty_text',
      error_message: 'Tweet text is empty',
      retryable: false,
    });
  }

  const url = buildXUrl(payload.endpoint);
  const body = { text: tweetText };
  const oauth = createOAuthClient();
  const token = {
    key: process.env.X_ACCESS_TOKEN,
    secret: process.env.X_ACCESS_TOKEN_SECRET,
  };
  const auth = oauth.authorize({ url, method: payload.method, data: body }, token);
  const headers = {
    ...oauth.toHeader(auth),
    'Content-Type': 'application/json',
  };

  try {
    const response = await fetch(url, {
      method: payload.method,
      headers,
      body: JSON.stringify(body),
    });
    const text = await response.text();
    let record = {};
    try {
      record = text ? JSON.parse(text) : {};
    } catch {
      record = { raw: text };
    }

    if (response.ok) {
      return json(res, 200, parseXSuccess(record));
    }

    return json(res, response.status, parseXFailure(response.status, record));
  } catch (error) {
    return json(res, 502, {
      success: false,
      error_code: 'relay_network_error',
      error_message: error instanceof Error ? error.message : 'Relay request failed',
      retryable: true,
      raw_response: null,
    });
  }
}
