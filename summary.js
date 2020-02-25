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

function UnorderedTable(db, tableName) {
  const rows = new DbMap(db.store(tableName, 'contents'));  // Map<RowRoot, Value>

  async function mergeEdit(rowId, edit, position) {
    const type = edit.op.$type;
    if (type == TableInsertRow) {
      await rows.set(rowId, edit.op.value);
    } else if (type == TableUpdateRow) {
      // TODO compare position and tombstone and set
      await rows.set(rowId, TODO);
    } else if (type == TableDeleteRow) {
      await rows.set(rowId, tombstone);
    }
  }

  return {
    get: id => filterTombstone(rows.get(id)),
    iterate: function*() { for (const row of rows) if (filterTombstone) yield row; },
    insert, update, delete,  // local edit
    // TODO: how to generate edits
    mergeEdit,  // remote edit
  }
}

function EditSerializer(db, tableMetadata, applyEdit) {
  const unrooted = new DbMapSet(db.store(tableName, 'unrooted'));  // Map<Target, Set<Edit>>
  const rooted = new DbMap(db.store(tableName, 'rooted'));  // Map<EditId, RowRoot>

  async function enqueue(edit) {
    const type = edit.op.$type;
    const editId = hash(edit);
    if (type == TableCreate) {
      await tableMetadata.set(editId, edit.op);
    } else if (type == TableInsertRow) {
      await rowMetadata.set(editId, edit.op.target);
      await plant(edit.op.target, editId, edit, 0);
    } else if (seen(edit.op.target)) {
    } else if (rooted.has(edit.op.target)) {
      const rowId = rooted.get(edit.op.target);
      const table = rowMetadata.get(rowId);
      await plant(table, rowId, edit, TODO);
    } else {
      await unrooted.add(edit.op.target, edit);
    }
  }
  async function plant(table, rowId, edit, position) {
    applyEdit(table, rowId, edit, position);
    rooted.set(hash(edit), edit);
    unrooted.deleteValue(edit);
    unrooted.deleteKey(hash(edit)).forEach(e => plant(table, rowId, e, TODO));
  }
  return {enqueue};
}

function Tables(gossip, db) {
  const tableMetadata = new Map(db.store('tableMetadata'));
  const getTable = tableName => loadTable(db, tableMetadata.get(tableName));
  const editSerializer = EditSerializer(db, tableMetadata, (table, rowId, edit, position) => {
    getTable(table).mergeEdit(rowId, edit, position);
  });
  gossip.onEntry(edit => editSerializer.enqueue(edit));
  return getTable;
}

/*
think
  how to remove duplication of storage

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
