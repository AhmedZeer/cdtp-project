// Tamper evidence for a finished run (§5.2: "a form that cannot later be manually altered").
// The digest covers the raw record and the result. verifySealed() recomputes the digest and
// re-runs the evaluator on the record, so editing either the data or the verdict is detected.
import { evaluateRun } from './evaluateRun.js';

/** JSON with object keys sorted, so the digest does not depend on key order. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().filter((k) => value[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  return JSON.stringify(value ?? null);
}

async function sha256(text) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sealRun(record) {
  const result = evaluateRun(record);
  return { record, result, digest: await sha256(canonicalJson({ record, result })) };
}

/** { intact, digestMatches, resultMatches } for a sealed run (e.g. a downloaded file). */
export async function verifySealed(sealed) {
  const digestMatches = (await sha256(canonicalJson({ record: sealed.record, result: sealed.result }))) === sealed.digest;
  const resultMatches = canonicalJson(evaluateRun(sealed.record)) === canonicalJson(sealed.result);
  return { intact: digestMatches && resultMatches, digestMatches, resultMatches };
}
