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

Id = Binary()  // hash(edit)
CreateTable = Struct({
  // no name!
  ordered: Bool(),
})
Insert = Struct({
  value: JsonObject(),
  target: Id(),
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

function NestedSortedDict(items, root) {
  const watchers = new Set();
  const notify = (...params) => watchers.forEach(w => w(...params));
  const rows = new Map([[root, {null, after: new SortedDict()}]]);

  for (const row of items) {
    rows.set(row.$id, {row, after: new SortedDict()});
  }
  for (const row of items) {
    rows.get(row.$after).after.insert(rows.get(row.$id));
  }

  function watch(watcher) {
    watchers.add(watcher);
  }
  function get(key) {
    return rows.get(key).row;
  }
  function asDict() {
    return new RowDict(rows);
  }
  function* iterateNode(node) {
    if (node.row != null) {
      yield node.row;
    }
    for (const row in node.after) {
      yield* iterate(row);
    }
  }
  function* asList() {
    yield* iterate(rows.get(key));
  }
  function insert(key, row) {
    rows.set(row.$id, {row, after: new SortedDict()});
    rows.get(row.$after).after.insert(rows.get(row.$id));
  }
  function update(key, row) {
    rows.get(key).row = row;
  }
  return {
    load, watch,
    get, asDict, asList, iterate,
    insert, update, delete}
}

async function CrdtTable(idb, tableId, sorted) {
  const constructor = sorted ? NestedSortedDict : SimpleMap;
  const mem = constructor(await db.getAll(tableId), tableId);

  async function insert(key, row) {
    mem.insert(key, row);
    return db.put(tableId, row, key);
  }
  async function update(key, row) {
    mem.update(key, row);
    return db.put(tableId, row, key);
  }
  async function delete(key) {
    mem.delete(key);
    return db.put(tableId, null, key);
  }
  return Object.assign({}, mem, {insert, update, delete});
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

function FilterList() {
  function findPrevUp(x) {
    const parent = x.parent;
    if (parent == null) {
      return null;
    } else if (parent.left == x) {
      return findPrevUp(x.parent);
    } else if (parent.isVisible) {
      return x.parent;
    } else if (parent.left.count > 0) {
      return findPrevDown(x.parent.left);
    } else {
      return findPrevUp(x.parent);
    }
  }
  function findPrevDown(x) {
    if (x.right.count > 0) {
      return findPrevDown(x.right);
    } else if (x.isVisible) {
      return x;
    } else {
      return findPrevDown(x.left);
    }
  }
}

function Database(crdt) {
  return {
    get, map, filter, group, sort,
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
