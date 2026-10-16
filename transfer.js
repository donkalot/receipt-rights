// Moves a backup between devices. The key lives only in the link's #fragment, which browsers
// never send to a server, so the relay only ever holds ciphertext.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Transfer = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const RAW = 1;
  const GZIP = 2;
  const MAX_BYTES = 20 * 1024 * 1024;

  function toB64url(bytes) {
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function fromB64url(str) {
    return Uint8Array.from(atob(str.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  }

  async function pipe(bytes, Stream) {
    const out = new Blob([bytes]).stream().pipeThrough(new Stream('gzip'));
    return new Uint8Array(await new Response(out).arrayBuffer());
  }

  async function seal(obj, { compress = typeof CompressionStream !== 'undefined' } = {}) {
    const keyBytes = crypto.getRandomValues(new Uint8Array(32));
    const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    let plain = new TextEncoder().encode(JSON.stringify(obj));
    if (compress) plain = await pipe(plain, CompressionStream);
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
    const blob = new Uint8Array(1 + iv.length + ct.length);
    blob[0] = compress ? GZIP : RAW;
    blob.set(iv, 1);
    blob.set(ct, 1 + iv.length);
    return { key: toB64url(keyBytes), blob };
  }

  async function open(blob, keyStr) {
    const bytes = new Uint8Array(blob);
    if (bytes[0] !== RAW && bytes[0] !== GZIP) throw new Error('Unknown transfer format');
    const key = await crypto.subtle.importKey('raw', fromB64url(keyStr), 'AES-GCM', false, ['decrypt']);
    let plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(1, 13) }, key, bytes.subarray(13)));
    if (bytes[0] === GZIP) plain = await pipe(plain, DecompressionStream);
    return JSON.parse(new TextDecoder().decode(plain));
  }

  const makeLink = (base, id, key) => `${base}#/receive/${id}.${key}`;

  function parseLink(text) {
    const m = String(text || '').match(/#\/receive\/([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/);
    return m ? { id: m[1], key: m[2] } : null;
  }

  return { seal, open, makeLink, parseLink, MAX_BYTES };
});
