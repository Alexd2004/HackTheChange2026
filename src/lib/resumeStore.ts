// Keeps a plan's resume on the phone so the resume revamp can use it later, without ever storing it on a server.
// This file has no Expo or React Native imports: resume.ts plugs in the real file system and storage.

export type StoredResume = { pdfBase64: string } | { text: string };

/** Where resume files live. `name` is a plain file name, never a path. */
export interface ResumeFiles {
  write(name: string, content: string, encoding: "utf8" | "base64"): Promise<void>;
  /** The file's content, or null if the file is gone. */
  read(name: string, encoding: "utf8" | "base64"): Promise<string | null>;
  remove(name: string): Promise<void>;
}

/** Small key-value storage (AsyncStorage). Only ever holds a tiny pointer, never the resume. */
export interface KeyValue {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

interface Pointer {
  file: string; // file name inside the app's document folder (not a full path: those can change between app updates)
  kind: "pdf" | "text";
}

export function createResumeStore(files: ResumeFiles, kv: KeyValue) {
  const keyFor = (planId: string) => `skillquest.resume.${cleanId(planId)}`;

  async function readPointer(planId: string): Promise<Pointer | null> {
    const raw = await kv.get(keyFor(planId));
    if (!raw) return null;
    try {
      const p = JSON.parse(raw) as Pointer;
      return typeof p.file === "string" && (p.kind === "pdf" || p.kind === "text") ? p : null;
    } catch {
      return null;
    }
  }

  /** Save the resume for a plan, replacing any earlier one. */
  async function save(planId: string, resume: StoredResume): Promise<void> {
    const kind = "pdfBase64" in resume ? "pdf" : "text";
    const file = `resume-${cleanId(planId)}.${kind === "pdf" ? "pdf" : "txt"}`;
    const old = await readPointer(planId);
    if ("pdfBase64" in resume) await files.write(file, resume.pdfBase64, "base64");
    else await files.write(file, resume.text, "utf8");
    if (old && old.file !== file) await files.remove(old.file); // switched between PDF and pasted text
    await kv.set(keyFor(planId), JSON.stringify({ file, kind } satisfies Pointer));
  }

  /** The saved resume, or null if there is none (or the file was lost, for example after a reinstall). */
  async function load(planId: string): Promise<StoredResume | null> {
    const p = await readPointer(planId);
    if (!p) return null;
    const content = await files.read(p.file, p.kind === "pdf" ? "base64" : "utf8");
    if (content == null || content === "") {
      await kv.remove(keyFor(planId)); // the pointer is stale, so forget it
      return null;
    }
    return p.kind === "pdf" ? { pdfBase64: content } : { text: content };
  }

  async function has(planId: string): Promise<boolean> {
    return (await load(planId)) !== null;
  }

  /** Delete the resume, for example when the user deletes their plan or their data. */
  async function remove(planId: string): Promise<void> {
    const p = await readPointer(planId);
    if (p) await files.remove(p.file);
    await kv.remove(keyFor(planId));
  }

  return { save, load, has, remove };
}

/** Plan ids are UUIDs. Keep only safe characters so an id can never point outside the resume folder. */
function cleanId(planId: string): string {
  const id = String(planId).replace(/[^A-Za-z0-9_-]/g, "");
  if (!id) throw new Error("A plan id is needed to store a resume.");
  return id;
}
