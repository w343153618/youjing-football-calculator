import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JavaScriptObfuscator from 'javascript-obfuscator';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(__dirname, '../dist');
const ASSETS_DIR = path.join(DIST_DIR, 'assets');
const SKINS_DIR = path.join(DIST_DIR, 'skins');

async function main() {
  const assetFiles = await fs.readdir(ASSETS_DIR);
  for (const file of assetFiles) {
    const full = path.join(ASSETS_DIR, file);
    if (file.endsWith('.map')) {
      await fs.unlink(full);
      continue;
    }
    if (!file.endsWith('.js')) continue;

    const raw = await fs.readFile(full, 'utf8');
    const obfuscated = JavaScriptObfuscator.obfuscate(raw, {
      compact: true,
      target: 'browser-no-eval',
      identifierNamesGenerator: 'hexadecimal',
      renameGlobals: false,
      simplify: true,
      numbersToExpressions: true,
      transformObjectKeys: true,
      splitStrings: true,
      splitStringsChunkLength: 10,
      forceTransformStrings: ['[\\u4e00-\\u9fff]'],
      stringArray: true,
      stringArrayCallsTransform: true,
      stringArrayCallsTransformThreshold: 0.75,
      stringArrayEncoding: ['rc4'],
      stringArrayIndexShift: true,
      stringArrayRotate: true,
      stringArrayShuffle: true,
      stringArrayThreshold: 1,
      unicodeEscapeSequence: true,
    }).getObfuscatedCode();

    await fs.writeFile(full, obfuscated, 'utf8');
    console.log(
      `[obfuscate] Sealed ${file}: ${(raw.length / 1024).toFixed(1)} KB -> ${(
        obfuscated.length / 1024
      ).toFixed(1)} KB (RC4 StringArray + TransformObjectKeys + UnicodeHex)`
    );
  }

  try {
    const skinFiles = await fs.readdir(SKINS_DIR);
    for (const sf of skinFiles) {
      if (!sf.endsWith('.css')) continue;
      const fullCss = path.join(SKINS_DIR, sf);
      const css = await fs.readFile(fullCss, 'utf8');
      const stripped = css
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\n{2,}/g, '\n')
        .trim();
      await fs.writeFile(fullCss, stripped, 'utf8');
    }
    console.log(`[obfuscate] Stripped comments from ${skinFiles.length} skin stylesheets.`);
  } catch {
    // ignore if no skins dir
  }

  // Deterministic post-build gate: 0 .map files anywhere in dist/, 0 plaintext Chinese chars in dist/assets/*.js
  async function walkDist(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = [];
    for (const ent of entries) {
      const fullPath = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        files.push(...(await walkDist(fullPath)));
      } else {
        files.push(fullPath);
      }
    }
    return files;
  }

  const allDistFiles = await walkDist(DIST_DIR);
  const leftoverMaps = allDistFiles.filter((f) => f.endsWith('.map'));
  if (leftoverMaps.length > 0) {
    throw new Error(`Post-build gate failed: leftover source maps found: ${leftoverMaps.join(', ')}`);
  }

  const postAssets = (await fs.readdir(ASSETS_DIR)).filter((f) => f.endsWith('.js'));
  let plainZhCount = 0;
  for (const jf of postAssets) {
    const content = await fs.readFile(path.join(ASSETS_DIR, jf), 'utf8');
    const matches = content.match(/[\u4e00-\u9fff]/g);
    if (matches) plainZhCount += matches.length;
  }
  if (plainZhCount > 0) {
    throw new Error(`Post-build gate failed: ${plainZhCount} plaintext Chinese character(s) leaked in dist/assets/*.js`);
  }
  console.log('[obfuscate] Gate passed: 0 .map files, 0 plaintext Chinese chars in dist/assets/*.js.');
}

main().catch((err) => {
  console.error('[obfuscate] Failed:', err);
  process.exit(1);
});
