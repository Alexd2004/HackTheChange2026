// Saves the uploaded resume on the phone (Person A). The server never stores it: the resume revamp
// asks the phone for it and sends it along only for that one request. See resumeStore.ts for the logic.
//
//   await saveResume(planId, { pdfBase64 } | { text })   // after create-plan succeeds
//   const resume = await loadResume(planId)              // null => ask the user to upload it again
//   await deleteResume(planId)                           // when a plan or the user's data is deleted
import AsyncStorage from "@react-native-async-storage/async-storage";
import { File, Paths } from "expo-file-system";
import { Platform } from "react-native";
import { createResumeStore, type KeyValue, type ResumeFiles, type StoredResume } from "./resumeStore";

// Phone: real files in the app's private document folder. Only the file name is kept in AsyncStorage,
// because large values in AsyncStorage can fail on Android.
const nativeFiles: ResumeFiles = {
  async write(name, content, encoding) {
    const file = new File(Paths.document, name);
    if (file.exists) file.delete();
    file.create();
    await file.write(content, { encoding });
  },
  async read(name, encoding) {
    const file = new File(Paths.document, name);
    if (!file.exists) return null;
    return encoding === "base64" ? await file.base64() : await file.text();
  },
  async remove(name) {
    const file = new File(Paths.document, name);
    if (file.exists) file.delete();
  },
};

// Web (Expo web preview): there is no document folder, so AsyncStorage holds the content itself.
const webKey = (name: string) => `skillquest.resumefile.${name}`;
const webFiles: ResumeFiles = {
  write: (name, content) => AsyncStorage.setItem(webKey(name), content),
  read: (name) => AsyncStorage.getItem(webKey(name)),
  remove: (name) => AsyncStorage.removeItem(webKey(name)),
};

const keyValue: KeyValue = {
  get: (key) => AsyncStorage.getItem(key),
  set: (key, value) => AsyncStorage.setItem(key, value),
  remove: (key) => AsyncStorage.removeItem(key),
};

const store = createResumeStore(Platform.OS === "web" ? webFiles : nativeFiles, keyValue);

export const saveResume = store.save;
export const loadResume = store.load;
export const hasResume = store.has;
export const deleteResume = store.remove;
export type { StoredResume };
