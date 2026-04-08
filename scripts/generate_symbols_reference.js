/**
 * Génère assets/symbols_reference.png — une image composite avec les 5 symboles
 * côte à côte, utilisée comme référence visuelle pour Groq.
 *
 * Usage : node scripts/generate_symbols_reference.js
 * Dépendance : npm install --save-dev sharp
 */

const sharp = require('sharp');
const path  = require('path');

const ASSETS      = path.join(__dirname, '..', 'assets');
const SYMBOL_SIZE = 120;
const PADDING     = 16;

const symbols = [
  { file: 'stones.png',   label: 'STONE' },
  { file: 'chimeras.png', label: 'CHIMERA' },
  { file: 'thistles.png', label: 'THISTLE' },
  { file: 'indice.png',   label: 'CLUE' },
  { file: 'night.png',    label: 'NIGHT' },
];

async function main() {
  const resized = await Promise.all(
    symbols.map(({ file }) =>
      sharp(path.join(ASSETS, file))
        .resize(SYMBOL_SIZE, SYMBOL_SIZE, {
          fit: 'contain',
          background: { r: 255, g: 255, b: 255, alpha: 1 },
        })
        .flatten({ background: { r: 255, g: 255, b: 255 } })
        .png()
        .toBuffer()
    )
  );

  const totalWidth  = symbols.length * (SYMBOL_SIZE + PADDING) + PADDING;
  const totalHeight = SYMBOL_SIZE + PADDING * 2;

  const composites = resized.map((buffer, i) => ({
    input: buffer,
    left: PADDING + i * (SYMBOL_SIZE + PADDING),
    top:  PADDING,
  }));

  const outPath = path.join(ASSETS, 'symbols_reference.png');

  await sharp({
    create: {
      width:      totalWidth,
      height:     totalHeight,
      channels:   4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .composite(composites)
    .png()
    .toFile(outPath);

  console.log(`Created ${outPath}`);
  console.log(`Symbol order (left to right): ${symbols.map(s => s.label).join(', ')}`);
}

main().catch(console.error);
