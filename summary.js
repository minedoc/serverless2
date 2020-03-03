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

function DepthTree(db, applyEdit) {
  const unrooted = new DbMapSet(db.store(tableId, 'lww-unrooted'));  // Map<parentId, Set<Edit>>
  const rooted = new DbMap(db.store(tableId, 'lww-rooted'), compareClock); // Map<editId, {rootId, depth, edit}>
  const isRoot = edit => edit.op.$type == TableInsertRow;

  async function enqueue(edit) {
    const editId = hash(edit);
    if (rooted.has(editId) || unrooted.has(id)) {
      return;
    } else if (isRoot(edit)) {
      await plant(editId, edit, 0);
    } else if (rooted.has(edit)) {
      const parent = rooted.get(edit.op.target);
      await plant(parent.rootId, edit, parent.depth + 1);
    } else {
      await unrooted.add(edit.op.target, edit);
    }
  }
  async function plant(rootId, edit, depth) {
    const editId = hash(edit);
    rooted.insert(editId, {rootId, edit, depth});
    applyEdit(rootId, edit, [depth, edit.clock]);
    for (const childEdit of unrooted.deleteKey(editId)) {
      plant(rootId, childEdit, depth + 1);
    }
  }
  return {enqueue, onNewRoot};
}

function DbOrderedForest(comparator) {
  const items = DbList(); // DbList<editId, {rootId, parentId, childs, edit, clock}>
  // TODO: must handle multiple lists!
  function insert(id, value, parentId) {
    if (parentId == null) {
      items.insertBefore(id, value, null);
      return 0;
    } else {
      const parent = items.get(parentId);
      const childId = smallestBigger(parent.childs, value, comparator);
      const index = items.insertBefore(id, value, childId);
      return index;
    }
  }
  return {has: items.has, get: items.get, insert};
}

function DbList() {
  // list with efficient middle insertion, and counting
  const map = DbMap();
  const tree = OrderedTree(map.size());
  var ptr = map.get('$HEAD');
  while (ptr != '') {
    const item = map.get(ptr);
    tree.insert(item.value);
    ptr = item.next;
  }
  function get(id) {
    return map.get(id).value;
  }
  function insertBefore(id, value, nextId) {
    const [prevId, prev] = map.getByNext(nextId);
    map.set(id, {next: nextId, value });
    map.set(prevId, {next: id, value: prev.value});
    tree.insertBefore(id, prevId);
  }
  function index(id) {
    tree.index(id);
  }
}

function Tables(gossip, db) {
  const tableMetadata = new Map(db.store('tableMetadata'));
  const getTable = tableId => loadTable(db, tableMetadata.get(tableId));
  const editSerializer = EditSerializer(db, tableMetadata, (tableId, rowId, edit, position) => {
    getTable(tableId).mergeEdit(rowId, edit, position);
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

idea for composable CRDT
  uniquely map edit type to place in the tree
  constant time (global) lookup of operation and apply to correct item
  UnorderedMap[create] can specify initial value?
  OrderedMap[insert] can specify ordering

  UnorderedMap(
    CreateTable,
    DeleteTable,
    UnorderedMap(
      TableInsertRow,
      TableDeleteRow,
      BiggestEditByDepthWins(TableUpdateRow)),

    CreateArray,
    DeleteArray,
    OrderedMap(
      ArrayInsertRow,
      ArrayDeleteRow,
      BiggestEditByDepthWins(ArrayUpdateRow))
  )

  db.get('table').get('row')
  get('table'): depends on dynamic type of table! which might be unknown
  db.table: statically defined table, may mismatch with reality
