import {Database} from './database.js';
import {base64Encode, base64Decode, randomChars} from './util.js';

async function init() {
  const hash = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode('password'));
  const readKey = await window.crypto.subtle.importKey('raw', hash, {name: 'AES-GCM'}, false, ['encrypt', 'decrypt']);
  window.db = await Database({
    name: 'foo',
    tracker: 'wss://tracker.openwebtorrent.com',
    feed: 'aqT7R2SwarrmEInYFU4s',  // randomChars(20);
    frozen: true,
    validate: true,
    readKey,
  });
}

export {init};
