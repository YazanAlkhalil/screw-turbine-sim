// Inline the built JS and CSS into one self-contained HTML file that runs straight from
// disk (file://), where browsers refuse to load separate module scripts.
import { readFileSync, writeFileSync } from 'node:fs';

export const OFFLINE_NAME = 'water-loop-simulation.html';
const dist = new URL('../dist/', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, dist), 'utf8');

let html = read('index.html');
let scripts = 0;
let styles = 0;
html = html.replace(/<script type="module"[^>]*\ssrc="\.\/([^"]+)"[^>]*><\/script>/g, (_, file) => {
  scripts++;
  return `<script type="module">${read(file).replace(/<\/script/gi, '<\\/script')}</script>`;
});
html = html.replace(/<link rel="stylesheet"[^>]*\shref="\.\/([^"]+)"[^>]*>/g, (_, file) => {
  styles++;
  return `<style>${read(file)}</style>`;
});
if (scripts !== 1 || styles !== 1 || html.includes('./assets/')) {
  throw new Error(`make-offline: expected 1 script + 1 stylesheet, inlined ${scripts} + ${styles}`);
}
writeFileSync(new URL(OFFLINE_NAME, dist), html);
console.log(`dist/${OFFLINE_NAME}  ${(html.length / 1024).toFixed(0)} kB (self-contained, works offline)`);
