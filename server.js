const express = require("express");
const cors = require("cors");
const path = require("path");
const mongoose = require("mongoose");
const basicAuth = require("express-basic-auth");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 4000;

// --- 1. VARIABLES D'ENVIRONNEMENT ---
const MONGO_URI = process.env.MONGO_URI;
const ADMIN_USER = process.env.ADMIN_USER || "lgervais";
const ADMIN_PASS = process.env.ADMIN_PASS || "Geo8300!";

// Connexion MongoDB
if (!MONGO_URI) {
  console.error("ERREUR: MONGO_URI manquant !");
} else {
  mongoose.connect(MONGO_URI)
    .then(() => console.log("Connecté à MongoDB"))
    .catch(err => console.error("Erreur MongoDB:", err));
}

// --- SCHÉMAS MONGO DB ---

// V1 : Schéma original (Jours complets)
const availabilitySchema = new mongoose.Schema({
  date: { type: String, required: true, unique: true },
  status: { type: String, required: true }
});
const Availability = mongoose.model("Availability", availabilitySchema);

// V2 : Nouveau schéma (Heures par jour)
// 'blockedSlots' sera un tableau d'heures sous format "HH:mm" (ex: ["08:00", "08:30", "09:00"])
const availabilityV2Schema = new mongoose.Schema({
  date: { type: String, required: true, unique: true },
  blockedSlots: { type: [String], default: [] },
  isFullDayBlocked: { type: Boolean, default: false } // Option pour bloquer toute la journée d'un coup
});
const AvailabilityV2 = mongoose.model("AvailabilityV2", availabilityV2Schema);


app.use(cors());
app.use(express.json());

// --- 2. SÉCURITÉ (MIDDLEWARE) ---
const authMiddleware = basicAuth({
    users: { [ADMIN_USER]: ADMIN_PASS },
    challenge: true
});

// On protège admin.html ET admin-v2.html
app.use("/admin.html", authMiddleware);
app.use("/admin-v2.html", authMiddleware);

app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (req, res) => { res.json({ status: "ok" }); });

// --- 3. ROUTES API V1 (Intactes) ---
app.get("/api/availability", async (req, res) => {
  try {
    const items = await Availability.find({}, 'date status -_id');
    res.json(items);
  } catch (err) { res.status(500).json({ error: "Erreur serveur" }); }
});

app.get("/api/availability/:date", async (req, res) => {
  try {
    const found = await Availability.findOne({ date: req.params.date });
    res.json({ date: req.params.date, status: found ? found.status : "available" });
  } catch (err) { res.status(500).json({ error: "Erreur serveur" }); }
});

app.put("/api/availability", authMiddleware, async (req, res) => {
  const { date, status } = req.body;
  if (!date || !status) return res.status(400).json({ error: "Missing data" });
  
  const allowed = ["available", "unavailable", "pending"];
  if (!allowed.includes(status)) return res.status(400).json({ error: "Invalid status" });

  try {
    await Availability.findOneAndUpdate(
      { date }, { status }, { upsert: true, new: true }
    );
    res.json({ date, status });
  } catch (err) { res.status(500).json({ error: "Save failed" }); }
});


// --- 4. ROUTES API V2 (Nouvelles) ---

// Lecture V2
app.get("/api/v2/availability", async (req, res) => {
  try {
    const items = await AvailabilityV2.find({}, 'date blockedSlots isFullDayBlocked -_id');
    res.json(items);
  } catch (err) { res.status(500).json({ error: "Erreur serveur" }); }
});

// Écriture V2 (Protégée)
app.put("/api/v2/availability", authMiddleware, async (req, res) => {
  const { date, blockedSlots, isFullDayBlocked } = req.body;
  if (!date) return res.status(400).json({ error: "Missing date" });

  try {
    await AvailabilityV2.findOneAndUpdate(
      { date }, 
      { blockedSlots: blockedSlots || [], isFullDayBlocked: isFullDayBlocked || false }, 
      { upsert: true, new: true }
    );
    res.json({ date, blockedSlots, isFullDayBlocked });
  } catch (err) { res.status(500).json({ error: "Save failed" }); }
});

// Route par défaut
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "embed.html"));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
