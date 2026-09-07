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
export const dbDocRef = doc(db, 'mess', 'data');

try {
  await enableIndexedDbPersistence(db);
} catch (e) {
  console.warn('Offline persistence unavailable:', e.message);
}

export { setDoc, onSnapshot };
