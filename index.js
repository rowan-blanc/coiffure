import express from "express";
import cors from "cors";
import admin from "firebase-admin";
import { google } from "googleapis";
import fs from "fs";

// ----------------------------------------------------
// NOUVELLE LOGIQUE POUR GÉRER LA CLÉ SECRÈTE (RENDER/LOCAL)
// ----------------------------------------------------
let SERVICE_ACCOUNT_KEY_CONTENT;

if (process.env.SERVICE_ACCOUNT_KEY) {
    // 1. Sur Render : Utiliser la variable d'environnement (plus sécurisé)
    try {
        SERVICE_ACCOUNT_KEY_CONTENT = JSON.parse(process.env.SERVICE_ACCOUNT_KEY);
    } catch (e) {
        console.error("ERREUR : Impossible de parser la variable SERVICE_ACCOUNT_KEY.");
        process.exit(1);
    }
} else {
    // 2. En local (PC) : Lire le fichier local
    try {
        SERVICE_ACCOUNT_KEY_CONTENT = JSON.parse(fs.readFileSync("./google-service-account.json", "utf8"));
    } catch (e) {
        console.error("ERREUR CRITIQUE : Fichier google-service-account.json non trouvé. Assurez-vous d'avoir ce fichier en local.");
        // Si la clé n'est pas trouvée, on empêche le serveur de démarrer
        process.exit(1);
    }
}
// ----------------------------------------------------


// -------------------------------
// GOOGLE CALENDAR AUTH
// -------------------------------
const SCOPES = ["https://www.googleapis.com/auth/calendar"];

const auth = new google.auth.GoogleAuth({
  credentials: SERVICE_ACCOUNT_KEY_CONTENT, // Utilise la clé chargée
  scopes: SCOPES,
});

const calendar = google.calendar({ version: "v3", auth });

// -------------------------------
// FIREBASE INIT
// -------------------------------
admin.initializeApp({
  credential: admin.credential.cert(SERVICE_ACCOUNT_KEY_CONTENT), // Utilise la clé chargée
});

const db = admin.firestore();

// -------------------------------
// EXPRESS APP
// -------------------------------
const app = express();
// IMPORTANT : Activez CORS pour que le front-end sur Netlify puisse appeler Render
app.use(cors()); 
app.use(express.json());

// -------------------------------
// API : CRÉER UN RENDEZ-VOUS
// -------------------------------
app.post("/api/book", async (req, res) => {
  try {
    const { date, time, clientName, phone } = req.body; // time est attendu au format "HH:MM"
    
    // --- Remplacez VOTRE_EMAIL_PERSONNEL@gmail.com par l'email de votre calendrier ! ---
    const CALENDAR_ID = "rowan.blanc@gmail.com"; 
    // -----------------------------------------------------------------------------------


    if (!date || !time || !clientName || !phone) {
      return res.status(400).json({ error: "Données manquantes" });
    }

    // Vérifier si le créneau est déjà pris (Firestore)
    const snapshot = await db
      .collection("appointments")
      .where("date", "==", date)
      .where("time", "==", time)
      .get();

    if (!snapshot.empty) {
      return res.status(400).json({ error: "Créneau déjà réservé" });
    }

    // --- CALCUL DE L'HEURE DE FIN (Ajout de 30 minutes) ---
    const startTimeString = `${date}T${time}:00`;
    const startDate = new Date(startTimeString);

    if (isNaN(startDate)) {
        return res.status(400).json({ error: "Format de date ou d'heure invalide." });
    }
    
    startDate.setMinutes(startDate.getMinutes() + 30);

    const endHour = String(startDate.getHours()).padStart(2, "0");
    const endMinute = String(startDate.getMinutes()).padStart(2, "0");
    const endTime = `${endHour}:${endMinute}`;
    // --------------------------------------------------------


    // 1. Enregistrer dans Firestore
    await db.collection("appointments").add({
      date,
      time,
      clientName,
      phone,
      status: "reserved",
      createdAt: new Date()
    });

    // 2. Ajouter dans Google Calendar
    const event = {
      summary: `RDV coiffure – ${clientName}`,
      description: `Téléphone : ${phone}`,
      start: {
        dateTime: `${date}T${time}:00`,
        timeZone: "Europe/Paris",
      },
      end: {
        dateTime: `${date}T${endTime}:00`, 
        timeZone: "Europe/Paris",
      },
    };

    await calendar.events.insert({
      calendarId: CALENDAR_ID, // Utilise l'ID de votre calendrier personnel
      requestBody: event,
    });

    res.json({ success: true, message: "Rendez-vous enregistré !" });

  } catch (error) {
    console.error("Erreur dans /api/book :", error);
    res.status(500).json({ error: "Erreur serveur interne lors de la réservation." });
  }
});

// -------------------------------
// DÉMARRAGE SERVEUR (Configuration pour Render)
// -------------------------------
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Serveur démarré sur port ${PORT}`);
});
