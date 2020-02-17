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

function Schema() {
  Id = Binary()  // hash(edit)
  TableCreate = Struct({
    // no name!
    ordered: Bool(),
  })
  TableInsert = Struct({
    value: JsonObject(),
    target: Id(),
  })
  TableUpdate = Struct({
    target: Id(),
    value: JsonObject(),
  })
  TableDelete = Struct({
    target: Id(),
  })
  Entry = Struct({
    clock: PackedInt(1, {
      global: PackedInt.Field(1, 40),
      site: PackedInt.Field(2, 8),
      local: PackedInt.Field(3, 16),
    }),
    op: OneOf(2, [TableCreate, TableInsert, TableInsert, TableUpdate, TableDelete])
  })
}

function UnorderedTable(items, root) {
  const rows = new Map();
  for (const [id, row] of items) {
    rows.set(id, row);
  }

  return {
    get: id => rows.get(id),
    iterate: function*() { for (const row of rows) yield row; },
    insert: (id, row) => rows.set(id, row),
    update: (id, row) => rows.set(id, row),
    delete: (id) => rows.delete(id),
  }
}

function OpQueue(idb, process) {
  const pending = new MapSet();
  for (const [k, v] of await idb.getAll('queue')) {
    pending.add(k, v);
  }
  function targetAvailable(target) {
    return target == undefined || TODO;
  }
  function enqueue(entry) {
    if (targetAvailable(entry.op.target)) {
      recursiveDequeue(entry);
    } else {
      pending.add(entry.op.target, entry);
    }
  }
  function recursiveDequeue(entry) {
    process(entry);
    const id = hash(entry);
    if (pending.has(id)) {
      pending.remove(id).forEach(e => recursiveDequeue(e));
    }
  }
  return {enqueue};
}

function ReplicatedTables(gossip, idb) {
  const tableFromId = TODO;
  const opQueue = OpQueue(idb, async entry => {
    const op = entry.op;
    const id = hash(entry);
    const table = await tableFromId(op.target);
    switch (op.$type) {
      case TableCreate:
        return;
      case TableInsert:
        var row = Object.assign(op.value, {$clock: entry.clock, $id: id, $after: op.target});
        mem.insert(id, row);
        return await db.put(tableId, row, id);
      case TableUpdate:
        var row = merge(table.getEdits(id), op.value);
        row = merge(op.target, entry);
        mem.update(id, row);
        return await db.put(tableId, row, id);
      case TableDelete:
        mem.delete(key);
        return await db.put(tableId, null, key);
    }
  });
  gossip.onEntry(entry => opQueue.enqueue(entry));
  return tableFromId;
}

Crdt(Gossip(Discovery(server, name)), idb);

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
  watch -> map and filter
    leave them out for first draft
  ordered dictionaries
    do later

data structures
  Map(key => val)
    key is created for you, unlikely to collide
  Object(key => val)
    you set key, lww
  List(key => val)
    like map but with ordering

do we get to choose refs?
  table name, row key
  what about like git:
    refs [ name => id ]
  what about you just hard code it?
  note hash(Entry(clock: 1, op: CreateTable()) will collide for same clock!
    this only causes troubles where you intended to create two lists but got one

how to represent
  local edits
    these changes not written to the database - edit-before-save, local options
    join against local-db
  not-replicated edits
    choose override or underride
    CreateTable operations get re-clocked to avoid collision

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
