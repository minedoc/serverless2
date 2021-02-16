const MESSAGE_END = 0;
const TYPE_FIELD = '$type';
const proto = (p) => Object.assign((id) => Object.assign(Object.create(p), {id}), p);
const registry = new Map();
const utf8encode = x => new TextEncoder().encode(x);
const utf8decode = x => new TextDecoder().decode(x);
const id = x => x;

function write(val) {
  const result = new ArrayBuffer(this.writeTo(val, null, 0));
  this.writeTo(val, new Uint8Array(result), 0);
  return result;
}

function read(buffer) {
  if (!(buffer instanceof ArrayBuffer)) { throw 'expected ArrayBuffer got: ' + (typeof buffer) }
  return this.readFrom(new Uint8Array(buffer), 0)[0];
}

const HI = 0x80;
const LO = 0x7F;
const MAX_32 = 0xFFFFFFFF;
const uint32 = proto({
  write, read,
  readFrom(bytes, offset) {
    var result = 0;
    for (var shift=0; bytes[offset] & HI; offset++, shift+=7) {
      result |= (bytes[offset] & ~HI) << shift;
    }
    result |= bytes[offset] << shift;
    return [result >>> 0, offset + 1];
  },
  writeTo(val, bytes, offset, path='') {
    if (!Number.isSafeInteger(val) || val < 0 || val > MAX_32) { throw path + ' is not unsigned integer'; }
    if (bytes) {
      for (; val > HI; val >>>= 7, offset++) {
        bytes[offset] = (val & LO) | HI;
      }
      bytes[offset] = val & LO;
    } else {
      for (; val > HI; val >>>= 7, offset++) {
      }
    }
    return offset + 1;
  }
});

const bool = proto({
  write, read,
  readFrom(bytes, offset) {
    var [val, offset] = uint32.readFrom(bytes, offset);
    return [val == 1, offset];
  },
  writeTo(val, bytes, offset, path='') {
    return uint32.writeTo(val ? 1 : 0, bytes, offset, path);
  }
});

function number(check) {
  return proto({
    write, read,
    readFrom(bytes, offset) {
      return [new DataView(bytes.buffer).getFloat64(offset), offset + 8];
    },
    writeTo(val, bytes, offset, path='') {
      if (!check(val)) { throw path + ' is not number'; }
      if (bytes) {
        new DataView(bytes.buffer).setFloat64(offset, val);
      }
      return offset + 8;
    }
  });
}
const int = number(x => Number.isSafeInteger(x));
const float = number(x => typeof x == 'number' && Number.isNaN(val));

function measured(check, typeName, fromBytes, toBytes) {
  return proto({
    write, read,
    readFrom(bytes, offset) {
      const [len, end] = uint32.readFrom(bytes, offset);
      return [fromBytes(new Uint8Array(bytes.buffer, end, len)), end + len];
    },
    writeTo(val, bytes, offset, path='') {
      if (!check(val)) { throw path + ' wrong type - expected: ' + typeName; }
      const serialized = toBytes(val), length = serialized.byteLength;
      offset = uint32.writeTo(length, bytes, offset, path + '.$measuredLength');
      if (bytes) {
        bytes.set(serialized, offset);
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
    readFrom(bytes, offset) {
      var result = {}, id, field;
      while (offset < bytes.byteLength) {
        [id, offset] = uint32.readFrom(bytes, offset);
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
        offset = uint32.writeTo(fields[name].id, bytes, offset, path + '.' + '$messageFieldId');
        offset = fields[name].writeTo(val[name], bytes, offset, path + '.' + name);
      }
      return uint32.writeTo(MESSAGE_END, bytes, offset, path + '.$messageEnd');
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
    readFrom(bytes, offset) {
      var result = [], count, val;
      [count, offset] = uint32.readFrom(bytes, offset);
      for (var i = 0; i < count; i++) {
        if (offset >= bytes.byteLength) { throw 'repeated did not terminate'; }
        [val, offset] = field.readFrom(bytes, offset);
        result.push(val);
      }
      return [result, offset];
    },
    writeTo(val, bytes, offset, path='') {
      offset = uint32.writeTo(val.length, bytes, offset, path + '.$repeatedCount');
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
      const [typeIndex, end] = uint32.readFrom(bytes, offset);
      if (typeIndex < 0 || typeIndex >= types.length) { throw 'unknown oneof index: ' + name + '/' + typeIndex; }
      const [val, end2] = types[typeIndex].readFrom(bytes, end);
      val.$type = types[typeIndex];
      return [val, end2];
    },
    writeTo(val, bytes, offset, path='') {
      if (!val[TYPE_FIELD]) { throw path + ' oneof must be wrapped with Type'; }
      const typeIndex = types.indexOf(val[TYPE_FIELD]);
      if (typeIndex == -1) { throw path + ' must be one of ' + types; }
      offset = uint32.writeTo(typeIndex, bytes, offset, path + '.$oneofType');
      return val[TYPE_FIELD].writeTo(val, bytes, offset, path);
    },
  });
}

export {message, any, oneof, Type, repeated, string, json, binary, int, uint32, float, bool};
