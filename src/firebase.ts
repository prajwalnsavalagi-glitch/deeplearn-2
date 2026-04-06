import { initializeApp } from 'firebase/app';
import { initializeAuth, browserLocalPersistence, GoogleAuthProvider, OAuthProvider } from 'firebase/auth';

// Import the Firebase configuration
import firebaseConfig from '../firebase-applet-config.json';

// Initialize Firebase SDK
const app = initializeApp(firebaseConfig);

// Initialize Firebase Auth with explicit persistence to avoid assertion errors
export const auth = initializeAuth(app, {
  persistence: browserLocalPersistence,
});

// Auth Providers
export const googleProvider = new GoogleAuthProvider();
export const microsoftProvider = new OAuthProvider('microsoft.com');
