/**
 * Script de build — génère sanctuary_hashes.json à partir des photos de référence.
 *
 * Usage :
 *   node scripts/generateSanctuaryHashes.js
 *
 * Structure attendue des dossiers :
 *   assets/sanctuary-references/
 *     01/   ← photos de la carte sanctuaire n°1
 *       photo1.jpg
 *       photo2.jpg
 *       ...
 *     02/
 *       ...
 *     53/
 *       ...
 *
 * Résultat :
 *   src/data/sanctuary_hashes.json
 */

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const HASH_H = 8;
const HASH_W = 9;

const REFS_DIR = path.join(__dirname, '../assets/sanctuary-references');
const OUTPUT_PATH = path.join(__dirname, '../src/data/sanctuary_hashes.json');

async function computeDHash(imagePath) {
  const { data, info } = await sharp(imagePath)
    .resize(HASH_W, HASH_H, { fit: 'fill' })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let hash = '';
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width - 1; x++) {
      const i = y * info.width + x;
      hash += data[i] > data[i + 1] ? '1' : '0';
    }
  }
  return hash;
}

async function main() {
  if (!fs.existsSync(REFS_DIR)) {
    console.error(`Dossier introuvable : ${REFS_DIR}`);
    process.exit(1);
  }

  const cardDirs = fs
    .readdirSync(REFS_DIR)
    .filter((d) => fs.statSync(path.join(REFS_DIR, d)).isDirectory())
    .sort((a, b) => parseInt(a) - parseInt(b));

  if (cardDirs.length === 0) {
    console.error('Aucun sous-dossier trouvé dans assets/sanctuary-references/');
    process.exit(1);
  }

  const result = {};
  let totalPhotos = 0;

  for (const dir of cardDirs) {
    const cardId = parseInt(dir);
    const cardPath = path.join(REFS_DIR, dir);
    const photos = fs
      .readdirSync(cardPath)
      .filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f))
      .map((f) => path.join(cardPath, f));

    if (photos.length === 0) {
      console.warn(`  ⚠️  Carte ${cardId} : aucune photo trouvée`);
      continue;
    }

    const hashes = [];
    for (const photo of photos) {
      try {
        const hash = await computeDHash(photo);
        hashes.push(hash);
        totalPhotos++;
      } catch (err) {
        console.warn(`  ⚠️  Erreur sur ${photo} : ${err.message}`);
      }
    }

    result[cardId] = { hashes };
    console.log(`  ✓ Carte ${cardId} : ${hashes.length} hash(es) générés`);
  }

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(result, null, 2));

  console.log(`\n✅ ${Object.keys(result).length} cartes, ${totalPhotos} photos → ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error('Erreur :', err);
  process.exit(1);
});
