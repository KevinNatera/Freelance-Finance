// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

// Your web app's Firebase configuration using Vite's env variables
const firebaseConfig = {
  apiKey: "AIzaSyDHN2p7FVMARburqBfphQm_jdh2CWqz35o",
  authDomain: "freelancefinance-2ec74.firebaseapp.com",
  projectId: "freelancefinance-2ec74",
  storageBucket: "freelancefinance-2ec74.firebasestorage.app",
  messagingSenderId: "810916509823",
  appId: "1:810916509823:web:5e495d14cfb5db4fed674a",
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Cloud Firestore and get a reference to the service
export const db = getFirestore(app);
export const auth = getAuth(app);