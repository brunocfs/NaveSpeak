// Checagem das traduções (npm run i18n:check):
// 1. en-US/es-ES têm exatamente as mesmas chaves que pt-BR;
// 2. toda chave usada em t('...') / labelKey: '...' em src/ existe no pt-BR.
// Chave dinâmica (t(`a.b.${x}`)) só exige que exista alguma chave com o prefixo.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const load = (lng) => JSON.parse(readFileSync(join(root, 'locales', `${lng}.json`), 'utf8'));

function flatten(obj, prefix = '') {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`]
  );
}

const errors = [];
const base = new Set(flatten(load('pt-BR')));
for (const lng of ['en-US', 'es-ES']) {
  const keys = new Set(flatten(load(lng)));
  for (const k of base) if (!keys.has(k)) errors.push(`${lng}: falta "${k}"`);
  for (const k of keys) if (!base.has(k)) errors.push(`${lng}: sobra "${k}" (não existe no pt-BR)`);
}

function* sourceFiles(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* sourceFiles(path);
    else if (/\.jsx?$/.test(name) && !name.includes(' copy')) yield path;
  }
}

const usage = /\bt\(\s*(["'`])([^"'`]+)\1|labelKey:\s*(["'])([^"']+)\3/g;
for (const file of sourceFiles(root)) {
  for (const m of readFileSync(file, 'utf8').matchAll(usage)) {
    const key = m[2] ?? m[4];
    const dynamic = key.indexOf('${');
    const ok =
      dynamic === -1
        ? base.has(key)
        : [...base].some((k) => k.startsWith(key.slice(0, dynamic)));
    if (!ok) errors.push(`${file.slice(root.length + 1)}: chave "${key}" não existe no pt-BR`);
  }
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`i18n ok: ${base.size} chaves.`);
