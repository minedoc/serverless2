import {clockLessThan, checkSimpleValue, freeze, DefaultMap} from './util.js';

function Tables(idb, frozen, validate) {
  const tables = new DefaultMap(x => new Map());
  const clocks = new DefaultMap(x => new Map());
  let writes = [];

  const readOnly = frozen ? freeze : x => x;
  const validator = validate ? checkSimpleValue : x => x;

  function persist() {
    const store = idb.transaction('tables', 'readwrite').objectStore('tables');
    writes.map(write => {
      store.get(write.id).onsuccess = fetch => {
        if (fetch.result == undefined || clockLessThan(fetch.result.clock, clock)) {
          store.put(write);
        }
      };
    });
    writes = [];
  }
  function newerEdit(table, rowId, clock) {
    const c = clocks.get(table);
    return !c.has(rowId) || clockLessThan(c.get(rowId), clock);
  }
  function setValue(table, rowId, clock, value) {
    if (validator(value) && newerEdit(table, rowId, clock)) {
      tables.get(table).set(rowId, readOnly(value));
      clocks.get(table).set(rowId, clock);
      writes.push({id: [table, rowId], clock, value});
    }
  }
  function removeRow(table, rowId, clock) {
    if (newerEdit(table, rowId, clock)) {
      tables.get(table).delete(rowId, clock);
      clocks.get(table).set(rowId, clock);
      writes.push({id: [table, rowId], clock, removed: true});
    }
  }
  return new Promise((resolve, reject) => {
    const req = idb.transaction('tables', 'readonly').objectStore('tables').getAll();
    let maxClock = {
      global: 0,
      site: Math.floor(Math.random() * 10000),
      local: 0,
    };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      for(const row of req.result) {
        const [table, rowId] = row.id;
        if (!row.removed) {
          tables.get(table).set(rowId, readOnly(row.value));
        }
        clocks.get(table).set(rowId, row.clock);
        if (maxClock.global <= row.clock.global) {
          maxClock.global = row.clock.global + 1;
        }
      }
      setInterval(persist, 500);
      resolve([{getTable: x => tables.get(x), setValue, removeRow}, maxClock]);
    }
  });
}

export {Tables};
