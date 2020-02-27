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

function EditSerializer(db, tableMetadata, applyEdit) {
  const unrooted = new DbMapSet(db.store(tableId, 'unrooted'));  // Map<Target, Set<Edit>>
  const rooted = new DbOrderedTree(db.store(tableId, 'rooted')); // Map<EditId, {rootId, parentId, childs, edit}>
  const root = new DbMap(db.store(tableId, 'root')); // Map<rootId, {tableId}>

  async function enqueue(edit) {
    const type = edit.op.$type;
    const editId = hash(edit);
    if (seen(edit.op.target)) {
      return;
    } else if (type == TableCreate) {
      await tableMetadata.set(editId, edit.op);
    } else if (type == TableInsertRow) {
      await root.set(editId, {tableId: edit.op.target});
      await plant(edit.op.target, editId, edit);
    } else if (rooted.has(edit.op.target)) {
      const rootId = rooted.get(edit.op.target).rootId;
      const tableId = root.get(rootId).tableId;
      await plant(tableId, rootId, edit);
    } else {
      await unrooted.add(edit.op.target, edit);
    }
  }
  async function plant(tableId, rowId, edit) {
    const position = editTree(rowId).insert(edit);
    rooted.set(hash(edit), edit);
    applyEdit(tableId, rowId, edit, position);
    unrooted.deleteValue(edit);
    unrooted.deleteKey(hash(edit)).forEach(e => plant(tableId, rowId, e));
  }
  return {enqueue};
}

// for each edit:
// 0-1 unrooted
// 1 rooted

function Tables(gossip, db) {
  const tableMetadata = new Map(db.store('tableMetadata'));
  const getTable = tableId => loadTable(db, tableMetadata.get(tableId));
  const editSerializer = EditSerializer(db, tableMetadata, (tableId, rowId, edit, position) => {
    getTable(tableId).mergeEdit(rowId, edit, position);
  });
  gossip.onEntry(edit => editSerializer.enqueue(edit));
  return getTable;
}

function DbOrderedTree(comparator) {
  // stored in DB as links
  // stored in memory as balanced tree for fast indexing
  const items = DbList();
  function insert(nodeId, node, parentId) {
    const parent = items.get(parentId);
    const childId = smallestBigger(parent.childs, node, comparator);
    const index = childId ? items.index(childId) : items.index(parent.next);
    items.insertAt(nodeId, node, index);
    return index;
  }
  return {has, get, set, insert};
}

function DbList() {
  // list with efficient middle insertion, and counting
  const map = ?;
  const tree = ?;
  function get(id) {
    return map.get(id);
  }
  function insertAt(id, value, index) {
    map.set(id, value);
    tree.insert(index);
  }
  function index(id) {
    walkUpTree(map.get(id));
  }
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
