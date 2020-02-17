function Database(crdt, aliases) {
  return {
    get, map, filter, group, sort,
    insert, update, delete
  };
}

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
