const fs = require('fs');
const os = require('os');
const path = require('path');

// sharp/librsvg need fontconfig to find fonts. Headless Linux containers (like Railway)
// often ship with zero system fonts, causing text to render as blank boxes. We bundle our
// own font and point fontconfig at it dynamically before sharp is required, so this works
// regardless of where the app is deployed.
const FONT_DIR = path.join(__dirname, '..', '..', 'assets', 'fonts');
const FONTCONFIG_DIR = path.join(os.tmpdir(), 'tbp-fontconfig');
const FONTCONFIG_FILE_PATH = path.join(FONTCONFIG_DIR, 'fonts.conf');

try {
  if (!fs.existsSync(FONTCONFIG_DIR)) fs.mkdirSync(FONTCONFIG_DIR, { recursive: true });
  const fontsConfXml = '<?xml version="1.0"?>\n' +
    '<!DOCTYPE fontconfig SYSTEM "fonts.dtd">\n' +
    '<fontconfig>\n' +
    '  <dir>' + FONT_DIR + '</dir>\n' +
    '  <cachedir>' + path.join(os.tmpdir(), 'tbp-fonts-cache') + '</cachedir>\n' +
    '</fontconfig>\n';
  fs.writeFileSync(FONTCONFIG_FILE_PATH, fontsConfXml);
  process.env.FONTCONFIG_FILE = FONTCONFIG_FILE_PATH;
} catch (err) {
  console.error('[WheelRenderer] Failed to set up fontconfig:', err.message);
}

const sharp = require('sharp');
const GIF = require('sharp-gif2');

/**
 * Builds the SVG markup for a single frame of the wheel at a given rotation.
 */
