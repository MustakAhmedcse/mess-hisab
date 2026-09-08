import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import {
  getFirestore,
  doc,
  setDoc,
  onSnapshot,
  enableIndexedDbPersistence
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyAsHhu9fiDV-lHAIzrdIoLc7r6hUOSU2I8',
  authDomain: 'mess-hisab-3f986.firebaseapp.com',
  projectId: 'mess-hisab-3f986',
  storageBucket: 'mess-hisab-3f986.firebasestorage.app',
  messagingSenderId: '28670495500',
  appId: '1:28670495500:web:c8eca5118fb6d969d05729'
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

/**
 * Which shared document this page reads and writes.
 *   ?db=<name>  → mess/<name>   a private sandbox (any name; used for testing)
 *   ?test       → mess/test     the shared play-around copy
 *   localhost   → mess/dev      local development
 *   otherwise   → mess/data     the mess's real hisab
 * Anything that isn't `data` shows a banner, so a test session can never be
 * mistaken for the real one.
 */
const params = new URLSearchParams(location.search);
const isLocal = ['localhost', '127.0.0.1', '::1'].includes(location.hostname);
const named = (params.get('db') || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24);

export const DB_NAME = named || (params.has('test') ? 'test' : (isLocal ? 'dev' : 'data'));
export const IS_REAL_DB = DB_NAME === 'data';
export const dbDocRef = doc(db, 'mess', DB_NAME);

if (!IS_REAL_DB) console.info(`Mess Hisab: using mess/${DB_NAME} — not the real hisab.`);

try {
  await enableIndexedDbPersistence(db);
} catch (e) {
  console.warn('Offline persistence unavailable:', e.message);
}

export { setDoc, onSnapshot };
