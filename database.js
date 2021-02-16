import {Changes} from './changes.js';
import {Share} from './share.js';
import {Tables} from './tables.js';
import {Update, Delete, Change} from './types.js';
import {randomId} from './util.js';

const State = {
  empty: Symbol('empty'),
  ready: Symbol('ready'),
};

const Connectivity = {
  online: Symbol('online'),
  offline: Symbol('offline'),
};

/* settings { name, tracker, feed, readKey, frozen, validate } */
async function Database(settings) {
  const idb = await new Promise((resolve, reject) => {
    const req = indexedDB.open(settings.name, 1);
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
  const [tables, clock] = await Tables(idb, settings);
  const changes = await Changes(idb);
  const share = await Share(changes, settings, (hash, change) => {
    if (change.clock.global >= clock.global) {
      clock.global = change.clock.global + 1;
      clock.local = 0;
    }
    if (change.$type == Update) {
      tables.setValue(change.table, change.rowId, change.clock, change.value);
    } else if (change.$type == Delete) {
      tables.removeRow(change.table, change.rowId, change.clock);
    }
  }, settings.onConflict ?? (x => console.log('conflicts found', x)));

  function getNextClock() {
    clock.local++;
    return clock;
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
    share.sendChange(Change.write(Update.wrap({clock, table: this.name, rowId, value})));
    return rowId;
  };
  Table.prototype.update = function update(rowId, value) {
    const clock = getNextClock();
    tables.setValue(this.name, rowId, clock, value);
    share.sendChange(Change.write(Update.wrap({clock, table: this.name, rowId, value})));
  }
  Table.prototype.delete = function(table, rowId) {
    const clock = getNextClock();
    tables.removeRow(this.name, rowId, clock);
    share.sendChange(Change.write(Delete.wrap({clock, table: this.name, rowId})));
  }

  function state() {
    return changes.changeList.length > 0 ? State.ready : State.empty;
  }
  function connectivity() {
    return share.peerCount() > 0 ? Connectivity.online : Connectivity.offline;
  }

  return {table: name => new Table(name), state, connectivity};
}

export {Database, State, Connectivity};
