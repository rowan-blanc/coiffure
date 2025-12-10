import express from "express";
import cors from "cors";
import admin from "firebase-admin";
import { google } from "googleapis";
import fs from "fs";

// -------------------------------
// GOOGLE CALENDAR AUTH
// -------------------------------
const SCOPES = ["https://www.googleapis.com/auth/calendar"];

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(
    fs.readFileSync("./google-service-account.json", "utf8")
  ),
  scopes: SCOPES,
});

const calendar = google.calendar({ version: "v3", auth });

// -------------------------------
// FIREBASE INIT
// -------------------------------
admin.initializeApp({
  credential: admin.credential.cert(
    JSON.parse(fs.readFileSync("./google-service-account.json"))
  ),
});

const db = admin.firestore();

// -------------------------------
// EXPRESS APP
// -------------------------------
const app = express();
app.use(cors());
app.use(express.json());

// -------------------------------
// API : CRÉER UN RENDEZ-VOUS
// -------------------------------
app.post("/api/book", async (req, res) => {
  try {
    const { date, time, clientName, phone } = req.body; // time est attendu au format "HH:MM"

    if (!date || !time || !clientName || !phone) {
      return res.status(400).json({ error: "Données manquantes" });
    }

    // Vérifier si le créneau est déjà pris
    const snapshot = await db
      .collection("appointments")
      .where("date", "==", date)
      .where("time", "==", time)
      .get();

    if (!snapshot.empty) {
      return res.status(400).json({ error: "Créneau déjà réservé" });
    }

    // --- CORRECTION DU CALCUL DE L'HEURE DE FIN (Ajout de 30 minutes) ---
    // 1. Créer un objet Date pour manipuler l'heure.
    //    On utilise la date (date) et l'heure (time) reçues.
    const startTimeString = `${date}T${time}:00`;
    const startDate = new Date(startTimeString);

    if (isNaN(startDate)) {
        console.error("Erreur de format de date/heure");
        return res.status(400).json({ error: "Format de date ou d'heure invalide." });
    }
    
    // 2. Ajouter 30 minutes.
    startDate.setMinutes(startDate.getMinutes() + 30);

    // 3. Formater l'heure de fin pour Google Calendar.
    //    Le format attendu pour l'heure est "HH:MM".
    const endHour = String(startDate.getHours()).padStart(2, "0");
    const endMinute = String(startDate.getMinutes()).padStart(2, "0");
    const endTime = `${endHour}:${endMinute}`;
    // -----------------------------------------------------------------


    // Enregistrer dans Firestore
    await db.collection("appointments").add({
      date,
      time,
      clientName,
      phone,
      status: "reserved",
      createdAt: new Date()
    });

    // Ajouter dans Google Calendar
    const event = {
      summary: `RDV coiffure – ${clientName}`,
      description: `Téléphone : ${phone}`,
      start: {
        dateTime: `${date}T${time}:00`,
        timeZone: "Europe/Paris",
      },
      end: {
        dateTime: `${date}T${endTime}:00`, // Utilise l'heure de fin calculée (ex: 11:30)
        timeZone: "Europe/Paris",
      },
    };

    await calendar.events.insert({
      calendarId: "rowan.blanc@gmail.com",
      requestBody: event,
    });

    res.json({ success: true, message: "Rendez-vous enregistré !" });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// -------------------------------
// DÉMARRAGE SERVEUR
// -------------------------------
app.listen(3000, () => {
  console.log("Serveur démarré sur http://localhost:3000");
});