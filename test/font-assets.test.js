import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fontDir = join(root, 'editor', 'neo-ppt', 'fonts', 'fnt');
const bundles = [
  'ThumbnailSlide-COLdjDXw.js',
  'ThumbnailSlide-legacy-CSXTq44l.js',
];
const generatedFonts = new Set([
  'Noto Sans SC',
  'Noto Serif SC',
  '阿里妈妈刀隶体',
  '站酷文艺体',
  '站酷庆科黄油体',
  '飞波正点体',
  '程荣光刻楷',
  '得意黑',
  '精品点阵体',
  'Long Cang',
  'LXGW Bright',
  'ZCOOL KuaiLe',
]);

function catalog(bundle) {
  const source = readFileSync(join(root, 'editor', 'neo-ppt', 'assets', bundle), 'utf8');
  const fonts = new Map();
  for (const match of source.matchAll(/fntdataUrl:.{0,60}?fonts\/fnt\/([^`"]+)\.fntdata/g)) {
    const entry = source.slice(source.lastIndexOf('{label:', match.index), match.index);
    const label = entry.match(/label:([`"])(.*?)\1/);
    const embedded = entry.match(/embedLabel:([`"])(.*?)\1/);
    assert.ok(label, `${bundle}: missing label for ${match[1]}`);
    fonts.set(match[1], embedded?.[2] ?? label[2]);
  }
  return fonts;
}

function trueTypeFamily(data, fontStart) {
  const tableCount = data.readUInt16BE(fontStart + 4);
  const tables = new Map();
  for (let index = 0; index < tableCount; index++) {
    const record = fontStart + 12 + index * 16;
    tables.set(data.toString('ascii', record, record + 4), fontStart + data.readUInt32BE(record + 8));
  }
  assert.ok(tables.has('glyf'), 'missing TrueType glyph outlines');
  assert.ok(!tables.has('fvar'), 'variable font was not made static');
  const nameTable = tables.get('name');
  assert.ok(nameTable, 'missing name table');
  const count = data.readUInt16BE(nameTable + 2);
  const strings = nameTable + data.readUInt16BE(nameTable + 4);
  for (let index = 0; index < count; index++) {
    const record = nameTable + 6 + index * 12;
    const platform = data.readUInt16BE(record);
    const language = data.readUInt16BE(record + 4);
    const nameId = data.readUInt16BE(record + 6);
    if (platform !== 3 || language !== 0x409 || nameId !== 1) continue;
    const length = data.readUInt16BE(record + 8);
    const start = strings + data.readUInt16BE(record + 10);
    return Buffer.from(data.subarray(start, start + length)).swap16().toString('utf16le');
  }
  throw new Error('missing Windows English family name');
}

test('editor font URLs resolve to files and generated EOT names match their declarations', () => {
  const catalogs = bundles.map(catalog);
  assert.deepEqual(catalogs[0], catalogs[1]);
  assert.equal(catalogs[0].size, 24);

  for (const [fileName, declaredName] of catalogs[0]) {
    const path = join(fontDir, `${fileName}.fntdata`);
    assert.ok(existsSync(path), `missing font: ${fileName}`);
    if (!generatedFonts.has(fileName)) continue;

    const data = readFileSync(path);
    assert.ok(data.length > 512, `${fileName}: font is too small`);
    assert.equal(data.readUInt32LE(0), data.length, `${fileName}: EOT length`);
    assert.equal(data.readUInt16LE(34), 0x504c, `${fileName}: EOT magic`);
    assert.ok([0, 8].includes(data.readUInt16LE(32)), `${fileName}: embedding rights`);
    const familySize = data.readUInt16LE(82);
    const family = data.subarray(84, 84 + familySize).toString('utf16le').replace(/\0+$/, '');
    assert.equal(family, declaredName, `${fileName}: embedded family name`);
    const fontStart = data.length - data.readUInt32LE(4);
    assert.equal(data.subarray(fontStart, fontStart + 4).toString('hex'), '00010000', `${fileName}: static TrueType outline`);
    assert.equal(trueTypeFamily(data, fontStart), declaredName, `${fileName}: internal TrueType family name`);
  }
});
