const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const { deflateSync, deflateRawSync, gzipSync } = require("node:zlib");
const pako = require("../vendor/pako-inflate-2.1.0.min.js");

const reader = vm.runInNewContext(
  fs.readFileSync(path.join(__dirname, "../qr-reader.js"), "utf8") +
    "\n({ decodeWorkoutBase45, decompressWorkoutQr })",
  { pako, TextDecoder, Uint8Array }
);

function encodeBase45(bytes){
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";
  let encoded = "";
  for(let i = 0; i < bytes.length; i += 2){
    let value = bytes[i];
    const paired = i + 1 < bytes.length;
    if(paired) value = value * 256 + bytes[i + 1];
    for(let j = 0; j < (paired ? 3 : 2); j++){
      encoded += alphabet[value % 45];
      value = Math.floor(value / 45);
    }
  }
  return encoded;
}

test("Base45: ejemplos publicados en RFC 9285, incluido el espacio", () => {
  for(const [encoded, text] of [
    ["BB8", "AB"], ["%69 VD92EX0", "Hello!!"],
    ["UJCLQE7W581", "base-45"], ["QED8WEX0", "ietf!"]
  ]){
    assert.equal(Buffer.from(reader.decodeWorkoutBase45(encoded)).toString(), text);
  }
});

test("Base45: conserva espacios al principio, en el medio y consecutivos", () => {
  assert.deepEqual([...reader.decodeWorkoutBase45("  0")], [6, 120]);
  assert.deepEqual([...reader.decodeWorkoutBase45(" 0")], [36]);
  assert.deepEqual([...reader.decodeWorkoutBase45("BB8 0")], [65, 66, 36]);
});

test("Base45: rechaza longitud, caracteres y valores inválidos", () => {
  for(const encoded of ["", "0", "0000", "a0", "0\n", "::", ":::" ]){
    assert.throws(() => reader.decodeWorkoutBase45(encoded));
  }
});

test("zlib: recupera UTF-8 con acentos, emoji y espacios de la rutina", () => {
  const text = '  Rutina de día 💪\n[{"name":"Elevación de talón","note":"3 × 12"}]\n  ';
  const encoded = encodeBase45(deflateSync(Buffer.from(text)));
  assert.equal(reader.decompressWorkoutQr(encoded), text);
  assert.equal(reader.decompressWorkoutQr(encodeBase45(deflateSync(Buffer.alloc(0)))), "");
});

test("zlib: no recorta espacios agregados al contenido Base45", () => {
  const text = "Rutina de piernas";
  const encoded = encodeBase45(deflateSync(Buffer.from(text)));
  assert.equal(reader.decompressWorkoutQr(encoded), text);
  assert.throws(() => reader.decompressWorkoutQr(" " + encoded));
  assert.throws(() => reader.decompressWorkoutQr(encoded + " "));
});

test("zlib: detecta truncamiento y corrupción del checksum", () => {
  const compressed = deflateSync(Buffer.from("Press de hombros: 3 × 10"));
  for(let length = 1; length < compressed.length; length++){
    assert.throws(() => reader.decompressWorkoutQr(encodeBase45(compressed.subarray(0, length))));
  }
  compressed[compressed.length - 1] ^= 1;
  assert.throws(() => reader.decompressWorkoutQr(encodeBase45(compressed)));
});

test("zlib: rechaza gzip, deflate crudo y texto que no es UTF-8 válido", () => {
  for(const bytes of [gzipSync("rutina"), deflateRawSync("rutina"), deflateSync(Buffer.from([0xff, 0xfe]))]){
    assert.throws(() => reader.decompressWorkoutQr(encodeBase45(bytes)));
  }
});
