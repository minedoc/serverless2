const wordSize = 8, wordConstructor = Uint8Array;
const minItems = 1000;  // under this level bloomfilter unreliable
const OFFSET = 2, HASH_OFFSET = 2;
const SEED_OFFSET = 1;

function BloomFilter(binary) {
  const hashes = binary[binary.length - HASH_OFFSET];
  const seed = binary[binary.length - SEED_OFFSET];
  const bits = (binary.length - OFFSET) * wordSize;

  // "Enhanced Double Hashing" Peter C. Dillinger and Panagiotis Manolios
  function getIndices(key) {
    let hash1 = murmurhash3_32_gc(key, 0x4b21941e + seed) % bits;
    let hash2 = murmurhash3_32_gc(key, 0x0931fc11 + hash1) % bits;
    let indices = [hash1];
    for (var i = 1; i < hashes; i++) {
      hash1 = (hash1 + hash2) % bits;
      hash2 = (hash2 + i) % bits;
      indices[i] = hash1;
    }
    return indices;
  }
  function add(key) {
    const l = getIndices(key);
    for (var i = 0; i < hashes; i++) {
      binary[Math.floor(l[i] / wordSize)] |= 1 << (l[i] % wordSize)
    };
  }
  function has(key) {
    if (bits == 0) {
      return false;
    }
    const l = getIndices(key);
    for (var i = 0; i < hashes; i++) {
      if ((binary[Math.floor(l[i] / wordSize)] & (1 << (l[i] % wordSize))) === 0) {
        return false;
      }
    }
    return true;
  };
  return {add, has, binary};
}
BloomFilter.fromSize = function(items, probability=0.0000001) {
  const ln2 = Math.log(2);
  const bits = Math.ceil(-Math.max(items, minItems) * Math.log(probability) / ln2 / ln2);
  const hashes = Math.ceil(-Math.log(probability) / ln2);
  const bitsPow2 = Math.pow(2, Math.ceil(Math.log2(bits)));
  const binary = new wordConstructor(bitsPow2 / wordSize + OFFSET);
  binary[binary.length - HASH_OFFSET] = hashes;
  binary[binary.length - SEED_OFFSET] = Math.floor(Math.random() * 1000000);
  return BloomFilter(binary);
}

// MurmurHash3 - Gary Court and Austin Appleby
// http://github.com/garycourt/murmurhash-js
function murmurhash3_32_gc(key, seed) {
  var remainder, bytes, h1, h1b, c1, c1b, c2, c2b, k1, i;
  remainder = key.length & 3; // key.length % 4
  bytes = key.length - remainder;
  h1 = seed;
  c1 = 0xcc9e2d51;
  c2 = 0x1b873593;
  i = 0;
  while (i < bytes) {
    k1 =
      ((key.charCodeAt(i) & 0xff)) |
      ((key.charCodeAt(++i) & 0xff) << 8) |
      ((key.charCodeAt(++i) & 0xff) << 16) |
      ((key.charCodeAt(++i) & 0xff) << 24);
    ++i;
    k1 = ((((k1 & 0xffff) * c1) + ((((k1 >>> 16) * c1) & 0xffff) << 16))) & 0xffffffff;
    k1 = (k1 << 15) | (k1 >>> 17);
    k1 = ((((k1 & 0xffff) * c2) + ((((k1 >>> 16) * c2) & 0xffff) << 16))) & 0xffffffff;

    h1 ^= k1;
    h1 = (h1 << 13) | (h1 >>> 19);
    h1b = ((((h1 & 0xffff) * 5) + ((((h1 >>> 16) * 5) & 0xffff) << 16))) & 0xffffffff;
    h1 = (((h1b & 0xffff) + 0x6b64) + ((((h1b >>> 16) + 0xe654) & 0xffff) << 16));
  }
  k1 = 0;
  switch (remainder) {
    case 3: k1 ^= (key.charCodeAt(i + 2) & 0xff) << 16;
    case 2: k1 ^= (key.charCodeAt(i + 1) & 0xff) << 8;
    case 1: k1 ^= (key.charCodeAt(i) & 0xff);
    k1 = (((k1 & 0xffff) * c1) + ((((k1 >>> 16) * c1) & 0xffff) << 16)) & 0xffffffff;
    k1 = (k1 << 15) | (k1 >>> 17);
    k1 = (((k1 & 0xffff) * c2) + ((((k1 >>> 16) * c2) & 0xffff) << 16)) & 0xffffffff;
    h1 ^= k1;
  }
  h1 ^= key.length;

  h1 ^= h1 >>> 16;
  h1 = (((h1 & 0xffff) * 0x85ebca6b) + ((((h1 >>> 16) * 0x85ebca6b) & 0xffff) << 16)) & 0xffffffff;
  h1 ^= h1 >>> 13;
  h1 = ((((h1 & 0xffff) * 0xc2b2ae35) + ((((h1 >>> 16) * 0xc2b2ae35) & 0xffff) << 16))) & 0xffffffff;
  h1 ^= h1 >>> 16;

  return h1 >>> 0;
}

export {BloomFilter};
