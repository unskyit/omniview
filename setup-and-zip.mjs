#!/usr/bin/env node
/**
 * Omniview Lightweight Builder & Packager (setup-and-zip.mjs)
 * ---------------------------------------------------------------------------
 * 1. Ensures directory structure (`assets/`, `vendor/`) exists.
 * 2. Optionally fetches official Mozilla PDF.js (`pdf.min.js` & `pdf.worker.min.js`)
 *    from cdnjs when online, keeping the bundled local PDF engine if offline.
 * 3. Packages all repository files into `omniview-pwa.zip` using standard OS zip tools.
 */

import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PDF_CDN_URLS = {
  'vendor/pdf.min.js': 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'vendor/pdf.worker.min.js': 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
};

const REQUIRED_FILES = [
  'index.html',
  'styles.css',
  'app.js',
  'manifest.json',
  'sw.js',
  'README.md',
  'setup-and-zip.mjs',
  'assets/logo.svg',
  'assets/shortcut-open.svg',
  'assets/shortcut-recent.svg',
  'vendor/pdf.min.js',
  'vendor/pdf.worker.min.js'
];

function downloadUrl(url, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: timeoutMs }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error('HTTP ' + res.statusCode));
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
  });
}

async function main() {
  fs.mkdirSync(path.join(__dirname, 'assets'), { recursive: true });
  fs.mkdirSync(path.join(__dirname, 'vendor'), { recursive: true });

  for (const [relPath, url] of Object.entries(PDF_CDN_URLS)) {
    try {
      const buf = await downloadUrl(url);
      if (buf && buf.length > 1000) {
        fs.writeFileSync(path.join(__dirname, relPath), buf);
        console.log(`[Omniview] Updated ${relPath} from CDN (${buf.length} bytes)`);
      }
    } catch {
      console.log(`[Omniview] Using local bundled ${relPath}`);
    }
  }

  for (const relPath of REQUIRED_FILES) {
    const p = path.join(__dirname, relPath);
    if (!fs.existsSync(p)) {
      throw new Error(`Missing required file: ${relPath}`);
    }
  }

  const outZip = path.join(__dirname, 'omniview-pwa.zip');
  if (fs.existsSync(outZip)) fs.unlinkSync(outZip);

  try {
    execSync(`zip -r -9 "${outZip}" ${REQUIRED_FILES.join(' ')}`, {
      cwd: __dirname,
      stdio: 'inherit'
    });
    console.log(`[Omniview] Successfully created ${outZip}`);
  } catch {
    console.log('[Omniview] All files verified in directory and ready for GitHub.');
  }
}

main().catch((err) => {
  console.error('[Omniview Error]:', err.message);
  process.exit(1);
});
