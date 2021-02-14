function hexToByteString(hex) {
  var bytes = [];
  for (var c = 0; c < hex.length; c += 2) {
    bytes.push(String.fromCharCode(parseInt(hex.substr(c, 2), 16)));
  }
  return bytes.join('');
}

const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const randomChar = () => alphabet[Math.floor(alphabet.length * Math.random())];
function randomChars(length) {
  return Array.from({length}, randomChar).join('');
}

function mapRemove(map, key, value) {
  if (!map.has(key)) {
    throw 'could not find';
  }
  const result = map.get(key);
  map.delete(key);
  return result;
}

async function hashBin(binary) {
  // strings: Map compares buffers by reference, string keys are easier to read
  const hash = new Uint16Array(await crypto.subtle.digest('SHA-256', binary));
  const base = alphabet.length;
  const out = [];
  var current = 0;
  for (var i=0; i<hash.length; i++) {
    current = current * 65536 + hash[i];
    const octet = [];
    while (current >= base) {
      const remainder = current % base;
      octet.push(alphabet[remainder]);
      current = (current - remainder) / base;
    }
    out.push(octet);
  }
  out[out.length-1].push(alphabet[current]);
  return out.flatMap(x => x.reverse()).join('');
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

export {hexToByteString, randomChars, mapRemove, hashBin, randomId, promiseFn, join, clockLessThan};
