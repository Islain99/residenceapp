// Génère le logo et les icônes à partir de brand/logo-original.png (fond blanc).
// Usage : npm run icons   (après avoir remplacé brand/logo-original.png)
//
//   public/logo.png             interface, thème clair : fond transparent
//   public/logo-dark.png        interface, thème sombre : fond transparent, bleu marine éclairci
//   public/icons/favicon-64.png onglet du navigateur : fond transparent
//   public/icons/*.png          application installée (Android, iPhone) : fond blanc
//                               opaque, car le système découpe lui-même l'icône
import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const src = fileURLToPath(new URL('../brand/logo-original.png', import.meta.url));
const out = fileURLToPath(new URL('../public/', import.meta.url));
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };
const CLEAR = { r: 0, g: 0, b: 0, alpha: 0 };
// Bleu marine du logo remplacé en thème sombre (lisible sur les surfaces sombres)
const DARK_THEME_NAVY = [207, 224, 245];

// Marges blanches rognées
const trimmed = await sharp(src).trim({ threshold: 30 }).toBuffer();

// « Couleur vers transparence » : le blanc devient transparent, les bords
// adoucis gardent leur couleur avec une transparence partielle (pas de liseré
// blanc sur un fond sombre). Option : remplacer le bleu marine.
async function transparent(navy) {
  const { data, info } = await sharp(trimmed).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const rgba = Buffer.alloc(info.width * info.height * 4);
  for (let i = 0, j = 0; i < data.length; i += 3, j += 4) {
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
    const alpha = Math.max(255 - r, 255 - g, 255 - b) / 255;
    if (alpha < 0.02) continue;   // blanc : reste transparent
    let color = [r, g, b].map((c) => Math.round(255 - (255 - c) / alpha));
    // Bleu marine : bleu dominant, vert faible (le vert d'eau a un vert élevé)
    if (navy && color[2] > color[0] + 40 && color[1] < 120) color = navy;
    rgba[j] = color[0]; rgba[j + 1] = color[1]; rgba[j + 2] = color[2];
    rgba[j + 3] = Math.round(alpha * 255);
  }
  return sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

async function icon(file, size, padding, logo, background) {
  const inner = Math.round(size * (1 - 2 * padding));
  const fitted = await sharp(logo).resize(inner, inner, { fit: 'contain', background: CLEAR }).toBuffer();
  const offset = Math.round((size - inner) / 2);
  await sharp({ create: { width: size, height: size, channels: 4, background } })
    .composite([{ input: fitted, left: offset, top: offset }])
    .png({ compressionLevel: 9, palette: true, quality: 90 })
    .toFile(out + file);
  console.log(file.padEnd(28), `${size}×${size}`, `${(statSync(out + file).size / 1024).toFixed(1)} Ko`);
}

const light = await transparent(null);
const dark = await transparent(DARK_THEME_NAVY);

await icon('logo.png', 256, 0, light, CLEAR);               // interface : sans marge, il ressort
await icon('logo-dark.png', 256, 0, dark, CLEAR);
await icon('icons/favicon-64.png', 64, 0, light, CLEAR);    // onglet du navigateur
await icon('icons/apple-touch-icon.png', 180, 0.1, light, WHITE);
await icon('icons/icon-192.png', 192, 0.08, light, WHITE);
await icon('icons/icon-512.png', 512, 0.08, light, WHITE);
await icon('icons/maskable-512.png', 512, 0.2, light, WHITE);   // zone sûre : cercle de 80 %
