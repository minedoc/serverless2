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
  function insert(table, value) {
    const clock = getNextClock();
    const rowId = randomId();
    tables.setValue(table, rowId, clock, value);
    share.sendChange(Change.write(Update.wrap({clock, table, rowId, value})));
    return rowId;
  }
  function update(table, rowId, value) {
    const clock = getNextClock();
    tables.setValue(table, rowId, clock, value);
    share.sendChange(Change.write(Update.wrap({clock, table, rowId, value})));
  }
  function remove(table, rowId) {
    const clock = getNextClock();
    tables.removeRow(table, rowId, clock);
    share.sendChange(Change.write(Delete.wrap({clock, table, rowId})));
  }
  function state() {
    return changes.changeList.length > 0 ? State.ready : State.empty;
  }
  function connectivity() {
    return share.peerCount() > 0 ? Connectivity.online : Connectivity.offline;
  }

  return {table: tables.getTable, insert, update, remove, state, connectivity};
}

export {Database, State, Connectivity};
