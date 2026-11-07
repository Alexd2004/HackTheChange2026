// Tests for pickStageSkills: which skills become stages (top gaps, or review stages if there are none).
// No network, no API keys.
import { assertEquals } from "jsr:@std/assert@1";
import { type FitSkill, pickStageSkills } from "../create-plan/fit.ts";

const skill = (name: string, need: number, have: number, weight: number, required: boolean): FitSkill => ({
  name, need_level: need, have_level: have, weight, required, is_gap: have < need,
});
const names = (skills: FitSkill[]) => skills.map((s) => s.name);

Deno.test("stages: the biggest gaps win, required and high weight first", () => {
  const r = pickStageSkills([
    skill("Docker", 1, 0, 1, false), skill("React", 2, 0, 3, true), skill("SQL", 2, 1, 2, true),
    skill("Git", 2, 2, 2, true), skill("Agile", 1, 0, 1, false),
  ], 3);
  console.log("mode:", r.mode, "->", names(r.skills).join(", "));
  assertEquals(r.mode, "gap");
  assertEquals(names(r.skills), ["React", "SQL", "Docker"]);
});

Deno.test("stages: never more than the limit of 3", () => {
  const many = ["A", "B", "C", "D", "E"].map((n) => skill(n, 2, 0, 2, true));
  assertEquals(pickStageSkills(many, 3).skills.length, 3);
});

Deno.test("stages: a resume with no gaps gets review stages for the most important skills", () => {
  const r = pickStageSkills([
    skill("Docker", 1, 1, 1, false), skill("React", 2, 2, 3, true), skill("AWS", 1, 3, 1, false),
    skill("TypeScript", 2, 3, 3, true), skill("Git", 2, 2, 2, true),
  ], 3);
  console.log("mode:", r.mode, "->", names(r.skills).join(", "));
  assertEquals(r.mode, "polish");
  assertEquals(names(r.skills), ["React", "TypeScript", "Git"]);
});

Deno.test("stages: a short posting with no gaps gives fewer than 3 review stages", () => {
  const r = pickStageSkills([skill("A", 1, 1, 1, false), skill("B", 2, 2, 2, true)], 3);
  assertEquals(r.mode, "polish");
  assertEquals(r.skills.length, 2);
});
