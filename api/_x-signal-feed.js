function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function getHandles(envKey, defaults) {
  const raw = process.env[envKey] || '';
  const handles = raw
    .split(',')
    .map(item => item.trim().replace(/^@/, ''))
    .filter(Boolean);
  return handles.length > 0 ? handles : defaults;
}

function getFeedUrls(handlesEnvKey, defaults) {
  const explicitFeeds = process.env[`${handlesEnvKey}_FEEDS`] || '';
  const feedUrls = explicitFeeds
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);

  if (feedUrls.length > 0) return feedUrls;

  const baseUrl = (process.env.X_SIGNAL_RSS_BASE_URL || 'https://rsshub.app/twitter/user').replace(/\/$/, '');
  return getHandles(handlesEnvKey, defaults).map(handle => `${baseUrl}/${encodeURIComponent(handle)}`);
}

function decodeHtml(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripHtml(text) {
  return decodeHtml(text.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function getTagContent(block, tagName) {
  const match = block.match(new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, 'i'));
  return match?.[1]?.trim() || '';
}

function parseRssItems(xml) {
  const itemBlocks = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map(match => match[1]);
  return itemBlocks.map(block => {
    const title = stripHtml(getTagContent(block, 'title'));
    const link = decodeHtml(getTagContent(block, 'link'));
    const pubDate = getTagContent(block, 'pubDate');
    const description = stripHtml(getTagContent(block, 'description'));
    return { title, link, pubDate, description };
  }).filter(item => item.link && item.title);
}

function normalizeSourceName(url, fallbackKind) {
  try {
    const pathname = new URL(url).pathname;
    const lastSegment = pathname.split('/').filter(Boolean).at(-1);
    return lastSegment ? `@${decodeURIComponent(lastSegment)}` : fallbackKind;
  } catch {
    return fallbackKind;
  }
}

function buildSignal(item, feedUrl, sourceKind) {
  const canonicalUrl = item.link;
  const title = item.title.replace(/\s+/g, ' ').trim();
  const text = item.description || title;
  const idMatch = canonicalUrl.match(/status\/(\d+)/i);
  const id = idMatch?.[1] || `${sourceKind}-${Buffer.from(canonicalUrl).toString('base64').slice(0, 12)}`;

  return {
    id: `${sourceKind}-${id}`,
    title: title.slice(0, 160),
    text,
    url: canonicalUrl,
    canonicalUrl,
    referencedUrl: undefined,
    source: {
      kind: sourceKind,
      name: normalizeSourceName(feedUrl, sourceKind),
      handle: normalizeSourceName(feedUrl, sourceKind),
    },
    published_at: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
    tags: [],
    engagement: {
      score: 0,
      likes: 0,
      reposts: 0,
      replies: 0,
      quotes: 0,
    },
  };
}

async function fetchFeed(url) {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'User-Agent': 'bird-dashboard-ai-updates/1.0',
      'Accept': 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Feed fetch failed (${response.status}): ${url}`);
  }
  return text;
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

  try {
    const feedUrls = getFeedUrls(options.handlesEnvKey, options.defaultHandles);
    const allSignals = [];

    for (const feedUrl of feedUrls) {
      const xml = await fetchFeed(feedUrl);
      const items = parseRssItems(xml).slice(0, 5);
      for (const item of items) {
        allSignals.push(buildSignal(item, feedUrl, options.sourceKind));
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
      error: 'signal_fetch_failed',
      detail: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
