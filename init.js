import {Database} from './database.js';

async function init() {
  const hash = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode('password'));
  const readKey = await window.crypto.subtle.importKey('raw', hash, {name: 'AES-GCM'}, false, ['encrypt', 'decrypt']);
  window.db = await Database({
    name: 'foo',
    tracker: 'wss://tracker.openwebtorrent.com',
    feed: '9aa6481d5855fae13cfe81580b2ebc36becf3d2c',
    frozen: true,
    validate: true,
    readKey,
  });
}

export {init};
