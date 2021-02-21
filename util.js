const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_';
const randomChar = () => alphabet[Math.floor(alphabet.length * Math.random())];
function randomChars(length) {
  return Array.from({length}, randomChar).join('');
}

function mapRemove(map, key, value) {
  if (!map.has(key)) {
    throw {error: 'could not find key', key, map};
  }
  const result = map.get(key);
  map.delete(key);
  return result;
}

function base64Encode(buffer) {
  const bytes = new Uint8Array(buffer);
  var out = "";
  for (var i=0; i<bytes.byteLength; i+=3) {
    out += alphabet[bytes[i] >> 2];
    out += alphabet[((bytes[i] & 3) << 4) | (bytes[i + 1] >> 4)];
    out += alphabet[((bytes[i + 1] & 15) << 2) | (bytes[i + 2] >> 6)];
    out += alphabet[bytes[i + 2] & 63];
  }
  const remainder = bytes.byteLength % 3;
  if (remainder > 0) {
    out = out.slice(0, remainder - 3);
  }
  return out;
}

const inverseAlphabet = new Uint8Array(256);
for (var i=0; i<alphabet.length; i++) {
  inverseAlphabet[alphabet.charCodeAt(i)] = i;
}
function base64Decode(string) {
  const out = new Uint8Array(string.length * 0.75);
  const digits = new Array(string.length);
  for (var i=0; i<string.length; i++) {
    digits[i] = inverseAlphabet[string.charCodeAt(i)];
  }
  var p=0;
  for (var i=0; i<string.length; i+=4) {
    out[p++] = (digits[i] << 2) | (digits[i+1] >> 4);
    out[p++] = ((digits[i+1] & 15) << 4) | (digits[i+2] >> 2);
    out[p++] = ((digits[i+2] & 3) << 6) | (digits[i+3] & 63);
  }
  return out;
}

function randomId() {
  const base = alphabet.length;
  const out = [];
  let now = Math.floor(Date.now() / 1000);
  while (now > 0) {
    const remainder = now % base;
    out.push(alphabet[remainder]);
    now = (now - remainder) / base
  }
  out.reverse();
  return out.join('') + randomChars(6);
}

function promiseFn() {
  var accept, reject;
  return [new Promise((a, r) => {accept = a; reject = r}), accept, reject];
}

function join(left, right, callback) {
  for (var [key, leftVal] of left.entries()) {
    if (right.has(key)) {
      callback(leftVal, right.get(key));
    }
  }
}

function clockLessThan(c1, c2) {
  return (c1.global < c2.global
    || (c1.global == c2.global && (c1.site < c2.site
      || (c1.site == c2.site && c1.local < c2.local))));
}

function checkSimpleValue(x) {
  const typ = typeof x;
  if (typ == 'function' || typ == 'symbol' || typ == 'bigint') {
    throw {error: 'can only store simple values', value: x};
  } else if (typ == 'object') {
    if (x == null) {
    } else if (Array.isArray(x)) {
      for (var i=0; i<x.length; i++) {
        checkSimpleValue(x[i]);
      }
    } else if (x.constructor == Object) {
      for (const [key, value] of Object.entries(x)) {
        checkSimpleValue(value);
      }
    } else {
      throw {error: 'can only store simple values', value: x};
    }
  }
  return true;
}

function freezeProxy(x) {
  if (typeof x == 'object') {
    return x === null ? null : new Proxy(x, {
      get: (x, f) => freeze(x[f]),
      set: x => {throw 'Rows are immutable, use table.update to change them'},
    });
  } else {
    return x;
  }
}

function freeze(x) {
  if (typeof x == 'object' && x != null) {
    Object.freeze(x);
    Object.keys(x).forEach(p => freeze(x[p]));
  }
  return x;
}

class DefaultMap extends Map {
  constructor(def) {
    super()
    this._default = def;
  }
  get(key) {
    if (this.has(key)) {
      return super.get(key);
    } else {
      const value = this._default();
      this.set(key, value);
      return value;
    }
  }
}

export {randomChars, mapRemove, base64Encode, base64Decode, randomId, promiseFn, join, clockLessThan, checkSimpleValue, freeze, DefaultMap};
