import dotenv from "dotenv";
import admin from "firebase-admin";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

let firebaseAdminApp = null;

/**
 * Returns a firebase-admin app when FIREBASE_SERVICE_ACCOUNT (JSON string)
 * is set, or falls back to local service account file in app/config.
 */
export const getFirebaseAdminApp = () => {
  if (firebaseAdminApp) return firebaseAdminApp;

  const json = process.env.FIREBASE_SERVICE_ACCOUNT;
  const databaseURL =
    process.env.FIREBASE_DATABASE_URL ||
    "https://realtime-f6af4-default-rtdb.asia-southeast1.firebasedatabase.app";

  let serviceAccount = null;

  if (json) {
    try {
      const cleanJson = json.replace(/\\"/g, '"');
      serviceAccount = JSON.parse(cleanJson);
    } catch (e) {
      console.warn("[Firebase] Error parsing FIREBASE_SERVICE_ACCOUNT env:", e.message);
    }
  }

  // Fallback to local service account file in app/config
  if (!serviceAccount) {
    try {
      const serviceAccountFilePath = path.resolve(
        __dirname,
        "realtime-f6af4-firebase-adminsdk-fbsvc-6d9527cdae.json"
      );
      if (fs.existsSync(serviceAccountFilePath)) {
        const fileContent = fs.readFileSync(serviceAccountFilePath, "utf8");
        serviceAccount = JSON.parse(fileContent);
      }
    } catch (err) {
      console.warn("[Firebase] Could not read local service account json:", err.message);
    }
  }

  if (!serviceAccount) {
    return null;
  }

  try {
    if (serviceAccount.private_key) {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, "\n");
    }
    const config = {
      credential: admin.credential.cert(serviceAccount),
    };
    if (databaseURL) {
      config.databaseURL = databaseURL;
    }
    firebaseAdminApp = admin.initializeApp(config);
    return firebaseAdminApp;
  } catch (e) {
    console.warn("[Firebase] Init skipped:", e.message);
    return null;
  }
};

export const getFirebaseRealtimeDb = () => {
  const app = getFirebaseAdminApp();
  if (!app) return null;
  return admin.database(app);
};

