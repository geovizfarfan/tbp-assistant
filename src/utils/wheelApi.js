const { env } = require('node:process');

/**
 * Calls the Wheel of Names API to generate a spin animation.
 * entries: array of strings, or array of { text, weight }
 * colors: optional array of hex strings, applied round-robin to entries
 * Returns { animation: Buffer, imageFormat: 'webp', winner: { text, ... } }
 */
async function spinWheel(entries, colors) {
  colors = colors || null;
  const apiKey = env.WHEEL_OF_NAMES_API_KEY;
  if (!apiKey) throw new Error('WHEEL_OF_NAMES_API_KEY not set');

  const wheelEntries = entries.map(function(entry, i) {
    const obj = typeof entry === 'string' ? { text: entry } : { text: entry.text, weight: entry.weight };
    if (colors && colors.length) obj.color = colors[i % colors.length];
    return obj;
  });

  const response = await fetch('https://wheelofnames.com/api/v2/wheels/animate', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      wheelConfig: {
        entries: wheelEntries,
        spinTime: 3,
        maxNames: 120,
      },
      imageFormat: 'webp',
      responseFormat: 'formData',
      initialAngle: Math.random() * 2 * Math.PI,
    }),
  });

  if (!response.headers.get('Content-Type') || !response.headers.get('Content-Type').startsWith('multipart/form-data')) {
    if (response.headers.get('Content-Type') === 'application/json') {
      const data = await response.json();
      if (data && typeof data === 'object' && 'error' in data) {
        throw new Error(data.error);
      }
    }
    throw new Error('Wheel of Names API returned an invalid response.');
  }

  const formData = await response.formData();
  const winnerRaw = formData.get('winner');
  const winner = JSON.parse(winnerRaw ? winnerRaw.toString() : 'null');
  const file = formData.get('animation');
  if (!file || typeof file !== 'object') {
    throw new Error('Wheel of Names API returned an invalid response.');
  }
  const arrayBuffer = await file.arrayBuffer();

  return {
    animation: Buffer.from(arrayBuffer),
    imageFormat: 'webp',
    winner: winner,
  };
}

module.exports = { spinWheel };
