// Prepare a private, portable maintenance bundle. Never contacts or opens a workspace.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const hash = value => createHash('sha256').update(value).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function check(condition, message) { if (!condition) throw new Error(message); }
function inside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
function filename(value) {
  check(typeof value === 'string' && value.length > 0 && value.length <= 180 && !/[\\/\x00-\x1f]/.test(value) && value !== '.' && value !== '..', 'Attachment filename is invalid');
  return value;
}
function matchesType(bytes, extension) {
  const signatures = {
    '.xlsx': [80, 75, 3, 4], '.xls': [208, 207, 17, 224, 161, 177, 26, 225],
    '.png': [137, 80, 78, 71, 13, 10, 26, 10], '.jpg': [255, 216, 255], '.jpeg': [255, 216, 255], '.pdf': [37, 80, 68, 70, 45],
  };
  return signatures[extension]?.every((byte, index) => bytes[index] === byte) ?? false;
}
function options(argv) {
  const result = {};
  while (argv.length) {
    const key = argv.shift();
    check(['--config', '--output'].includes(key) && !Object.hasOwn(result, key), 'Use --config <private.json> --output <new-bundle-directory>');
    check(argv.length && !argv[0].startsWith('--'), 'Option value is required');
    result[key] = argv.shift();
  }
  check(result['--config'] && result['--output'], '--config and --output are required');
  return result;
}

