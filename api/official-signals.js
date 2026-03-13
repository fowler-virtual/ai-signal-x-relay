import { handleSignalFeed } from './_x-signal-feed.js';

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

export default async function handler(req, res) {
  return handleSignalFeed(req, res, {
    sourceKind: 'official',
    handlesEnvKey: 'X_OFFICIAL_SIGNAL_HANDLES',
    defaultHandles: DEFAULT_HANDLES,
  });
}
