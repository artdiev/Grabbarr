// Rasterize public/icon.svg into the extension PNG icons. Run: npm run icons
import sharp from 'sharp';
import { readFileSync } from 'node:fs';

const svg = readFileSync(new URL('../public/icon.svg', import.meta.url));
const sizes = [16, 32, 48, 128];

for (const size of sizes) {
    const out = new URL(`../public/icons/icon${size}.png`, import.meta.url);
    await sharp(svg, { density: 384 }).resize(size, size).png().toFile(out.pathname);
    console.log(`wrote icons/icon${size}.png`);
}
