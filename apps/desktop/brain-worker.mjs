// SPDX-License-Identifier: GPL-3.0-only
import { parentPort, workerData } from 'node:worker_threads';
import { readdir, lstat, open, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { textFromFile } from './attachments.mjs';
const { folder, database } = workerData;
const db = new DatabaseSync(database);
db.exec(
  'PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS documents(source TEXT PRIMARY KEY,hash TEXT,bytes INTEGER); CREATE VIRTUAL TABLE IF NOT EXISTS brain USING fts5(content,source UNINDEXED,page UNINDEXED,tokenize="unicode61 remove_diacritics 2");',
);
let indexed = 0,
  skipped = 0;
try {
  const entries = (await readdir(folder, { withFileTypes: true }))
    .filter((row) => row.isFile() && /\.(txt|md|docx|odt|pdf)$/i.test(row.name))
    .slice(0, 200);
  const seen = new Set();
  for (const entry of entries) {
    seen.add(entry.name);
    let handle;
    try {
      const file = path.join(folder, entry.name),
        before = await lstat(file);
      if (
        !before.isFile() ||
        before.isSymbolicLink() ||
        before.nlink !== 1 ||
        before.size > 8 * 1024 * 1024 ||
        !before.size ||
        path.dirname(await realpath(file)) !== folder
      )
        throw new Error('Unsafe document');
      handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const after = await handle.stat();
      if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size)
        throw new Error('Changed document');
      const bytes = await handle.readFile();
      if (bytes.length !== before.size) throw new Error('Changed document');
      const hash = createHash('sha256').update(bytes).digest('hex');
      if (db.prepare('SELECT hash FROM documents WHERE source=?').get(entry.name)?.hash === hash) {
        indexed++;
        continue;
      }
      let pages;
      if (path.extname(file).toLowerCase() === '.pdf') {
        const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
        const task = getDocument({
          data: new Uint8Array(bytes),
          isEvalSupported: false,
          useSystemFonts: false,
          disableFontFace: true,
          stopAtErrors: true,
        });
        try {
          const pdf = await task.promise;
          if (pdf.numPages > 200) throw new Error('Too many PDF pages');
          pages = [];
          let total = 0;
          for (let index = 1; index <= pdf.numPages; index++) {
            const page = await pdf.getPage(index),
              data = await page.getTextContent();
            const text = data.items.map((item) => item.str ?? '').join(' ');
            total += text.length;
            if (total > 500000) throw new Error('Document text too large');
            pages.push({ page: index, text });
            page.cleanup();
          }
        } finally {
          await task.destroy();
        }
      } else {
        const text = textFromFile(bytes, path.extname(file).slice(1).toLowerCase());
        if (text.length > 500000) throw new Error('Document text too large');
        pages = [{ page: 1, text }];
      }
      if (!pages.some((page) => page.text.trim()))
        throw new Error('The document has no extractable text.');
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('DELETE FROM brain WHERE source=?').run(entry.name);
        const insert = db.prepare('INSERT INTO brain(content,source,page) VALUES(?,?,?)');
        for (const { page, text } of pages)
          for (let offset = 0; offset < text.length; offset += 1000) {
            const chunk = text
              .slice(offset, offset + 1200)
              .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, ' ')
              .trim();
            if (chunk) insert.run(chunk, entry.name, page);
          }
        db.prepare('INSERT OR REPLACE INTO documents VALUES(?,?,?)').run(
          entry.name,
          hash,
          bytes.length,
        );
        db.exec('COMMIT');
        indexed++;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    } catch {
      // Never retain the previous text of a document that has become unsafe/unreadable.
      db.prepare('DELETE FROM brain WHERE source=?').run(entry.name);
      db.prepare('DELETE FROM documents WHERE source=?').run(entry.name);
      skipped++;
    } finally {
      await handle?.close();
    }
    parentPort.postMessage({ type: 'progress', indexed, skipped });
  }
  for (const row of db.prepare('SELECT source FROM documents').all())
    if (!seen.has(row.source)) {
      db.prepare('DELETE FROM brain WHERE source=?').run(row.source);
      db.prepare('DELETE FROM documents WHERE source=?').run(row.source);
    }
  parentPort.postMessage({ type: 'complete', indexed, skipped });
} finally {
  db.close();
}
