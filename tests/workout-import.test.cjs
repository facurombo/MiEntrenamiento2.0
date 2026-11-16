const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8");
const helpers = vm.runInNewContext(
  source.slice(source.indexOf("function normalizeSet("), source.indexOf("/* ================= PANTALLAS")) +
    "\n({ parseZeppWorkout, validateWorkoutImport, normalizeExercise })",
  { uid: () => "exercise-id" }
);
const sample = fs.readFileSync(path.join(__dirname, "fixtures/zepp-workout.txt"), "utf8");
const parse = text => JSON.parse(JSON.stringify(helpers.parseZeppWorkout(text)));

test("convierte el ejemplo completo al esquema existente sin guardar el encabezado", () => {
  const exercises = parse(sample);
  assert.deepEqual(exercises, [
    { name: "Sentadilla hack squat", note: "", sets: [
      { series: 1, kg: 40, reps: 10, rir: 0 },
      { series: 3, kg: 80, reps: 9, rir: 1 }
    ] },
    { name: "Curl femoral sentado", note: "", sets: [{ series: 4, kg: 60, reps: 10, rir: 1 }] },
    { name: "Extensión de cuádriceps", note: "", sets: [{ series: 3, kg: 70, reps: 10, rir: 2 }] }
  ]);
  assert.doesNotThrow(() => helpers.validateWorkoutImport(exercises));
  assert.deepEqual(parse(sample.replace(/^Día 2: Dos\r?\n/, "")), exercises);
  const normalized = JSON.parse(JSON.stringify(exercises.map(helpers.normalizeExercise)));
  assert.deepEqual(normalized[0], {
    id: "exercise-id", name: "Sentadilla hack squat", note: "", restMinutes: 1.5, seriesCount: 0,
    sets: [
      { series: "1", reps: "10", kg: "40", rir: "0" },
      { series: "3", reps: "9", kg: "80", rir: "1" }
    ]
  });
});

test("admite acentos, espacios, saltos de línea y decimales con punto o coma", () => {
  const text = "\uFEFF\r\n Día 99: Ignorar \r\n\r\n Elevación de talón / sóleo (1 pierna) \r\n\r\n Series del ejercicio \r\n\r\n 1 : 12 reps / 12,50 kg / RIR 0 \r\n\r\n 2: 12 reps / 12.5 kg / RIR 0\r\n3: 12 reps / ,5 kg / RIR 0\r\n4: 12 reps / .50 kg / RIR 0\r\n";
  assert.deepEqual(parse(text), [{
    name: "Elevación de talón / sóleo (1 pierna)", note: "", sets: [
      { series: 2, kg: 12.5, reps: 12, rir: 0 },
      { series: 2, kg: 0.5, reps: 12, rir: 0 }
    ]
  }]);
  assert.equal(parse("Fondos\r1: 10 reps / 0 kg / RIR 0")[0].sets[0].kg, 0);
});

test("agrupa solo series consecutivas con los mismos kilos, repeticiones y RIR", () => {
  const text = "Press\n1: 8 reps / 60 kg / RIR 0\n2: 8 reps / 60 kg / RIR 0\n3: 9 reps / 60 kg / RIR 0\n4: 8 reps / 60 kg / RIR 0\n5: 8 reps / 61 kg / RIR 0\n6: 8 reps / 61 kg / RIR 1\n7: 8 reps / 61 kg / RIR 1";
  assert.deepEqual(parse(text)[0].sets, [
    { series: 2, kg: 60, reps: 8, rir: 0 },
    { series: 1, kg: 60, reps: 9, rir: 0 },
    { series: 1, kg: 60, reps: 8, rir: 0 },
    { series: 1, kg: 61, reps: 8, rir: 0 },
    { series: 2, kg: 61, reps: 8, rir: 1 }
  ]);
});

test("admite cantidades variables y nombres repetidos sin fusionar ejercicios", () => {
  const text = Array.from({ length: 20 }, (_, i) => [
    "Curl bíceps",
    ...Array.from({ length: i + 1 }, (_, n) => `${n + 1}: 10 reps / 20 kg / RIR 1`)
  ].join("\n")).join("\n\n");
  const exercises = parse(text);
  assert.equal(exercises.length, 20);
  assert.deepEqual(exercises.map(ex => ex.sets[0].series), Array.from({ length: 20 }, (_, i) => i + 1));
});

