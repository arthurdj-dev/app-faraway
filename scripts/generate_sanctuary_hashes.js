/**
 * Génère src/data/sanctuary_hashes.json
 *
 * Pour chaque carte sanctuaire (1–53), lit TOUTES les photos du dossier
 * assets/sanctuary-references/sanctuaire-{id:02d}/, calcule un pHash
 * par photo, et stocke tous les hashes de la carte.
 *
 * Au matching, on prend la distance minimale parmi tous les hashes de référence.
 *
 * Usage : node scripts/generate_sanctuary_hashes.js
 * Dépendance : sharp (npm install --save-dev sharp)
 */

const sharp = require('sharp');
const path  = require('path');
const fs    = require('fs');

const ASSETS    = path.join(__dirname, '..', 'assets', 'sanctuary-references');
const OUT_FILE  = path.join(__dirname, '..', 'src', 'data', 'sanctuary_hashes.json');
const TOTAL     = 53;
const DCT_SIZE  = 32;
const HASH_BITS = 8;

// ─── DCT 2D ────────────────────────────────────────────────────────────────

function dct2D(pixels) {
  const result = new Float32Array(HASH_BITS * HASH_BITS);
  for (let u = 0; u < HASH_BITS; u++) {
    for (let v = 0; v < HASH_BITS; v++) {
      let sum = 0;
      for (let x = 0; x < DCT_SIZE; x++) {
        for (let y = 0; y < DCT_SIZE; y++) {
          sum += pixels[y * DCT_SIZE + x]
            * Math.cos(((2 * x + 1) * u * Math.PI) / (2 * DCT_SIZE))
            * Math.cos(((2 * y + 1) * v * Math.PI) / (2 * DCT_SIZE));
        }
      }
      const cu = u === 0 ? 1 / Math.sqrt(2) : 1;
      const cv = v === 0 ? 1 / Math.sqrt(2) : 1;
      result[v * HASH_BITS + u] = (2 / DCT_SIZE) * cu * cv * sum;
    }
  }
  return result;
}

async function computeHash(filePath) {
  const { data } = await sharp(filePath)
    .resize(DCT_SIZE, DCT_SIZE, { fit: 'fill' })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = new Float32Array(DCT_SIZE * DCT_SIZE);
  for (let i = 0; i < pixels.length; i++) pixels[i] = data[i];

  const dctVals = dct2D(pixels);

  let sum = 0;
  for (let i = 1; i < dctVals.length; i++) sum += dctVals[i];
  const mean = sum / (dctVals.length - 1);

  let hash = '';
  for (let i = 0; i < dctVals.length; i++) {
    hash += i === 0 ? '0' : dctVals[i] >= mean ? '1' : '0';
  }
  return hash;
}

async function main() {
  const result  = {};
  const missing = [];

  for (let id = 1; id <= TOTAL; id++) {
    const padded  = String(id).padStart(2, '0');
    const folder  = path.join(ASSETS, `sanctuaire-${padded}`);

    if (!fs.existsSync(folder)) {
      missing.push(id);
      console.warn(`  MISSING folder: sanctuaire-${padded}`);
      continue;
    }

    const files = fs.readdirSync(folder)
      .filter(f => /\.(jpe?g|png)$/i.test(f))
      .map(f => path.join(folder, f));

    if (files.length === 0) {
      missing.push(id);
      console.warn(`  EMPTY folder: sanctuaire-${padded}`);
      continue;
    }

    const hashes = [];
    for (const file of files) {
      try {
        hashes.push(await computeHash(file));
      } catch (err) {
        console.error(`  ERROR on ${path.basename(file)}: ${err.message}`);
      }
    }

    if (hashes.length > 0) {
      result[id] = hashes;
      console.log(`  [${padded}] ${hashes.length} hash(es)`);
    }
  }

  fs.writeFileSync(OUT_FILE, JSON.stringify(result, null, 2));
  console.log(`\nSaved ${Object.keys(result).length} cards to ${OUT_FILE}`);
  if (missing.length) console.warn(`Missing cards: ${missing.join(', ')}`);
}

main().catch(console.error);