export async function prepareQuote({config: configPath, output: outputPath}) {
  check(typeof configPath === 'string' && typeof outputPath === 'string', 'Explicit config and output paths are required');
  const configFile = await fs.realpath(path.resolve(configPath));
  check((await fs.stat(configFile)).isFile(), 'Config must be a file');
  const root = path.dirname(configFile);
  let config;
  try { config = JSON.parse((await fs.readFile(configFile, 'utf8')).replace(/^\uFEFF/, '')); }
  catch { throw new Error('Config must be valid JSON'); }
  check(object(config) && config.schemaVersion === 1 && config.operation === 'create', 'Expected schemaVersion 1 and operation create');
  check(Object.keys(config).every(key => ['schemaVersion', 'operation', 'customer', 'quoteCustomerCode', 'preconditions', 'actor', 'readers', 'quotes'].includes(key)), 'Unsupported top-level configuration field');
  check(object(config.customer) && typeof config.customer.id === 'string' && config.customer.id.length > 0 && typeof config.customer.customerCode === 'string' && typeof config.customer.customer === 'string', 'Explicit customer identity is required');
  if (config.quoteCustomerCode !== undefined) check(typeof config.quoteCustomerCode === 'string', 'Configured quotation customer code must be a string');
  if (config.preconditions !== undefined) check(Array.isArray(config.preconditions) && config.preconditions.every(entry => object(entry) && typeof entry.id === 'string' && entry.id.length > 0 && typeof entry.kind === 'string' && entry.kind.length > 0 && typeof entry.sha256 === 'string' && /^[a-f0-9]{64}$/.test(entry.sha256)), 'Configured record preconditions must contain ids, kinds and SHA-256 hashes');
  check(object(config.actor) && typeof config.actor.username === 'string' && config.actor.username.trim(), 'Explicit actor username is required');
  check(Array.isArray(config.readers) && config.readers.every(reader => object(reader) && typeof reader.username === 'string' && reader.username.trim()), 'Explicit readers list is required');
  check(Array.isArray(config.quotes) && config.quotes.length > 0, 'At least one configured quotation is required');
  const bundle = structuredClone(config), objects = new Map();
  let attachmentCount = 0;
  async function attachment(entry, category) {
    check(object(entry) && typeof entry.path === 'string' && entry.path.length > 0, 'Attachment path is required');
    check(!path.isAbsolute(entry.path) && !path.win32.isAbsolute(entry.path) && !entry.path.includes('\\'), 'Attachment paths must be portable relative paths using /');
    const candidate = path.resolve(root, entry.path);
    check(inside(root, candidate), 'Attachment path escapes config directory');
    const resolved = await fs.realpath(candidate);
    check(inside(root, resolved), 'Attachment symlink escapes config directory');
    const stat = await fs.stat(resolved);
    check(stat.isFile() && stat.size > 0 && stat.size <= MAX_FILE_BYTES, 'Attachment must be a file between 1 byte and 10 MB');
    const originalName = filename(entry.filename ?? path.basename(candidate));
    const extension = path.extname(originalName).toLowerCase();
    check(extension === path.extname(candidate).toLowerCase(), 'Attachment filename extension must match source');
    const allowed = category === 'source' ? ['.xlsx', '.xls', '.pdf', '.png', '.jpg', '.jpeg'] : category === 'image' ? ['.png', '.jpg', '.jpeg'] : ['.png', '.jpg', '.jpeg', '.pdf'];
    check(allowed.includes(extension), 'Attachment type is not allowed for this category');
    const bytes = await fs.readFile(resolved);
    check(bytes.length > 0 && bytes.length <= MAX_FILE_BYTES && matchesType(bytes, extension), 'Attachment type signature or size is invalid');
    const sha256 = hash(bytes);
    if (entry.sha256 !== undefined) check(typeof entry.sha256 === 'string' && /^[a-f0-9]{64}$/.test(entry.sha256) && sha256 === entry.sha256, 'Attachment SHA-256 does not match');
    const relative = `files/${sha256}${extension}`;
    objects.set(relative, bytes); attachmentCount++;
    return {path: relative, filename: originalName, sha256};
  }
  const quoteNumbers = new Set();
  for (const quote of bundle.quotes) {
    check(object(quote) && Object.keys(quote).every(key => ['payload', 'source', 'media'].includes(key)) && object(quote.payload), 'Invalid quotation entry');
    check(quote.payload.customerAccountId === config.customer.id && typeof quote.payload.quoteNo === 'string' && quote.payload.quoteNo.trim(), 'Quotation customer identity and number are required');
    check(!quoteNumbers.has(quote.payload.quoteNo), 'Duplicate quotation number'); quoteNumbers.add(quote.payload.quoteNo);
    check(!Object.hasOwn(quote.payload, 'id') && !Object.hasOwn(quote.payload, 'version'), 'Create payload must not contain existing id or version');
    check(Array.isArray(quote.payload.lines) && quote.payload.lines.length > 0, 'Configured quotation lines are required');
    const lines = new Set(quote.payload.lines.map(line => line?.id));
    check(lines.size === quote.payload.lines.length && [...lines].every(id => typeof id === 'string' && id.length > 0), 'Quotation line ids must be nonempty and unique');
    quote.source = await attachment(quote.source, 'source');
    check(Array.isArray(quote.media), 'Explicit media list is required');
    const mediaKeys = new Set();
    for (let i = 0; i < quote.media.length; i++) {
      const entry = quote.media[i];
      check(object(entry) && ['image', 'drawing'].includes(entry.category) && typeof entry.lineId === 'string' && lines.has(entry.lineId), 'Media must reference a configured line and category');
      const file = await attachment(entry, entry.category);
      const key = `${file.sha256}\0${entry.lineId}\0${entry.category}\0${file.filename}`;
      check(!mediaKeys.has(key), 'Duplicate media entry'); mediaKeys.add(key);
      quote.media[i] = {...file, lineId: entry.lineId, category: entry.category};
    }
  }
  const output = path.resolve(outputPath);
  // mkdir without recursive reserves a fresh destination; existing files/directories are never reused.
  await fs.mkdir(path.dirname(output), {recursive: true, mode: 0o700});
  await fs.mkdir(output, {mode: 0o700});
  await fs.mkdir(path.join(output, 'files'), {mode: 0o700});
  for (const [relative, bytes] of objects) await fs.writeFile(path.join(output, relative), bytes, {flag: 'wx', mode: 0o600});
  await fs.writeFile(path.join(output, 'config.json'), `${JSON.stringify(bundle, null, 2)}\n`, {flag: 'wx', mode: 0o600});
  return {success: true, quoteCount: bundle.quotes.length, attachmentCount, uniqueFileCount: objects.size};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const args = options(process.argv.slice(2)); console.log(JSON.stringify(await prepareQuote({config: args['--config'], output: args['--output']}))); }
  catch (error) { console.error(JSON.stringify({success: false, error: error.code ? `Filesystem operation failed (${error.code})` : error.message})); process.exitCode = 1; }
}
