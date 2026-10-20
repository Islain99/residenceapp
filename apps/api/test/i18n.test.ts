// Règle des deux langues : chaque code d'erreur renvoyé par l'API a son
// message anglais dans l'interface (apps/web/src/i18n/api-errors.ts). Une
// nouvelle erreur sans traduction fait échouer ce test.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = fileURLToPath(new URL('.', import.meta.url));
const SRC = join(here, '../src');
const WEB_ERRORS = join(here, '../../web/src/i18n/api-errors.ts');

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sources(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : []);
}

describe('messages d’erreur en anglais', () => {
  it('chaque code d’erreur de l’API a sa traduction anglaise', () => {
    const codes = new Set<string>();
    for (const file of sources(SRC)) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/(?:badRequest\('|HttpError\(\d+, '|error: ')([a-z_]+)'/g)) codes.add(m[1]!);
    }
    const english = readFileSync(WEB_ERRORS, 'utf8');
    const missing = [...codes].filter((code) => !new RegExp(`^\\s+${code}:`, 'm').test(english));
    expect(codes.size).toBeGreaterThan(50);
    expect(missing, `codes sans traduction dans ${WEB_ERRORS}`).toEqual([]);
  });
});
