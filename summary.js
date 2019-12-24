// peerKeys and contentKeys are optional symmetric reader keys
// integrityKeys are asymmetric writer keys
function Discovery(server, name, peerKey) {
  return {onPeer};
}

function Gossip(discovery, integrityKeys) {
  const peers = new Map();
  const seen = new Map();
  const entryWatcher = new Observer();
  const server = {
    push: [PushRequest, PushResponse, req => {
      if (integrityCheck(req, integrityKeys)) {
        if (!seen.has(req.entry)) {
          entryWatcher.notify(req.entry);
          seen.set(req.entry, 1);
        }
      }
    }],
  };
  discovery.onPeer(peer => {
    peers.set(peer.id, peer);
    peer.serve(server);
    peer.pushClient = peer.client(server);
  });
  const sendEntry = entry => {
    for (peer of peers) {
      peer.pushClient.push(entry);
    }
  }
  return {onEntry: entryWatcher.watch, sendEntry};
}

function update(entry, crdtTable, entries, apply) {
  if (entry.op == 'create') {
    return apply(crdtTable.get(entry.clock));
  } else if (entry.op == 'update') {
    return update(entries.get(entry.target), crdtTable, entries, x => entry.value);
  } else if (entry.op == 'addField') {
    return update(entries.get(entry.target), crdtTable, entries, x => {
      x[entry.name] = apply(x[entry.name]);
      return x;
    });
  }
}

function Crdt(gossip, readKey) {
  const tables = new DefaultMap(CrdtTable);
  const entries = new Map();
  gossip.onEntry(entry => {
    const op = entry.op;
    if (op == 'create') {  // create(table, value, after)
      const table = tables.get(entry.table);
      table.insert(entry.clock, entry.value, translateToNowRef(entry.after));
    } else if (op == update) {  // update(target, newValue)
      // [update, addField, update-winner]
      if (clockSmaller(entries.getLastUpdate(entry.target).clock, entry.clock)) {
        // walk up and down the path
        const rootKey = not-sure-todo;
        const obj = table.get(rootKey);
        table.update(rootKey, obj);
      }
    } else if (op == addField) {  // addField(target, name, value)
      // [addField, update, addField-winner]
      if (isLastAddField(name)) {
        table.update();
      }
    } else if (op == delete) {  // delete(target)
    }
  });
  return {table: tables.get};
}

function CrdtTable() {
  return {get, getAll, watch, update, insert};
}

function Database(crdt, idb, indices) {
  return {set, merge, index, map, filter, group, sort};
}

/*
replication data model
  tree of edits, siblings have an order: [global-clock, site-id, local-clock]
    sum(sort(edits)) is actual data
    see causal lib
  operations
    create(table, value, after)
    update(op, new-value)
    addField(op, field, value)
    delete(op)
  how are arrays represented
    explicit
      crdt maintains order
      getAll returns [...] with ordering applied
      watch insert events have a position
      trivial to prepend list, but append is difficult?
    independent (discarded)
      $ordering sortable string
      $ordering comparable object (hash lookup into tree walk)
  moves: don't care
  what is an id?
    bigint - 40 / 17 / 20
    encoded as a 13 character id
  transaction - can't happen since history is not linear
    logically it's a simultaneous set of read & writes
    update([read-ops], [write-ops], [values])

actual data
  data = Map<Key, Val>
  order maintenance problem
    insertAfter(x, entry)
    find(x) - returns an iterator
    isBefore(x, y)

after (order) vs set (unordered)
  

oneof
