function Discovery(server, name) {
  return {onPeer};
}

function Gossip(discovery) {
  const peers = new Map();
  const seen = new Map();
  const entryWatcher = new Observer();
  const serverDefinition = {
    push: [PushRequest, PushResponse, req => {
      if (!seen.has(req.entry)) {
        entryWatcher.notify(req.entry);
        seen.set(req.entry, 1);
      }
    }],
  };
  discovery.onPeer(peer => {
    peers.set(peer.id, peer);
    peer.serve(serverDefinition);
    peer.pushClient = peer.client(serverDefinition);
  });
  const sendEntry = entry => {
    for (peer of peers) {
      peer.pushClient.push(entry);
    }
  }
  return {onEntry: entryWatcher.watch, sendEntry};
}

Id = Binary()
CreateTable = Struct({
  // no name!
  ordered: Bool(),
})
Insert = Struct({
  value: JsonObject(),
  target: Id(),  // ordered ? Insert/CreateTable : CreateTable
})
Update = Struct({
  target: Id(),
  value: JsonObject(),
})
Delete = Struct({
  target: Id(),
})
Entry = Struct({
  clock: PackedInt(1, {
    clock: PackedInt.Field(1, 40),
    site: PackedInt.Field(2, 8),
    local: PackedInt.Field(3, 16),
  }),
  op: OneOf(2, [CreateTable, Insert, Update, Delete])
})

db = Database({
  crdt: Crdt(...),
  aliases: {
    foo: Entry(clock)
  },
})
db.dict('foo').map(extend).filter(conditions).group(x => x.name) : Dict
  key
db.dict('foo').sort(byDate) : SortedDict
  iterate, key
db.list('foo').map(extend).filter(conditions) : SortedDict
  iterate, key

function NestedSortedDict(items) {
  const rows = new Map();

  function load(items) {
    const after = new MapSet();
    for (const row of items) {
      const ref = {row, after: SortedDict()}
      rows.set(row.$id, ref);
      after.add(row.$after, ref);
    }
    for (const [id, afterItems] of after) {
      rows.get(id).after.insertMany(afterItems);
    }
  }
  function get(key) {
    return rows.get(key).row;
  }
  function insert(key, row) {
    const ref = {row, after: SortedDict()};
    rows.set(key, ref);
    rows.get(row.$after).after.insert(row);
  }
  function update(key, row) {
    rows.get(key).row = row;
  }
  function asDict() {
  }
  function asList() {
    // iterate
  }
  return {get, insert, update, asDict, asList, load}
}

async function CrdtTable(idb, tableId) {
  const watchers = new Set();
  const notify = (...params) => watchers.forEach(w => w(...params));
  const index = NestedSortedDict().load(await db.getAll(tableId));

  async function get(key) {
    return index.get(key);
  }
  async function getDict() {
    return index.asDict();
  }
  async function getList() {
    return index.asList();
  }
  async function insert(key, row) {
    notify(INSERT, key, row);
    index.insert(key, row);
    return db.put(tableId, row, key);
  }
  async function update(key, row) {
    notify(UPDATE, key, row);
    index.update(key, row);
    return db.put(tableId, row, key);
  }
  async function delete(key) {
    notify(DELETE, key);
    return db.put(tableId, null, key);
  }
  async function watch(watcher) {
    watchers.add(watcher);
  }
  return {get, iterate, insert, update, delete, watch};
}

function WorkQueue(idb, process) {
  const pending = new MapSet();
  function enqueue(entry) {
    if (!entry.op.target || tableFromId(entry.op.target)) {
      recursiveEnqueue(entry);
    } else {
      pending.add(entry.op.target, entry);
    }
  }
  function recursiveEnqueue(entry) {
    process(entry);
    const id = hash(entry);
    if (pending.has(id)) {
      pending.remove(id).forEach(e => recursiveEnqueue(e));
    }
  }
  return {enqueue};
}

function Crdt(gossip, idb) {
  const tableFromId = id => new CrdtTable(TODO);
  const workQueue = WorkQueue(idb, entry => {
    const op = entry.op;
    const id = hash(entry);
    const table = tableFromId(op.target);
    if (op.$type == Insert) {
      table.insert(id, Object.assign(op.value, {$clock: entry.clock, $id: id, $after: op.target}));
    } else if (op.$type == Update) {
      if (row == null) {
        return;
      } else if (row.$clock < entry.clock) {
        table.update(op.target, Object.assign(row, op.value, {$clock: entry.clock});
      } else {
        table.update(op.target, merge(table.getUpdates(op.target), entry));
      }
    } else if (op.$type == Delete) {
      table.delete(op.target);
    }
  });
  gossip.onEntry(entry => workQueue.enqueue(entry));
  return tableFromId;
}

function Database(crdt) {
  return {
    map, filter, group, sort,
    insert, update, delete
  };
}

Database(Crdt(Gossip(Discovery(server, name)), idb));

/*
out of scope
  moves
    for arrays we sort of care -> move = (copy + delete) means edits are lost
    maybe a moved-tombstone that proxies edits to new place
  transaction
    can't happen since history is not linear
    can master elect, but master cant guarantee know everything (what if ignored?)
    would need update([read-ops], [write-ops], [values])
  indexes
    we expect everything to fit in memory
    filter is incremental

how to persist order in database
  map<Key -> (A, B)>
  map<A -> C>
  compare: C < C' or (C == C' and B < B')
  insert:
    prev -> (A, B)
    update (A, b = b+1 where b > B)
    if too many B in A
      split A
  insert requires updating(B/2 + B/2) items (update B, update A)

how to represent local edits
  these changes not written to the database - edit-before-save, local options
  join against local-db

encryption - do later!
  x -> peerKey: talk to peers - Discovery
  w -> integrityKeys: sign content - Gossip
  r -> readKey: decrypt contents - Crdt

decisions
  what happens if duplicate id seen
    content-signature id
      not trivially collidable - need some effort
    user-provided id (discarded)
      con: trivially collidable
  how are arrays represented
    explicit
      crdt maintains order
      getAll returns [...] with ordering applied
      watch insert events have a position
    independent (discarded)
      $ordering string
      $ordering object (hash lookup into tree walk)
