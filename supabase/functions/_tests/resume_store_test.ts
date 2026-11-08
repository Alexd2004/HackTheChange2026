// Tests for the on-phone resume store (src/lib/resumeStore.ts). The phone's file system and storage are
// replaced with in-memory fakes, so no phone, Expo or network is needed.
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { createResumeStore, type KeyValue, type ResumeFiles } from "../../../src/lib/resumeStore.ts";

/** Fakes for the phone's files and AsyncStorage, with a way to look inside. */
function fakePhone() {
  const files = new Map<string, string>();
  const storage = new Map<string, string>();
  const fileApi: ResumeFiles = {
    write: (name, content) => { files.set(name, content); return Promise.resolve(); },
    read: (name) => Promise.resolve(files.get(name) ?? null),
    remove: (name) => { files.delete(name); return Promise.resolve(); },
  };
  const kv: KeyValue = {
    get: (k) => Promise.resolve(storage.get(k) ?? null),
    set: (k, v) => { storage.set(k, v); return Promise.resolve(); },
    remove: (k) => { storage.delete(k); return Promise.resolve(); },
  };
  return { files, storage, store: createResumeStore(fileApi, kv) };
}

const PLAN = "11111111-2222-4333-8444-555555555555";
const bigPdf = btoa("%PDF-1.4 " + "x".repeat(50_000)); // a large base64 string, like a real resume PDF

Deno.test("resume store: pasted text is saved and read back", async () => {
  const { store } = fakePhone();
  await store.save(PLAN, { text: "Jordan Lee. React developer." });
  assertEquals(await store.load(PLAN), { text: "Jordan Lee. React developer." });
});

Deno.test("resume store: a PDF is saved and read back exactly", async () => {
  const { store, files } = fakePhone();
  await store.save(PLAN, { pdfBase64: bigPdf });
  assertEquals(await store.load(PLAN), { pdfBase64: bigPdf });
  assert([...files.keys()][0].endsWith(".pdf"), "a PDF resume is saved as a .pdf file");
});

Deno.test("resume store: only a tiny pointer goes in AsyncStorage, never the resume", async () => {
  const { store, storage } = fakePhone();
  await store.save(PLAN, { pdfBase64: bigPdf });
  const stored = [...storage.values()].join("");
  console.log("AsyncStorage holds:", stored);
  assert(stored.length < 200, "AsyncStorage should hold only a pointer");
  assert(!stored.includes(bigPdf.slice(0, 40)));
  assert(!stored.includes("/"), "the pointer holds a file name, not a path (paths can change between app updates)");
});

Deno.test("resume store: a plan with no saved resume gives null (so the app asks for a re-upload)", async () => {
  const { store } = fakePhone();
  assertEquals(await store.load(PLAN), null);
  assertEquals(await store.has(PLAN), false);
});

Deno.test("resume store: if the file is gone (reinstall, cleared data) the result is null and the stale pointer is dropped", async () => {
  const { store, files, storage } = fakePhone();
  await store.save(PLAN, { text: "my resume" });
  files.clear(); // the file disappears but the pointer is still there
  assertEquals(await store.load(PLAN), null);
  assertEquals(storage.size, 0);
});

Deno.test("resume store: saving again replaces the old resume", async () => {
  const { store } = fakePhone();
  await store.save(PLAN, { text: "old" });
  await store.save(PLAN, { text: "new" });
  assertEquals(await store.load(PLAN), { text: "new" });
});

Deno.test("resume store: switching from pasted text to a PDF removes the old file", async () => {
  const { store, files } = fakePhone();
  await store.save(PLAN, { text: "pasted" });
  await store.save(PLAN, { pdfBase64: bigPdf });
  assertEquals(files.size, 1);
  assertEquals(await store.load(PLAN), { pdfBase64: bigPdf });
});

Deno.test("resume store: each plan has its own resume", async () => {
  const { store } = fakePhone();
  await store.save("plan-a", { text: "resume A" });
  await store.save("plan-b", { text: "resume B" });
  assertEquals(await store.load("plan-a"), { text: "resume A" });
  assertEquals(await store.load("plan-b"), { text: "resume B" });
});

Deno.test("resume store: remove deletes both the file and the pointer", async () => {
  const { store, files, storage } = fakePhone();
  await store.save(PLAN, { text: "bye" });
  await store.remove(PLAN);
  assertEquals(files.size, 0);
  assertEquals(storage.size, 0);
  assertEquals(await store.load(PLAN), null);
});

Deno.test("resume store: a plan id can never point outside the resume folder", async () => {
  const { store, files } = fakePhone();
  await store.save("../../etc/passwd", { text: "x" });
  const [name] = [...files.keys()];
  console.log("file name used:", name);
  assert(!name.includes("/") && !name.includes("\\") && !name.includes(".."), "no path characters in the file name");
  await assertRejects(() => store.save("///", { text: "x" }), Error, "plan id");
});

Deno.test("resume store: has() works when called as a plain function (the app exports it that way)", async () => {
  const { store } = fakePhone();
  const { has, save } = store; // detached from the object, like `export const hasResume = store.has`
  await save(PLAN, { text: "hi" });
  assertEquals(await has(PLAN), true);
});
