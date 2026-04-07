/**
 * Script de build — génère sanctuary_hashes.json à partir des photos de référence.
 *
 * Usage :
 *   node scripts/generateSanctuaryHashes.js
 *
 * Deux structures acceptées :
 *
 * A) Dossier plat (une photo par carte) :
 *   assets/sanctuary-references/
 *     carte1.jpg
 *     carte2.jpg
 *     ...
 *   → IDs assignés automatiquement dans l'ordre alphabétique des fichiers.
 *
 * B) Sous-dossiers numérotés (plusieurs photos par carte) :
 *   assets/sanctuary-references/
 *     01/  photo1.jpg  photo2.jpg
 *     02/  photo1.jpg
 *     ...
 *   → ID = numéro du sous-dossier.
 *
 * Résultat :
 *   src/data/sanctuary_hashes.json
 *   src/data/sanctuary_id_map.json  (mode A : nom du fichier → ID attribué)
 */

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const HASH_H = 8;
const HASH_W = 9;
const IMAGE_EXTS = /\.(jpg|jpeg|png|webp)$/i;

const REFS_DIR = path.join(__dirname, '../assets/sanctuary-references');
const OUTPUT_HASHES = path.join(__dirname, '../src/data/sanctuary_hashes.json');
const OUTPUT_ID_MAP = path.join(__dirname, '../src/data/sanctuary_id_map.json');

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

  const entries = fs.readdirSync(REFS_DIR);
  const imageFiles = entries.filter((e) => IMAGE_EXTS.test(e));
  const subDirs = entries.filter((e) =>
    fs.statSync(path.join(REFS_DIR, e)).isDirectory()
  );

  const result = {};
  const idMap = {}; // nom de fichier → ID (mode plat uniquement)

  if (imageFiles.length > 0 && subDirs.length === 0) {
    // ── Mode A : dossier plat ──────────────────────────────────────────────
    console.log(`Mode plat détecté : ${imageFiles.length} photo(s) trouvée(s)\n`);
    const sorted = imageFiles.slice().sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    for (let i = 0; i < sorted.length; i++) {
      const filename = sorted[i];
      const cardId = i + 1;
      const filePath = path.join(REFS_DIR, filename);

      try {
        const hash = await computeDHash(filePath);
        result[cardId] = { hashes: [hash] };
        idMap[filename] = cardId;
        console.log(`  ✓ [${cardId}] ${filename}`);
      } catch (err) {
        console.warn(`  ⚠️  Erreur sur ${filename} : ${err.message}`);
      }
    }

    fs.writeFileSync(OUTPUT_ID_MAP, JSON.stringify(idMap, null, 2));
    console.log(`\n📋 Correspondance fichier → ID sauvegardée dans sanctuary_id_map.json`);

  } else if (subDirs.length > 0) {
    // ── Mode B : sous-dossiers numérotés ──────────────────────────────────
    console.log(`Mode sous-dossiers détecté : ${subDirs.length} carte(s)\n`);
    const sorted = subDirs.slice().sort((a, b) => parseInt(a) - parseInt(b));

    for (const dir of sorted) {
      const cardId = parseInt(dir);
      const cardPath = path.join(REFS_DIR, dir);
      const photos = fs.readdirSync(cardPath).filter((f) => IMAGE_EXTS.test(f));

      if (photos.length === 0) {
        console.warn(`  ⚠️  Carte ${cardId} : aucune photo`);
        continue;
      }

      const hashes = [];
      for (const photo of photos) {
        try {
          const hash = await computeDHash(path.join(cardPath, photo));
          hashes.push(hash);
        } catch (err) {
          console.warn(`  ⚠️  ${photo} : ${err.message}`);
        }
      }

      result[cardId] = { hashes };
      console.log(`  ✓ Carte ${cardId} : ${hashes.length} hash(es)`);
    }
  } else {
    console.error('Aucune image ou sous-dossier trouvé dans assets/sanctuary-references/');
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(OUTPUT_HASHES), { recursive: true });
  fs.writeFileSync(OUTPUT_HASHES, JSON.stringify(result, null, 2));

  const total = Object.values(result).reduce((acc, { hashes }) => acc + hashes.length, 0);
  console.log(`\n✅ ${Object.keys(result).length} cartes, ${total} hash(es) → sanctuary_hashes.json`);
}

main().catch((err) => {
  console.error('Erreur :', err);
  process.exit(1);
});
