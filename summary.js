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
  Edit = Struct({
    clock: PackedInt(1, {
      global: PackedInt.Field(1, 40),
      site: PackedInt.Field(2, 8),
      local: PackedInt.Field(3, 16),
    }),
    op: OneOf(2, [TableCreate, TableInsertRow, TableUpdateRow, TableDeleteRow])
  })
}

function UnorderedMap(db, tableId) {
  const rows = new DbMap(db.store(tableId, 'rows'));  // Map<rowId, {depth, clock, tombstone, value}>

  async function applyEdit(editId, edit, depth, {tableId, rowId}) {
    const clock = edit.clock;
    if (edit.op.$type == TableInsertRow) {
      rows.set(editId, {depth, clock, tombstone: false, value: edit.op.value});
      return {tableId, rowId: editId};
    } else if (edit.op.$type == TableUpdateRow) {
      const oldRow = rows.get(editId);
      if (!oldRow.tombstone && oldRow.depth <= depth && oldRow.clock < clock) {
        rows.set(editId, {depth, clock, tombstone: false, value: edit.op.value});
      }
    } else if (edit.op.$type == TableDeleteRow) {
      rows.set(editId, {depth, clock, tombstone: true, value: null});
    }
    return {tableId, rowId};
  }
  async function getRow(rowId) {
    return rows.get(rowId).value;
  }
  function* getAllRows() {
    for (row of rows.getAll()) {
      if (!row.tombstone) {
        yield row.value;
      }
    }
  }
  return {applyEdit, getRow, getAllRows};
}

function Tables(db) {
  const tableInfo = new DbMap(db.store('tableInfo'));  // Map<tableId, Edit>
  const tableCache = new Map();

  async function applyEdit(editId, edit, depth, {tableId, rowId}) {
    if (edit.op.$type == CreateTable) {
      await tableInfo.set(editId, edit);
      return {tableId: editId};
    } else if (edit.op.$type == DeleteTable) {
      await tableInfo.delete(edit.op.target);
      tableCache.delete(edit.op.target);
      return {tableId: edit.op.target};
    } else {
      return getTable(tableId).applyEdit(editId, edit, depth, {tableId, rowId});
    }
  }
  function getTable(tableId) {
    if (!tableCache.contains(tableId)) {
      tableCache.set(tableId, makeTable(tableId));
    }
    return tableCache.get(tableId);
  }
  function makeTable(tableId) {
    const info = tableInfo.get(tableId);
    if (info.op.$type == CreateTable) {
      return UnorderedMap(db, tableId);
    }
  }

  return {applyEdit, getTable};
}

function Database(db) {
  const unrooted = new DbMapSet(db.store(tableId, 'unrooted'));  // Map<parentId, Set<edit>>
  const rooted = new DbMap(db.store(tableId, 'rooted')); // Map<editId, {edit, depth, ids}>
  const tables = Tables(db);

  async function applyEdit(edit) {
    const editId = hash(edit);
    if (rooted.has(editId) || unrooted.contains(editId)) {
      return;
    } else if (edit.op.target == null || rooted.has(edit.op.target)) {
      await plant(editId, edit, rooted.get(edit.op.target));
    } else {
      await unrooted.add(edit.op.target, editId, edit);
    }
  }
  async function plant(editId, edit, {depth, ids}) {
    const ids = await tables.applyEdit(editId, edit, depth, ids);
    await rooted.insert(editId, {edit, depth, ids});
    for (const childEdit of unrooted.delete(editId)) {
      plant(hash(childEdit), childEdit, {depth: depth + 1, ids});
    }
  }
  return {applyEdit};
}

Database(db)

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
  local clocks
    reduce clock size

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
  discarded: composable CRDT
    UnorderedMap[create] can specify initial value?
    OrderedMap[insert] can specify ordering
    how map edit tree <-> result tree
    db.get('table-hash').getAll()  -> how to be efficient
    discarded - don't need perfect modularity
    UnorderedMap(
      CreateTable, DeleteTable, UnorderedMap(TableInsertRow, TableDeleteRow, EditsByDepth(TableUpdateRow)),
      CreateArray, DeleteArray, OrderedMap(ArrayInsertRow, ArrayDeleteRow, EditsByDepth(ArrayUpdateRow)))
