// m should specify the number of bits
// k specifies the number of hashing functions.

function BloomFilter(buckets) {
  const hashes = buckets[0];
  const bits = (buckets.length-1)* 8;

  // See http://willwhim.wpengine.com/2011/09/03/producing-n-hash-functions-by-hashing-only-once/
  function locations(v) {
    const r = [];
    const a = positiveMod(fnv_1a(v, 0), bits);
    const b = positiveMod(fnv_1a(v, 1576284489), bits); // The seed value is chosen randomly
    var x = a;
    for (var i = 0; i < hashes; ++i) {
      r[i] = x;
      x = (x + b) % bits;
    }
    return r;
  }
  function add(v) {
    const l = locations(v);
    for (var i = 0; i < hashes; i++) {
      buckets[Math.floor(l[i] / 8) + 1] |= 1 << (l[i] % 8)
    };
  }
  function has(v) {
    if (bits == 0) {
      return false;
    }
    const l = locations(v);
    for (var i = 0; i < hashes; i++) {
      if ((buckets[Math.floor(l[i] / 8) + 1] & (1 << (l[i] % 8))) === 0) {
        return false;
      }
    }
    return true;
  };
  return {add, has, toBinary: () => buckets};
}
BloomFilter.fromSize = function(items, probability=0.0000001) {
  const idealBits = -Math.ceil(items * Math.log2(probability) / Math.log(2));
  const hashes = Math.round(idealBits / items * Math.log(2));
  const bytes = Math.ceil(idealBits / 8);
  const buckets = new Uint8Array(bytes + 1);
  buckets[0] = hashes;
  return BloomFilter(buckets);
}

const positiveMod = (x, y) => ((x % y) + y) % y;

// Fowler/Noll/Vo hashing.
// Nonstandard variation: this function optionally takes a seed value that is incorporated
// into the offset basis. According to http://www.isthe.com/chongo/tech/comp/fnv/index.html
// "almost any offset_basis will serve so long as it is non-zero".
function fnv_1a(v, seed) {
  var a = 2166136261 ^ seed;
  for (var i = 0, n = v.length; i < n; ++i) {
    var c = v.charCodeAt(i),
        d = c & 0xff00;
    if (d) a = fnv_multiply(a ^ d >> 8);
    a = fnv_multiply(a ^ c & 0xff);
  }
  return fnv_mix(a);
}

// a * 16777619 mod 2**32
function fnv_multiply(a) {
  return a + (a << 1) + (a << 4) + (a << 7) + (a << 8) + (a << 24);
}

// See https://web.archive.org/web/20131019013225/http://home.comcast.net/~bretm/hash/6.html
function fnv_mix(a) {
  a += a << 13;
  a ^= a >>> 7;
  a += a << 3;
  a ^= a >>> 17;
  a += a << 5;
  return a & 0xffffffff;
}

export {BloomFilter};
