function hexToByteString(hex) {
  var bytes = [];
  for (var c = 0; c < hex.length; c += 2) {
    bytes.push(String.fromCharCode(parseInt(hex.substr(c, 2), 16)));
  }
  return bytes.join('');
}

const base64 = {
  encode(data) {
    return window.btoa(Array.from(new Uint8Array(data)).map(x => String.fromCharCode(x)).join(''));
  },
  decode(base64) {
    var bin = window.atob(base64);
    var result = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) {
      result[i] = bin.charCodeAt(i);
    }
    return result;
  },
};

const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const randomChar = () => chars[Math.floor(chars.length * Math.random())];
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

function mapSet(map, key, value) {
  map.set(key, value);
  return value;
}

function sleep(ms, value) {
  return new Promise(resolve => setTimeout(() => resolve(value), ms));
}

function Event() {
  const watchers = new Map();

  function emit(name, ...args) {
    (watchers.get(name) || []).forEach(fn => fn.apply(null, args));
  }

  function on(name, fn) {
    (watchers.get(name) || mapSet(watchers, name, new Set())).add(fn);
  }

  return {on, emit, watchers};
}

const cmp = (a, b) => (a > b ? 1 : (a < b ? -1 : 0));
function sortBy(array, key) {
  return array.slice(0).sort((a, b) => cmp(key(a), key(b)));
}

function LeaderChannel(process) {
  const worker = new SharedWorker('leaderChannel.js');
  worker.port.onmessage = event => {
    process(event);
  };
  function send(message) {
    worker.port.postMessage(message);
    return TODO.hasLeaderAcknowledgedMessage();
  }
  return {send};
}

export {hexToByteString, base64, randomChars, mapRemove, mapSet, sleep, Event, sortBy};