function buildWheelSVG(entries, colors, size, rotationDeg) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 4;
  const n = entries.length;
  const sliceAngle = 360 / n;
  let slices = '';
  let labels = '';

  for (let i = 0; i < n; i++) {
    const startAngle = i * sliceAngle;
    const endAngle = startAngle + sliceAngle;
    const startRad = (startAngle * Math.PI) / 180;
    const endRad = (endAngle * Math.PI) / 180;

    const x1 = cx + r * Math.cos(startRad);
    const y1 = cy + r * Math.sin(startRad);
    const x2 = cx + r * Math.cos(endRad);
    const y2 = cy + r * Math.sin(endRad);

    const color = colors[i % colors.length];
    const largeArc = sliceAngle > 180 ? 1 : 0;

    slices += `<path d="M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${largeArc} 1 ${x2},${y2} Z" fill="${color}" stroke="white" stroke-width="1"/>`;

    const midAngle = startAngle + sliceAngle / 2;
    const midRad = (midAngle * Math.PI) / 180;
    const labelR = r * 0.6;
    const lx = cx + labelR * Math.cos(midRad);
    const ly = cy + labelR * Math.sin(midRad);

    const fontSize = n > 24 ? 9 : Math.max(11, Math.min(20, size / (n * 1.3)));
    const maxChars = n > 30 ? 8 : 14;
    const cleanedText = stripEmoji(entries[i]) || entries[i];
    const displayText = cleanedText.length > maxChars
      ? cleanedText.slice(0, maxChars - 1) + '\u2026'
      : cleanedText;
    const textColor = getContrastTextColor(color);
    const strokeColor = textColor === '#000000' ? '#ffffff' : '#000000';

    labels += `<text x="${lx}" y="${ly}" font-size="${fontSize}" font-family="Roboto, sans-serif" font-weight="bold" fill="${textColor}" stroke="${strokeColor}" stroke-width="0.4" paint-order="stroke" text-anchor="middle" dominant-baseline="middle" transform="rotate(${midAngle} ${lx} ${ly})">${escapeXml(displayText)}</text>`;
  }

  // Pointer at the right side (3 o'clock), straddling the rim
  const pointerW = size * 0.045;
  const pointerL = size * 0.06;
  const tipX = cx + r - pointerL * 0.4;
  const baseX = cx + r + pointerL * 0.6;
  const pointer = `<polygon points="${tipX},${cy} ${baseX},${cy - pointerW} ${baseX},${cy + pointerW}" fill="black" stroke="white" stroke-width="3"/>`;

  const canvasWidth = size + size * 0.08;

  return `<svg width="${canvasWidth}" height="${size}" xmlns="http://www.w3.org/2000/svg">` +
    `<rect width="${canvasWidth}" height="${size}" fill="white"/>` +
    `<g transform="rotate(${rotationDeg} ${cx} ${cy})">${slices}${labels}</g>` +
    `<circle cx="${cx}" cy="${cy}" r="${r * 0.1}" fill="white" stroke="#333" stroke-width="2"/>` +
    pointer +
    `</svg>`;
}

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function stripEmoji(str) {
  // Remove emoji and other symbol characters that our bundled font can't render,
  // to avoid blank "missing glyph" boxes on the wheel.
  return String(str)
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')
    .replace(/[\u{2600}-\u{27BF}]/gu, '')
    .replace(/[\u{2190}-\u{21FF}]/gu, '')
    .replace(/[\u{2B00}-\u{2BFF}]/gu, '')
    .replace(/[\u{FE00}-\u{FE0F}]/gu, '')
    .replace(/[\u{200D}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getContrastTextColor(hexColor) {
  const hex = hexColor.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  // Relative luminance (per WCAG-ish approximation)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#000000' : '#ffffff';
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Given the entries array and the total rotation applied (in degrees),
 * returns the index of the entry that ends up under the pointer (right side, 0deg).
 */
function getWinnerIndex(entries, totalRotation) {
  const n = entries.length;
  const sliceAngle = 360 / n;
  const normalizedRotation = ((totalRotation % 360) + 360) % 360;
  const originalAngleAtPointer = (360 - normalizedRotation) % 360;
  return Math.floor(originalAngleAtPointer / sliceAngle) % n;
}

/**
 * Spins the wheel and returns an animated GIF buffer plus the winning entry.
 */
async function spinWheel(entries, colors, opts = {}) {
  if (!Array.isArray(entries) || entries.length < 2) {
    throw new Error('Wheel needs at least 2 entries.');
  }
  if (!Array.isArray(colors) || colors.length < 1) {
    throw new Error('Wheel needs at least 1 color.');
  }

  const size = opts.size || 450;
  const numFrames = opts.numFrames || 24;
  const fullSpins = opts.fullSpins || 4;
  const frameDelayMs = opts.frameDelayMs || 80;

  const n = entries.length;
  const sliceAngle = 360 / n;

  let targetIndex;
  if (typeof opts.forcedIndex === 'number' && opts.forcedIndex >= 0 && opts.forcedIndex < n) {
    targetIndex = opts.forcedIndex;
  } else {
    targetIndex = Math.floor(Math.random() * n);
  }

  const jitterFraction = 0.25 + Math.random() * 0.5;
  const targetAngleWithinSlice = targetIndex * sliceAngle + sliceAngle * jitterFraction;
  const totalRotation = fullSpins * 360 + (360 - targetAngleWithinSlice);

  const winnerIndex = getWinnerIndex(entries, totalRotation);
  const winner = entries[winnerIndex];

  const frames = [];
  for (let f = 0; f < numFrames; f++) {
    const t = f / (numFrames - 1);
    const rotation = easeOutCubic(t) * totalRotation;
    const svg = buildWheelSVG(entries, colors, size, rotation);
    frames.push(sharp(Buffer.from(svg)));
  }

  const gif = GIF.createGif({ delay: frameDelayMs, repeat: 1 });
  gif.addFrame(frames);
  const result = await gif.toSharp();
  const buffer = await result.gif().toBuffer();

  return { buffer, winner, winnerIndex };
}

module.exports = { spinWheel, buildWheelSVG, getWinnerIndex };
