// Static color palettes for the /wheel command.
// To add a new one, just add an entry here — name shows up in the dropdown.
const WHEEL_PALETTES = {
  'shades_of_purple': { label: 'Shades of Purple', colors: ['#efbbff', '#d896ff', '#be29ec', '#800080', '#660066'] },
  'princess_pink':    { label: 'Princess Pink',    colors: ['#ffc2cd', '#ff93ac', '#ff6289', '#fc3468', '#ff084a'] },
  'pastels':          { label: 'Pastels',          colors: ['#ffd4e5', '#d4ffea', '#eecbff', '#feffa3', '#dbdcff'] },
  'city_sunset':       { label: 'City Sunset',      colors: ['#eeaf61', '#fb9062', '#ee5d6c', '#ce4993', '#6a0d83'] },
  'kawaii_pastel':     { label: 'Kawaii Pastel',     colors: ['#ffdef2', '#f2e2ff', '#e2eeff', '#ddfffc', '#ffffe3'] },
  'vaporwave_neon':    { label: 'Vaporwave Neon',    colors: ['#ff00c1', '#9600ff', '#4900ff', '#00b8ff', '#00fff9'] },
  'violet':            { label: 'Violet',            colors: ['#ffffff', '#e5d0ff', '#dabcff', '#cca3ff', '#bf8bff'] },
  'blues':             { label: 'Blues',             colors: ['#77aaff', '#99ccff', '#bbeeff', '#5588ff', '#3366ff'] },
  'shades_of_pink':    { label: 'Shades of Pink',    colors: ['#ff00a9', '#fb9f9f', '#ff0065', '#ffbfd3', '#fb5858'] },
};

function getPaletteColors(key) {
  return WHEEL_PALETTES[key]?.colors || null;
}

function getPaletteChoices() {
  return Object.entries(WHEEL_PALETTES).map(([value, { label }]) => ({ name: label, value }));
}

module.exports = { WHEEL_PALETTES, getPaletteColors, getPaletteChoices };
