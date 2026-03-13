import { handleSignalFeed } from './_x-signal-feed.js';

const DEFAULT_HANDLES = [
  'rowancheung',
  'TheRundownAI',
  'swyx',
  'nearcyan',
  'aidan_mclau',
];

export default async function handler(req, res) {
  return handleSignalFeed(req, res, {
    sourceKind: 'curator',
    handlesEnvKey: 'X_CURATOR_SIGNAL_HANDLES',
    defaultHandles: DEFAULT_HANDLES,
  });
}
