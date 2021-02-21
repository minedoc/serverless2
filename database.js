import {Changes} from './changes.js';
import {Share} from './share.js';
import {Tables} from './tables.js';
import {Update, Delete, Change} from './types.js';
import {base64Decode, base64Encode, randomChars, randomId} from './util.js';

const State = {
  empty: Symbol('empty'),
  ready: Symbol('ready'),
};

function newConnectionString(settings) {
  return (
    randomChars(20) +  // feed
    base64Encode(window.crypto.getRandomValues(new Uint8Array(16)))  // readKey 16 or 32
  );
}

async function Database(name, connection, settings={}) {
  const feed = connection.substr(0, 20);
  const readKey = await window.crypto.subtle.importKey('raw', base64Decode(connection.substr(20)), {name: 'AES-GCM'}, false, ['encrypt', 'decrypt']);
  const {
    tracker = 'wss://tracker.openwebtorrent.com',
    frozen = true,
    validate = true,
    onConflict = x => console.log('conflict found', x),
  } = settings;
  const idb = await new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      switch (event.oldVersion) {
        case 0:
          db.createObjectStore('tables', {keyPath: 'id', autoIncrement: false});
          db.createObjectStore('changes', {keyPath: 'hash', autoIncrement: false});
      }
    };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
  });
  const [tables, clock] = await Tables(idb, frozen, validate);
  const changes = await Changes(idb);
  const share = await Share(changes, tracker, feed, readKey, onRemoteChange, onConflict);

  function onRemoteChange(hash, change) {
    if (clock.global <= change.clock.global) {
      clock.global = change.clock.global + 1;
      clock.local = 0;
    }
    if (change.$type == Update) {
      tables.setValue(change.table, change.rowId, change.clock, change.value);
    } else if (change.$type == Delete) {
      tables.removeRow(change.table, change.rowId, change.clock);
    }
  }

  function getNextClock() {
    clock.local++;
    return {...clock};
  }

  function Table(table) {
    const data = tables.getTable(table);
    function Table(table) {
      this.table = table;
    }
    // missing methods: set, clear
    Table.prototype.get = key => data.get(key);
    Table.prototype.has = key => data.has(key);
    Table.prototype.keys = x => data.keys();
    Table.prototype.size = x => data.size();
    Table.prototype.values = x => data.values();
    Table.prototype.entries = Table.prototype[Symbol.iterator] = x => data.entries();
    Table.prototype.forEach = (callback, thisArg) => data.forEach(callback, thisArg);
    Table.prototype.insert = value => {
      const clock = getNextClock();
      const rowId = randomId();
      tables.setValue(table, rowId, clock, value);
      share.saveLocalChange(Change.write(Update.wrap({clock, table, rowId, value})));
      return rowId;
    };
    Table.prototype.update = (rowId, value) => {
      const clock = getNextClock();
      tables.setValue(table, rowId, clock, value);
      share.saveLocalChange(Change.write(Update.wrap({clock, table, rowId, value})));
      return value;
    };
    Table.prototype.delete = rowId => {
      const value = data.get(rowId);
      const clock = getNextClock();
      tables.removeRow(table, rowId, clock);
      share.saveLocalChange(Change.write(Delete.wrap({clock, table, rowId})));
      return value;
    };
    return new Table(table);
  }

  function state() {
    return changes.changeList.length > 0 ? State.ready : State.empty;
  }

  return {table: name => Table(name), state, peerCount: share.peerCount };
}

export {Database, State, newConnectionString};