test("rechaza series omitidas, repetidas, desordenadas o que no empiezan en 1", () => {
  for(const number of [0, 2, 10]){
    assert.throws(() => parse(`Press\n${number}: 8 reps / 60 kg / RIR 0`), /Línea 2.*esperaba la serie 1/);
  }
  for(const number of [0, 1, 3]){
    assert.throws(() => parse(`Press\n1: 8 reps / 60 kg / RIR 0\n\n${number}: 8 reps / 60 kg / RIR 0`), /Línea 4.*esperaba la serie 2/);
  }
  assert.throws(() => parse("Press\n1: 8 reps / 60 kg / RIR 0\nCurl\n2: 8 reps / 20 kg / RIR 1"), /Línea 4.*esperaba la serie 1/);
});

test("informa la línea original de una serie inválida y rechaza todo el texto", () => {
  const prefix = "Día 2: Dos\n\nPress\nSeries del ejercicio\n1: 8 reps / 60 kg / RIR 0\n\n";
  for(const line of [
    "2: ocho reps / 60 kg / RIR 0", "2: 8 reps / kg / RIR 0", "2: 8 reps / 60 kg",
    "2: 8 reps / -60 kg / RIR 0", "2: 8 reps / 60 kg / RIR -1", "2: 8 reps / 60 kg / RIR 1.5",
    "2: 8.5 reps / 60 kg / RIR 0", "8 reps / 60 kg / RIR 0", "2) 8 reps / 60 kg / RIR 0",
    "2: 8 reps / 60,5.5 kg / RIR 0", "2: 8 reps / 60 kg / RIR 0 texto extra"
  ]){
    assert.throws(() => parse(prefix + line), /Línea 7 \(Press\).*serie inválida/);
  }
  assert.throws(() => parse(prefix + "No es una serie"), /Línea 7.*no tiene series/);
});

test("rechaza texto vacío, series sin ejercicio y ejercicios sin series", () => {
  for(const text of ["", "\n\n", "Día 2: Dos\n\nSeries del ejercicio"]){
    assert.throws(() => parse(text), /al menos un ejercicio/);
  }
  assert.throws(() => parse("1: 10 reps / 40 kg / RIR 0"), /Línea 1.*falta el nombre/);
  assert.throws(() => parse("\nPress\nSeries del ejercicio\n"), /Línea 2.*no tiene series/);
  assert.throws(() => parse("Press\nCurl\n1: 10 reps / 20 kg / RIR 1"), /Línea 1.*no tiene series/);
});

test("rechaza cantidades no válidas o que exceden la precisión numérica", () => {
  for(const line of [
    "1: 0 reps / 10 kg / RIR 0", "1: 9007199254740992 reps / 10 kg / RIR 0",
    "1: 10 reps / 10 kg / RIR 9007199254740992", `1: 10 reps / ${"9".repeat(310)} kg / RIR 0`
  ]){
    assert.throws(() => parse("Press\n" + line), /Línea 2.*enter/);
  }
});

test("conserva las reglas del validador JSON previo", () => {
  assert.doesNotThrow(() => helpers.validateWorkoutImport([
    { name: "Press", sets: [{ series: "3", kg: 60.5, reps: "8", rir: 0 }] },
    { name: "Curl", sets: [{ series: "", kg: "", reps: "", rir: "" }] }
  ]));
  for(const value of [null, [], {}, [{ name: "", sets: [] }], [{ name: "Press", sets: [{}] }]]){
    assert.throws(() => helpers.validateWorkoutImport(value));
  }
  for(const invalid of [-1, NaN, Infinity, null, undefined, true, "no es un número"]){
    assert.throws(() => helpers.validateWorkoutImport([
      { name: "Press", sets: [{ series: 1, kg: invalid, reps: 8, rir: 0 }] }
    ]));
  }
});
