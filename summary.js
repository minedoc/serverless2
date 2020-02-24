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
  TableInsertRow = Struct({
    value: JsonObject(),
    target: Id(),
  })
  TableUpdateRow = Struct({
    target: Id(),
    value: JsonObject(),
  })
  TableDeleteRow = Struct({
    target: Id(),
  })
  Edit = Struct({
    clock: PackedInt(1, {
      global: PackedInt.Field(1, 40),
      site: PackedInt.Field(2, 8),
      local: PackedInt.Field(3, 16),
    }),
    op: OneOf(2, [TableCreate, TableInsertRow, TableUpdateRow, TableDeleteRow])
  })
}

function UnorderedTable(db, tableRoot) {
  const rows = new DbMap(db.store(tableRoot, 'contents'));  // Map<RowRoot, Value>
  const unrooted = new DbMapSet(db.store(tableRoot, 'unrooted'));  // Map<RowRoot, Set<Edit>>
  const leaf = new DbMapSortedSet(db.store(tableRoot, 'leaf'));  // Map<RowRoot, SortedSet<Edit, EditClock>>
  const rooted = new DbMap(db.store(tableRoot, 'rooted'));  // Map<EditId, RowRoot>
  const tombstone = new DbSet(db.store(tableRoot, 'tombstone'));  // Set<Edit> - TODO - not propagated correctly

  async function applyEdit(edit) {
    const type = edit.op.$type;
    const editId = hash(edit);
    if (type == TableInsertRow) {
      await rows.set(editId, edit.op.value);
      await leaf.add(editId, edit);
      await rooted.set(editId, editId);
    } else if (type == TableUpdateRow) {
      if (tombstone.has(edit) || rooted.has(editId) || unrooted.hasValue(edit)) {
        return;
      } else if (rooted.has(editId)) {
        const rowId = rooted.get(editId);
        await leaf.removeValue(edit.op.target);
        await move(rowId, edit);
        await rows.set(rowId, leaf.getKey(rowId).biggest);
      } else {
        await unrooted.add(edit.op.target, edit);
      }
    } else if (type == TableDeleteRow) {
      await tombstone.add(edit);
      await rows.delete(rowId);
    }
  }

  async function move(rowId, edit) {
    await rooted.set(hash(edit), rowId);
    const children = await unrooted.deleteValue(edit);
    if (children.size() == 0) {
      await leaf.add(rowId, edit);
    } else {
      await Promise.all(children.map(e => move(rowId, e)));
    }
  }

  return {
    get: id => rows.get(id),
    iterate: function*() { for (const row of rows) yield row; },
    insert, update, delete,  // local edit
    // TODO: how to generate edits
    applyEdit,  // remote edit
  }
}

function ChangeQueue(db, applyEdit) {
  const queue = new DbMapSet(db.store('queue');
  function targetAvailable(target) {
    return target == undefined || TODO;
  }
  function enqueue(edit) {
    if (targetAvailable(edit.op.target)) {
      recursiveDequeue(edit);
    } else {
      queue.add(edit.op.target, edit);
    }
  }
  function recursiveDequeue(edit) {
    applyEdit(edit);
    queue.deleteValue(edit);
    const id = hash(edit);
    if (queue.hasKey(id)) {
      queue.deleteKey(id).forEach(e => recursiveDequeue(e));
    }
  }
  return {enqueue};
}

function Tables(gossip, db) {
  const getTable = TODO;
  const getTableByRowId = TODO;
  const changeQueue = ChangeQueue(db, async edit => {
    const table = await getTableByRowId(edit.op.target);
    table.applyEdit(edit);
  });
  gossip.onEntry(edit => changeQueue.enqueue(edit));
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
  update edits (instead of lww)
    efficient serialization
    efficient partial updates (timestamped fields) - but timestamp insufficient
  rebase for long offline
    pull edits
    rebase your edits onto head
      provide a conflict resolver UI for conflicts
      for LWW not for mis-ordering
    if only two computers there's no 'head'

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
