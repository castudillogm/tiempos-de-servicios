import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyC_8DnRAMyMKY-RbnAvYG4hQcDA_54XKw8",
  authDomain: "tds-grupamar.firebaseapp.com",
  projectId: "tds-grupamar",
  storageBucket: "tds-grupamar.firebasestorage.app",
  messagingSenderId: "23480260104",
  appId: "1:23480260104:web:093bc1ffee376ca383a3bd",
  measurementId: "G-LKQ3079BTR"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
