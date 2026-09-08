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

// Local development writes to a separate document so testing can never touch
// the mess's real hisab.
const isLocal = ['localhost', '127.0.0.1', '::1'].includes(location.hostname);
export const dbDocRef = doc(db, 'mess', isLocal ? 'dev' : 'data');
if (isLocal) console.info('Mess Hisab: using the dev document (mess/dev), not live data.');

try {
  await enableIndexedDbPersistence(db);
} catch (e) {
  console.warn('Offline persistence unavailable:', e.message);
}

export { setDoc, onSnapshot };
