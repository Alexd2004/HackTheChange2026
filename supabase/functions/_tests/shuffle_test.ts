// Tests for shuffleOptions (MCQ answer shuffle). No network, no API keys.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { shuffleOptions } from "../generate-level/shuffle.ts";

Deno.test("shuffle: the correct answer lands in A, B, C and D about equally often", () => {
  const counts = [0, 0, 0, 0];
  const runs = 20000;
  for (let n = 0; n < runs; n++) counts[shuffleOptions(["right", "w1", "w2", "w3"], 0).correct_index]++;
  const pct = counts.map((c) => (100 * c) / runs);
  console.log("correct answer position A/B/C/D:", pct.map((p) => p.toFixed(1) + "%").join("  "));
  for (const p of pct) assert(p > 22 && p < 28, `position share ${p}% is not close to 25%`);
});

Deno.test("shuffle: correct_index always points at the same answer text", () => {
  const original = ["a", "b", "c", "d"];
  for (let correct = 0; correct < 4; correct++) {
    for (let n = 0; n < 500; n++) {
      const r = shuffleOptions(original, correct);
      assertEquals(r.options[r.correct_index], original[correct]);
    }
  }
});

Deno.test("shuffle: keeps the same four options", () => {
  const r = shuffleOptions(["a", "b", "c", "d"], 2);
  assertEquals([...r.options].sort(), ["a", "b", "c", "d"]);
});

Deno.test("shuffle: leaves 'All of the above' style options in place", () => {
  for (const options of [
    ["Red", "Blue", "Green", "All of the above"],
    ["Option A", "x", "y", "z"],
    ["Both A and B", "p", "q", "r"],
    ["None of these", "p", "q", "r"],
  ]) {
    const r = shuffleOptions(options, 3);
    assertEquals(r.options, options);
    assertEquals(r.correct_index, 3);
  }
});
