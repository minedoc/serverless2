import {Changes} from './changes.js';
import {Share} from './share.js';
import {Tables} from './tables.js';
import {Update, Delete, Change} from './types.js';
import {base64Decode, base64Encode, randomChars, randomId} from './util.js';

const State = {
  empty: Symbol('empty'),
  ready: Symbol('ready'),
};

const Connectivity = {
  online: Symbol('online'),
  offline: Symbol('offline'),
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

  function Table(name) {
    this.name = name;
    this.data = tables.getTable(name);
  }
  // missing: set, clear
  Table.prototype.get = function get(key) { return this.data.get(key) }
  Table.prototype.has = function has(key) { return this.data.has(key) }
  Table.prototype.keys = function keys() { return this.data.keys() }
  Table.prototype.size = function size() { return this.data.size() }
  Table.prototype.values = function values() { return this.data.values() }
  Table.prototype.entries = function entries() { return this.data.entries() }
  Table.prototype.forEach = function forEach(callback, thisArg) { return this.data.forEach(callback, thisArg) }
  Table.prototype[Symbol.iterator] = Table.prototype.entries;
  Table.prototype.insert = function insert(value) {
    const clock = getNextClock();
    const rowId = randomId();
    tables.setValue(this.name, rowId, clock, value);
    share.saveLocalChange(Change.write(Update.wrap({clock, table: this.name, rowId, value})));
    return rowId;
  };
  Table.prototype.update = function update(rowId, value) {
    const clock = getNextClock();
    tables.setValue(this.name, rowId, clock, value);
    share.saveLocalChange(Change.write(Update.wrap({clock, table: this.name, rowId, value})));
    return value;
  }
  Table.prototype.delete = function(rowId) {
    const value = this.data.get(rowId);
    const clock = getNextClock();
    tables.removeRow(this.name, rowId, clock);
    share.saveLocalChange(Change.write(Delete.wrap({clock, table: this.name, rowId})));
    return value;
  }

  function state() {
    return changes.changeList.length > 0 ? State.ready : State.empty;
  }
  function connectivity() {
    return share.peerCount() > 0 ? Connectivity.online : Connectivity.offline;
  }

  return {table: name => new Table(name), state, connectivity};
}

export {Database, State, Connectivity, newConnectionString};
