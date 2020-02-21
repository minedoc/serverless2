function Discovery(server, name) {
  return {onPeer};
}

function Gossip(discovery) {
  const peers = new Map();
  const seen = new Map();
  const entryWatcher = new Observer();
  const serverDefinition = {
    push: [PushRequest, PushResponse, req => {
      if (!seen.has(req.change)) {
        entryWatcher.notify(req.change);
        seen.set(req.change, 1);
      }
    }],
  };
  discovery.onPeer(peer => {
    peers.set(peer.id, peer);
    peer.serve(serverDefinition);
    peer.pushClient = peer.client(serverDefinition);
  });
  const sendEntry = change => {
    for (peer of peers) {
      peer.pushClient.push(change);
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
  Change = Struct({
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

  function processChange(change) {
    switch (op.$type) {
      case TableCreate:
        return;
      case TableInsert:
        var row = Object.assign(op.value, {$clock: change.clock, $id: id, $after: op.target});
        mem.insert(id, row);
        return await db.put(tableId, row, id);
      case TableUpdate:
        var row = merge(table.getEdits(id), op.value);
        row = merge(op.target, change);
        mem.update(id, row);
        return await db.put(tableId, row, id);
      case TableDelete:
        mem.delete(id);
        return await db.put(tableId, null, id);
      default:
        todo();
    }
  }

  return {
    get: id => rows.get(id),
    iterate: function*() { for (const row of rows) yield row; },
    insert, update, delete,  // local change
    processChange,  // remote change
  }
}

function LastWriterWins() {
  const unrooted = new Map();  // target -> [edit]
  const terminal = new SortedMap();  // id -> edit, sorted by clock; subset of rooted
  const rooted = new Map();  // id -> edit
  function add(edit) {
    if (rooted.has(edit) || unrooted.has(edit)) {
      return;
    }
    if (rooted.has(edit.op.target)) {
      move(edit);
      if (terminal.has(edit.op.target)) {
        terminal.remove(edit.op.target);
      }
    } else {
      unrooted.addTo(edit.op.target, edit);
    }
  }
  function move(edit) {
    rooted.add(edit);
    const children = unrooted.getDelete(edit);
    if (children.size() == 0) {
      terminal.add(edit);
    } else {
      children.forEach(move);
    }
  }
  return {add};
}

function ChangeQueue(db, processChange) {
  const pending = new MapSet();
  for (const change of await db.getAll('queue')) {
    pending.add(change.op.target, change);
  }
  function targetAvailable(target) {
    return target == undefined || TODO;
  }
  function enqueue(change) {
    if (targetAvailable(change.op.target)) {
      recursiveDequeue(change);
    } else {
      pending.add(change.op.target, change);
      db.put('queue', change);  // todo
    }
  }
  function recursiveDequeue(change) {
    processChange(change);
    db.remove('queue', change);
    const id = hash(change);
    if (pending.has(id)) {
      pending.remove(id).forEach(e => recursiveDequeue(e));
      db.remove('queue', change);
    }
  }
  return {enqueue};
}

function Tables(gossip, db) {
  const getTable = TODO;
  const getTableByRowId = TODO;
  const changeQueue = ChangeQueue(db, async change => {
    const table = await getTableByRowId(change.op.target);
    table.processChange(change);
  });
  gossip.onEntry(change => changeQueue.enqueue(change));
  return getTable;
}

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
  note hash(change(clock: 1, op: CreateTable()) will collide for same clock!
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
