// Génère public/logo.png et public/icons/* à partir de brand/logo-original.png :
// marges blanches rognées, carré, marge régulière, fond blanc.
// Usage : npm run icons   (après avoir remplacé brand/logo-original.png)
import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const src = fileURLToPath(new URL('../brand/logo-original.png', import.meta.url));
const out = fileURLToPath(new URL('../public/', import.meta.url));
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };
const trimmed = await sharp(src).trim({ threshold: 30 }).toBuffer();

async function icon(file, size, padding) {
  const inner = Math.round(size * (1 - 2 * padding));
  const logo = await sharp(trimmed).resize(inner, inner, { fit: 'contain', background: WHITE }).toBuffer();
  const offset = Math.round((size - inner) / 2);
  await sharp({ create: { width: size, height: size, channels: 4, background: WHITE } })
    .composite([{ input: logo, left: offset, top: offset }])
    .png({ compressionLevel: 9, palette: true, quality: 90 })
    .toFile(out + file);
  console.log(file.padEnd(28), `${size}×${size}`, `${(statSync(out + file).size / 1024).toFixed(1)} Ko`);
}

await icon('logo.png', 256, 0.08);                 // interface (barre du haut, connexion)
await icon('icons/favicon-64.png', 64, 0.04);      // onglet du navigateur
await icon('icons/apple-touch-icon.png', 180, 0.1);
await icon('icons/icon-192.png', 192, 0.08);
await icon('icons/icon-512.png', 512, 0.08);
await icon('icons/maskable-512.png', 512, 0.2);    // zone sûre : cercle de 80 %
