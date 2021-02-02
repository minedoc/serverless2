import {Database} from './database.js';

async function init() {
  window.db = await Database({
    name: 'foo',
    tracker: 'wss://tracker.openwebtorrent.com',
    feed: '9aa6481d5855fae13cfe81580b2ebc36becf3d2c',
  });
}

export {init};
