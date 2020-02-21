const db = Database('tracker.host.com', 'dataset', keys, {
  items: UnorderedTable(1, 0, 1),
  other: OrderedTable(2, 0, 1),
});
db.items.get(binaryId) -> obj
db.items.insert(obj) -> binaryId
db.items.update(binaryId, obj)
db.items.delete(binaryId)

/*

todo:
  migrations - schema change
  how to express queries
    select, where, group by, order by, join
    db.query('sql').get(bindings)
  live queries
    db.query('sql').live(bindings).get()

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
    for (const row of node.after) {
      yield* iterate(row);
    }
  }
  function insert(key, row) {
    rows.set(row.$id, {row, after: new SortedDict()});
    rows.get(row.$after).after.insert(rows.get(row.$id));
  }
  function update(key, row) {
    rows.get(key).row = row;
  }
  function delete(key) {
    // TODO
  }
  return {
    watch,
    get, asDict, iterate,
    insert, update, delete}
}
