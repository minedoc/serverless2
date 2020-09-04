const MESSAGE_END = 0;
const TYPE_FIELD = '$type';
const proto = (proto) => Object.assign((id) => Object.assign(Object.create(proto), {id}), proto);
const registry = new Map();
const utf8encoder = new TextEncoder();
const utf8decoder = new TextDecoder();
const utf8encode = x => utf8encoder.encode(x);
const utf8decode = x => utf8decoder.decode(x);
const isNumber = x => typeof x == 'number';
const isBool = x => typeof x == 'boolean';
const int = spaceDelimited(isNumber, x => throwNaN(parseInt(x, 10), x), x => Math.trunc(x).toString(10));
const float = spaceDelimited(isNumber, x => throwNaN(parseFloat(x), x), x => x.toString(10));
const bool = spaceDelimited(isBool, x => x == 't', x => x ? 't' : 'f');
const id = x => x;
const binary = measured(x => x instanceof Uint8Array, 'Uint8Array', id, id);
const string = measured(x => typeof x == 'string', 'string', utf8decode, utf8encode);
const json = measured(x => true, 'json', x => JSON.parse(utf8decode(x)), x => utf8encode(JSON.stringify(x)));
const space = Uint8Array.of(32);

function throwNaN(val, orig) {
  if (Number.isNaN(val)) { throw 'expected number, got: ' + orig + ' => ' + val; }
  return val;
}

function write(val) {
  const result = new Uint8Array(this.writeTo(val, null, 0));
  this.writeTo(val, result, 0);
  return result;
}

function read(bytes) {
  if (!(bytes instanceof Uint8Array)) { throw 'expected bytes, got: ' + JSON.stringify(bytes) }
  return this.readFrom(bytes, 0)[0];
}

function writeTo(bytes, extra, offset) {
  if (bytes) {
    bytes.set(extra, offset);
  }
  return offset + extra.byteLength;
}

function spaceDelimited(check, fromStr, toStr) {
  return proto({
    write, read,
    readFrom(bytes, offset) {
      const end = bytes.indexOf(32, offset + 1);
      if (end == -1) { throw 'not terminated with space'; }
      return [fromStr(utf8decode(bytes.slice(offset, end))), end + 1];
    },
    writeTo(val, bytes, offset, path='') {
      if (!check(val)) { throw path + ' wrong type'; }
      return writeTo(bytes, utf8encode(toStr(val) + ' '), offset);
    },
  });
}

function measured(check, typeName, fromBytes, toBytes) {
  return proto({
    write, read,
    readFrom(bytes, offset) {
      const [len, end] = int.readFrom(bytes, offset);
      return [fromBytes(bytes.slice(end, end + len)), end + len + 1];
    },
    writeTo(val, bytes, offset, path='') {
      if (!check(val)) { throw path + ' wrong type - expected: ' + typeName; }
      const valBytes = toBytes(val);
      offset = int.writeTo(valBytes.length, bytes, offset, path + '.$measuredLength');
      offset = writeTo(bytes, valBytes, offset);
      return writeTo(bytes, space, offset);
    },
  });
}

function message(name, fields) {
  const fieldById = new Map();
  for (const [name, field] of Object.entries(fields)) {
    if (fieldById.has(field.id) || field.id <= 0) { throw 'invalid id ' + name + ' ' + field.id; }
    field.name = name;
    fieldById.set(field.id, field);
  }
  const message = proto({
    write, read,
    readFrom(bytes, offset) {
      var result = {}, id, field;
      while (offset < bytes.byteLength) {
        [id, offset] = int.readFrom(bytes, offset);
        if (id == MESSAGE_END) {
          return [result, offset];
        } else if (field = fieldById.get(id)) {
          [result[field.name], offset] = field.readFrom(bytes, offset);
        }
      }
      throw 'message did not terminate';
    },
    writeTo(val, bytes, offset, path=name) {
      for (const [name, field] of Object.entries(val)) {
        if (name == TYPE_FIELD) { continue; }
        if (!fields.hasOwnProperty(name)) { throw path + ' unknown field: ' + name; }
        offset = int.writeTo(fields[name].id, bytes, offset, path + '.' + '$messageFieldId');
        offset = fields[name].writeTo(val[name], bytes, offset, path + '.' + name);
      }
      return int.writeTo(MESSAGE_END, bytes, offset, path + '.$messageEnd');
    },
  });
  registry.set(name, message);
  return message;
}

function repeated(field, id) {
  return proto({
    write, read,
    readFrom(bytes, offset) {
      var result = [], count, val;
      [count, offset] = int.readFrom(bytes, offset);
      for (var i = 0; i < count; i++) {
        if (offset >= bytes.byteLength) { throw 'repeated did not terminate'; }
        [val, offset] = field.readFrom(bytes, offset);
        result.push(val);
      }
      return [result, offset];
    },
    writeTo(val, bytes, offset, path='') {
      offset = int.writeTo(val.length, bytes, offset, path + '.$repeatedCount');
      for (var i = 0; i < val.length; i++) {
        offset = field.writeTo(val[i], bytes, offset, path + '.' + i.toString());
      }
      return offset;
    },
  })(id);
}

function any(id) {
  return proto({
    write, read,
    readFrom(bytes, offset) {
      const [name, end] = string.readFrom(bytes, offset);
      if (!registry.has(name)) { throw 'unknown any: ' + name; }
      const builder = registry.get(name)
      const [val, end2] = builder.readFrom(bytes, end);
      return [Type(builder, val), end2];
    },
    writeTo(val, bytes, offset, path='') {
      if (!val[TYPE_FIELD]) { throw path + ' any must be wrapped with Type'; }
      offset = string.writeTo(val[TYPE_FIELD], bytes, offset, path + '.$anyName');
      return registry.get(val[TYPE_FIELD]).writeTo(val, bytes, offset, path);
    },
  })(id);
}

function Type(builder, val) {
  return Object.assign(Object.create({[TYPE_FIELD]: builder}), val);
}

function oneof(name, types) {
  return proto({
    write, read,
    readFrom(bytes, offset) {
      const [typeIndex, end] = int.readFrom(bytes, offset);
      if (typeIndex < 0 || typeIndex >= types.length) { throw 'unknown oneof index: ' + name + '/' + typeIndex; }
      const [val, end2] = types[typeIndex].readFrom(bytes, end);
      val.$type = types[typeIndex];
      return [val, end2];
    },
    writeTo(val, bytes, offset, path='') {
      if (!val[TYPE_FIELD]) { throw path + ' oneof must be wrapped with Type'; }
      const typeIndex = types.indexOf(val[TYPE_FIELD]);
      if (typeIndex == -1) { throw path + ' must be one of ' + types; }
      offset = int.writeTo(typeIndex, bytes, offset, path + '.$typeIndex');
      return val[TYPE_FIELD].writeTo(val, bytes, offset, path);
    },
  });
}

export {message, any, oneof, Type, repeated, string, json, binary, int, float, bool};
