const MESSAGE_END = 0;
const TYPE_FIELD = '$type';
const proto = (p) => Object.assign((id) => Object.assign(Object.create(p), {id}), p);
const registry = new Map();
const utf8encode = x => new TextEncoder().encode(x);
const utf8decode = x => new TextDecoder().decode(x);
const id = x => x;

function write(val) {
  const result = new ArrayBuffer(this.writeTo(val, null, 0));
  this.writeTo(val, new DataView(result), 0);
  return result;
}

function read(buffer) {
  if (!(buffer instanceof ArrayBuffer)) { throw 'expected ArrayBuffer got: ' + (typeof buffer) }
  return this.readFrom(new DataView(buffer), 0)[0];
}

function number(check, toRaw, fromRaw) {
  return proto({
    write, read,
    readFrom(view, offset) {
      return [fromRaw(view.getFloat64(offset)), offset + 8];
    },
    writeTo(val, view, offset, path='') {
      if (!check(val)) { throw path + ' is not number'; }
      if (view) {
        view.setFloat64(offset, toRaw(val));
      }
      return offset + 8;
    }
  });
}
const int = number(x => Number.isSafeInteger(x), id, id);
const float = number(x => typeof x == 'number' && Number.isNaN(val), id, id);
const bool = number(x => typeof x == 'boolean', x => x ? 1 : 0, x => x == 1);

function measured(check, typeName, fromBytes, toBytes) {
  return proto({
    write, read,
    readFrom(view, offset) {
      const [len, end] = int.readFrom(view, offset);
      return [fromBytes(new Uint8Array(view.buffer, end, len)), end + len];
    },
    writeTo(val, view, offset, path='') {
      if (!check(val)) { throw path + ' wrong type - expected: ' + typeName; }
      const bytes = toBytes(val), length = bytes.byteLength;
      offset = int.writeTo(length, view, offset, path + '.$measuredLength');
      if (view) {
        new Uint8Array(view.buffer, offset).set(bytes);
      }
      return offset + length;
    },
  });
}
const binary = measured(x => x instanceof Uint8Array, 'Uint8Array', x => x.slice(), id);
const string = measured(x => typeof x == 'string', 'string', utf8decode, utf8encode);
const json = measured(x => true, 'json', x => JSON.parse(utf8decode(x)), x => utf8encode(JSON.stringify(x)));

function message(name, fields) {
  const fieldById = new Map();
  for (const [name, field] of Object.entries(fields)) {
    if (fieldById.has(field.id) || field.id <= 0) { throw 'invalid id ' + name + ' ' + field.id; }
    field.name = name;
    fieldById.set(field.id, field);
  }
  const message = proto({
    write, read,
    readFrom(view, offset) {
      var result = {}, id, field;
      while (offset < view.byteLength) {
        [id, offset] = int.readFrom(view, offset);
        if (id == MESSAGE_END) {
          return [result, offset];
        } else if (field = fieldById.get(id)) {
          [result[field.name], offset] = field.readFrom(view, offset);
        }
      }
      throw 'message did not terminate';
    },
    writeTo(val, view, offset, path=name) {
      for (const [name, field] of Object.entries(val)) {
        if (name == TYPE_FIELD) { continue; }
        if (!fields.hasOwnProperty(name)) { throw path + ' unknown field: ' + name; }
        offset = int.writeTo(fields[name].id, view, offset, path + '.' + '$messageFieldId');
        offset = fields[name].writeTo(val[name], view, offset, path + '.' + name);
      }
      return int.writeTo(MESSAGE_END, view, offset, path + '.$messageEnd');
    },
    wrap(val) {
      return Type(message, val);
    }
  });
  registry.set(name, message);
  return message;
}

function repeated(field, id) {
  return proto({
    write, read,
    readFrom(view, offset) {
      var result = [], count, val;
      [count, offset] = int.readFrom(view, offset);
      for (var i = 0; i < count; i++) {
        if (offset >= view.byteLength) { throw 'repeated did not terminate'; }
        [val, offset] = field.readFrom(view, offset);
        result.push(val);
      }
      return [result, offset];
    },
    writeTo(val, view, offset, path='') {
      offset = int.writeTo(val.length, view, offset, path + '.$repeatedCount');
      for (var i = 0; i < val.length; i++) {
        offset = field.writeTo(val[i], view, offset, path + '.' + i.toString());
      }
      return offset;
    },
  })(id);
}

function any(id) {
  return proto({
    write, read,
    readFrom(view, offset) {
      const [name, end] = string.readFrom(view, offset);
      if (!registry.has(name)) { throw 'unknown any: ' + name; }
      const builder = registry.get(name)
      const [val, end2] = builder.readFrom(view, end);
      return [Type(builder, val), end2];
    },
    writeTo(val, view, offset, path='') {
      if (!val[TYPE_FIELD]) { throw path + ' any must be wrapped with Type'; }
      offset = string.writeTo(val[TYPE_FIELD], view, offset, path + '.$anyName');
      return registry.get(val[TYPE_FIELD]).writeTo(val, view, offset, path);
    },
  })(id);
}

function Type(builder, val) {
  return Object.assign(Object.create({[TYPE_FIELD]: builder}), val);
}

function oneof(name, types) {
  return proto({
    write, read,
    readFrom(view, offset) {
      const [typeIndex, end] = int.readFrom(view, offset);
      if (typeIndex < 0 || typeIndex >= types.length) { throw 'unknown oneof index: ' + name + '/' + typeIndex; }
      const [val, end2] = types[typeIndex].readFrom(view, end);
      val.$type = types[typeIndex];
      return [val, end2];
    },
    writeTo(val, view, offset, path='') {
      if (!val[TYPE_FIELD]) { throw path + ' oneof must be wrapped with Type'; }
      const typeIndex = types.indexOf(val[TYPE_FIELD]);
      if (typeIndex == -1) { throw path + ' must be one of ' + types; }
      offset = int.writeTo(typeIndex, view, offset, path + '.$oneofType');
      return val[TYPE_FIELD].writeTo(val, view, offset, path);
    },
  });
}

export {message, any, oneof, Type, repeated, string, json, binary, int, float, bool};
