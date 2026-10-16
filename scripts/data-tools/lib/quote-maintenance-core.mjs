import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

export class MaintenanceError extends Error { constructor(code) { super(code); this.code = code; } }
export const check = (value, code) => { if (!value) throw new MaintenanceError(code); };
export const hash = value => createHash('sha256').update(value).digest('hex');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const fingerprint = value => hash(JSON.stringify(canonical(value)) ?? 'undefined');
export const equal = (a, b) => fingerprint(a) === fingerprint(b);
export const fields = ['companyEn','companyZh','collectionEn','collectionZh','customerCode','customerName','customerAccountId','contactName','brand','businessType','quoteMode','pricingBasis','currencyReviewed','quoteNo','quoteDate','validUntil','currency','internalNotesZh','exchangeRateCnyPerUsd','internalCosts','customerCharges','lines','terms','reviewNotes'];
export function normalize(value) {
  const out = structuredClone(Object.fromEntries(fields.filter(key => value[key] !== undefined).map(key => [key, value[key]])));
  for (const key of ['companyEn','companyZh','collectionEn','collectionZh','customerCode','customerName','customerAccountId','contactName','brand','businessType','quoteNo','currency','internalNotesZh']) if (typeof out[key] === 'string') out[key] = out[key].trim();
  out.collectionEn ??= ''; out.collectionZh ??= ''; out.customerAccountId ??= null;
  const nested = {lines:['id','model','factoryModel','customerModel','materialNumber','component','scopeNotesZh','scopeNotesEn','quantityBasisZh','quantityBasisEn'], terms:['id','labelZh','labelEn'], internalCosts:['id','label','notes'], customerCharges:['id','labelZh','labelEn','basisZh','basisEn']};
  for (const [key, trimKeys] of Object.entries(nested)) if (Array.isArray(out[key])) out[key] = out[key].map(row => {
    const result = {...row};
    for (const field of trimKeys) if (typeof result[field] === 'string') result[field] = result[field].trim();
    if (key === 'internalCosts') result.notes ??= '';
    return result;
  });
  return out;
}
export const totalExtras = quote => quote.lines.reduce((sum, line) => sum + (line.toolingFee ?? 0), 0) + (quote.customerCharges || []).reduce((sum, charge) => sum + (charge.amount ?? 0), 0);
export const omit = (value, names) => Object.fromEntries(Object.entries(value).filter(([key]) => !names.includes(key)));
export async function regularFile(filename) {
  const stat = await fs.lstat(filename);
  check(stat.isFile() && !stat.isSymbolicLink(), 'EXPECTED_REGULAR_FILE');
  return stat;
}
export async function fileHashes(directory) {
  const result = {};
  for (const entry of (await fs.readdir(directory, {withFileTypes:true})).sort((a,b) => a.name.localeCompare(b.name))) {
    check(entry.isFile() && /^[a-f0-9]{64}$/.test(entry.name), 'UNSUPPORTED_ATTACHMENT_LAYOUT');
    result[entry.name] = hash(await fs.readFile(path.join(directory, entry.name)));
  }
  return result;
}
export function parseOptions(argv) {
  const result = {};
  while (argv.length) {
    const key = argv.shift();
    check(['--config','--build','--data','--report','--rehearse','--apply','--preflight'].includes(key) && !Object.hasOwn(result,key), 'INVALID_ARGUMENT');
    if (key === '--rehearse' || key === '--apply') result[key] = true;
    else { check(argv.length && !argv[0].startsWith('--'), 'MISSING_ARGUMENT_VALUE'); result[key] = argv.shift(); }
  }
  for (const key of ['--config','--build','--data','--report']) check(typeof result[key] === 'string' && result[key].length, 'REQUIRED_EXPLICIT_PATHS');
  check(!!result['--rehearse'] !== !!result['--apply'], 'SELECT_EXACTLY_ONE_MODE');
  check(!result['--apply'] || result['--preflight'], 'APPLY_REQUIRES_PREFLIGHT');
  return result;
}
const formats = {
  xlsx:{signature:[80,75],mime:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'},
  xls:{signature:[208,207,17,224,161,177,26,225],mime:'application/vnd.ms-excel'},
  pdf:{signature:[37,80,68,70,45],mime:'application/pdf'},
  png:{signature:[137,80,78,71,13,10,26,10],mime:'image/png'},
  jpg:{signature:[255,216,255],mime:'image/jpeg'}, jpeg:{signature:[255,216,255],mime:'image/jpeg'},
};
async function attachment(entry, base, media = false) {
  check(entry && typeof entry.path === 'string' && /^[a-f0-9]{64}$/.test(entry.sha256), 'INVALID_ATTACHMENT_SPEC');
  check(!/^[A-Za-z]:[\\/]/.test(entry.path) || path.isAbsolute(entry.path), 'FOREIGN_ABSOLUTE_PATH');
  const filename = entry.filename ?? path.basename(entry.path);
  check(typeof filename === 'string' && filename.length > 0 && filename.length <= 180 && !/[\\/\r\n\u0000-\u001f]/.test(filename), 'INVALID_ATTACHMENT_FILENAME');
  const ext = path.extname(filename).slice(1).toLowerCase(), format = formats[ext];
  check(format && (!media || (['image','drawing'].includes(entry.category) && ['png','jpg','jpeg',...(entry.category === 'drawing' ? ['pdf'] : [])].includes(ext))), 'INVALID_ATTACHMENT_FORMAT');
  const filenameOnDisk = path.resolve(base, entry.path);
  const stat = await regularFile(filenameOnDisk);
  check(stat.size > 0 && stat.size <= 10 * 1024 * 1024, 'INVALID_ATTACHMENT_BYTES');
  const bytes = await fs.readFile(filenameOnDisk);
  check(bytes.length > 0 && bytes.length <= 10 * 1024 * 1024 && format.signature.every((byte,i) => bytes[i] === byte), 'INVALID_ATTACHMENT_BYTES');
  check(hash(bytes) === entry.sha256, 'ATTACHMENT_HASH_MISMATCH');
  return {...entry,path:filenameOnDisk,filename,bytes,mime:format.mime};
}
export async function loadConfig(filename) {
  await regularFile(filename);
  const raw = await fs.readFile(filename), config = JSON.parse(raw.toString('utf8').replace(/^\uFEFF/,''));
  check(config.schemaVersion === 1 && ['create','update-fees'].includes(config.operation), 'UNSUPPORTED_CONFIG');
  check(config.customer && ['id','customer'].every(key => typeof config.customer[key] === 'string' && config.customer[key].length) && typeof config.customer.customerCode === 'string', 'EXPLICIT_CUSTOMER_REQUIRED');
  const quoteCustomerCode=config.quoteCustomerCode ?? config.customer.customerCode;
  check(typeof quoteCustomerCode === 'string', 'INVALID_QUOTE_CUSTOMER_CODE');
  check(config.preconditions === undefined || Array.isArray(config.preconditions) && config.preconditions.every(item => item && typeof item.id === 'string' && item.id.length && typeof item.kind === 'string' && item.kind.length && /^[a-f0-9]{64}$/.test(item.sha256)), 'INVALID_RECORD_PRECONDITIONS');
  check(quoteCustomerCode === config.customer.customerCode || config.preconditions?.length > 0, 'CODE_MAPPING_REQUIRES_EVIDENCE');
  check(config.actor && typeof config.actor.username === 'string' && config.actor.username.length, 'EXPLICIT_ACTOR_REQUIRED');
  check(Array.isArray(config.readers) && config.readers.every(reader => reader && typeof reader.username === 'string' && reader.username.length), 'EXPLICIT_READERS_REQUIRED');
  const validatePayload = value => {
    check(value && Object.keys(value).every(key => fields.includes(key) || (config.operation === 'update-fees' && ['id','version'].includes(key))), 'UNSUPPORTED_PAYLOAD_FIELD');
    const payload = normalize(value);
    check(payload.customerAccountId === config.customer.id && payload.customerCode === quoteCustomerCode && payload.customerName === config.customer.customer, 'CUSTOMER_BINDING_MISMATCH');
    check(typeof payload.quoteNo === 'string' && payload.quoteNo.length && Array.isArray(payload.lines) && payload.lines.length > 0, 'INVALID_QUOTE');
    check(new Set(payload.lines.map(line => line.id)).size === payload.lines.length && payload.lines.every(line => line.id && line.model && (line.unitPrice === null || Number.isFinite(line.unitPrice) && line.unitPrice >= 0)), 'INVALID_QUOTE_LINES');
    return payload;
  };
  if (config.operation === 'create') {
    check(!config.update && Array.isArray(config.quotes) && config.quotes.length > 0, 'CREATE_QUOTES_REQUIRED');
    const prepared = [];
    for (const entry of config.quotes) {
      const payload = validatePayload(entry.payload), source = await attachment(entry.source,path.dirname(filename));
      check(Array.isArray(entry.media) && entry.media.length <= 30, 'INVALID_MEDIA_LIST');
      const media = [];
      for (const item of entry.media) {
        check(payload.lines.some(line => line.id === item.lineId), 'UNKNOWN_MEDIA_LINE');
        media.push(await attachment(item,path.dirname(filename),true));
      }
      check(new Set(media.map(mediaIdentity)).size === media.length, 'DUPLICATE_MEDIA');
      prepared.push({payload,source,media});
    }
    check(new Set(prepared.map(entry => entry.payload.quoteNo)).size === prepared.length, 'DUPLICATE_QUOTE');
    config.prepared = prepared;
  } else {
    check(!config.quotes && config.update && config.update.before, 'UPDATE_SNAPSHOT_REQUIRED');
    const {before,expectedExtraTotal} = config.update, desired = config.update.payload, payload = validatePayload(desired), prior = normalize(before);
    check(before.kind === 'customer_quote' && before.status === 'draft' && before.id === desired.id && before.version === desired.version && Number.isSafeInteger(before.version) && before.version > 0, 'INVALID_UPDATE_VERSION');
    check(equal(omit(payload,['lines','customerCharges','terms','internalNotesZh','reviewNotes']),omit(prior,['lines','customerCharges','terms','internalNotesZh','reviewNotes'])), 'UPDATE_FIELD_OUT_OF_SCOPE');
    check(payload.lines.length === prior.lines.length && payload.lines.every((line,i) => equal(omit(line,['toolingFee','descriptionZh','descriptionEn','scopeNotesZh','scopeNotesEn']),omit(prior.lines[i],['toolingFee','descriptionZh','descriptionEn','scopeNotesZh','scopeNotesEn']))), 'UPDATE_LINE_OUT_OF_SCOPE');
    check(payload.lines.every(line => line.toolingFee === null || Number.isFinite(line.toolingFee) && line.toolingFee >= 0), 'INVALID_TOOLING_FEE');
    check(Array.isArray(payload.customerCharges) && payload.customerCharges.every(charge => charge.id && Number.isFinite(charge.amount) && charge.amount >= 0) && new Set(payload.customerCharges.map(charge => charge.id)).size === payload.customerCharges.length, 'INVALID_CUSTOMER_CHARGES');
    check(Array.isArray(prior.terms) && Array.isArray(payload.terms) && payload.terms.length === prior.terms.length && payload.terms.every((term,i) => term.id === prior.terms[i].id && (term.id === 'tooling' || equal(term,prior.terms[i]))), 'UPDATE_TERM_OUT_OF_SCOPE');
    check(typeof payload.internalNotesZh === 'string' && payload.internalNotesZh.length <= 8000 && Array.isArray(payload.reviewNotes) && payload.reviewNotes.length === prior.reviewNotes?.length && payload.reviewNotes.filter((note,i) => note !== prior.reviewNotes[i]).length <= 1, 'UPDATE_REVIEW_OUT_OF_SCOPE');
    check(Number.isFinite(expectedExtraTotal) && expectedExtraTotal >= 0 && Math.abs(totalExtras(payload)-expectedExtraTotal) < 1e-8, 'EXTRA_TOTAL_MISMATCH');
    check(Array.isArray(before.mediaIds) && before.sourceFileKey && /^[a-f0-9]{64}$/.test(before.sourceHash), 'UPDATE_REQUIRES_EXISTING_SOURCE');
    config.update.payload = payload;
  }
  return {config,configHash:hash(raw)};
}
export const mediaIdentity = entry => [entry.filename,entry.lineId,entry.category,entry.sha256].join('\0');
