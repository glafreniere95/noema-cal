// public/admin-v2.js

const API_URL = "/api/v2/availability";

let dataByDate = {}; 
let currentBaseDate = new Date();
currentBaseDate.setDate(1);

let selectedDateKey = null;
let currentBlockedSlots = new Set();
let isCurrentDayFullBlocked = false;

const MONTHS_FR = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
const WEEKDAYS_FR = ["DI", "LU", "MA", "ME", "JE", "VE", "SA"];

// Générer les heures de 08:00 à 19:30
const timeSlots = [];
for (let i = 0; i < 24; i++) {
    const h = Math.floor(i / 2) + 8;
    const m = i % 2 === 0 ? "00" : "30";
    timeSlots.push(`${h.toString().padStart(2, '0')}:${m}`);
}

function pad(n) { return n.toString().padStart(2, "0"); }

function toKey(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// 1. CHARGEMENT
async function loadAvailability() {
    try {
        const res = await fetch(API_URL);
        const items = await res.json();
        dataByDate = {};
        for (const item of items) {
            dataByDate[item.date] = item;
        }
        renderCalendar();
    } catch (err) {
        console.error("Erreur de chargement", err);
    }
}

// 2. CALENDRIER
function renderCalendar() {
    const grid = document.getElementById("calendarGrid");
    const label = document.getElementById("currentRange");
    grid.innerHTML = "";

    const m1 = new Date(currentBaseDate);
    label.textContent = `${MONTHS_FR[m1.getMonth()]} ${m1.getFullYear()}`;
    grid.appendChild(buildMonthCard(m1));
}

function buildMonthCard(monthDate) {
    const year = monthDate.getFullYear();
    const monthIndex = monthDate.getMonth();

    const container = document.createElement("section");
    container.className = "month-card";

    const weekdaysRow = document.createElement("div");
    weekdaysRow.className = "weekdays";
    WEEKDAYS_FR.forEach((label) => {
        const span = document.createElement("div"); span.textContent = label; weekdaysRow.appendChild(span);
    });
    container.appendChild(weekdaysRow);

    const daysGrid = document.createElement("div"); daysGrid.className = "days";

    const startIndex = new Date(year, monthIndex, 1).getDay();
    for (let i = 0; i < startIndex; i++) {
        const empty = document.createElement("div"); empty.className = "day empty"; daysGrid.appendChild(empty);
    }

    const lastDay = new Date(year, monthIndex + 1, 0).getDate();
    const todayDate = new Date();
    todayDate.setHours(0,0,0,0);

    for (let d = 1; d <= lastDay; d++) {
        const dateObj = new Date(year, monthIndex, d);
        const key = toKey(dateObj);
        
        const cell = document.createElement("button");
        cell.className = "day";
        cell.textContent = d;

        if (dateObj < todayDate) {
            cell.classList.add("past");
            cell.disabled = true;
        } else {
            // Afficher des couleurs si la date a déjà des trucs bloqués
            const dayData = dataByDate[key];
            if (dayData) {
                if (dayData.isFullDayBlocked) cell.classList.add("full-blocked");
                else if (dayData.blockedSlots && dayData.blockedSlots.length > 0) cell.classList.add("has-blocks");
            }

            if (key === selectedDateKey) cell.classList.add("selected");

            cell.onclick = () => {
                selectedDateKey = key;
                renderCalendar();
                openSlotsPanel(key, dateObj);
            };
        }
        daysGrid.appendChild(cell);
    }
    container.appendChild(daysGrid);
    return container;
}

// 3. PANNEAU DES HEURES
function openSlotsPanel(dateKey, dateObj) {
    document.getElementById("slotsPanel").style.display = "block";
    document.getElementById("selectedDateLabel").textContent = `${dateObj.getDate()} ${MONTHS_FR[dateObj.getMonth()]} ${dateObj.getFullYear()}`;
    document.getElementById("saveStatus").textContent = "";

    const dayData = dataByDate[dateKey] || { blockedSlots: [], isFullDayBlocked: false };
    
    currentBlockedSlots = new Set(dayData.blockedSlots || []);
    isCurrentDayFullBlocked = dayData.isFullDayBlocked || false;

    const fullDayToggle = document.getElementById("fullDayToggle");
    fullDayToggle.checked = isCurrentDayFullBlocked;
    
    fullDayToggle.onchange = (e) => {
        isCurrentDayFullBlocked = e.target.checked;
        renderSlotsList();
    };

    renderSlotsList();
}

function renderSlotsList() {
    const list = document.getElementById("slotsList");
    list.innerHTML = "";

    timeSlots.forEach(time => {
        const btn = document.createElement("button");
        const isBlocked = isCurrentDayFullBlocked || currentBlockedSlots.has(time);
        
        btn.className = `slot-btn ${isBlocked ? 'blocked' : ''}`;
        btn.textContent = time;
        btn.disabled = isCurrentDayFullBlocked; // Impossible de cliquer sur les heures si tout est bloqué

        btn.onclick = () => {
            if (currentBlockedSlots.has(time)) {
                currentBlockedSlots.delete(time);
            } else {
                currentBlockedSlots.add(time);
            }
            renderSlotsList(); // Mettre à jour l'UI
        };

        list.appendChild(btn);
    });
}

// 4. SAUVEGARDE
document.getElementById("saveBtn").addEventListener("click", async () => {
    if (!selectedDateKey) return;

    const payload = {
        date: selectedDateKey,
        blockedSlots: Array.from(currentBlockedSlots),
        isFullDayBlocked: isCurrentDayFullBlocked
    };

    try {
        const res = await fetch(API_URL, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            // Mettre à jour nos données locales pour l'affichage
            dataByDate[selectedDateKey] = payload;
            document.getElementById("saveStatus").textContent = "Enregistré avec succès ! ✅";
            renderCalendar(); // Rafraîchir les couleurs du calendrier
            
            setTimeout(() => {
                document.getElementById("saveStatus").textContent = "";
            }, 3000);
        }
    } catch (err) {
        alert("Erreur lors de la sauvegarde.");
    }
});

// 5. NAV
document.getElementById("prevMonth").addEventListener("click", () => {
    currentBaseDate.setMonth(currentBaseDate.getMonth() - 1); renderCalendar();
});
document.getElementById("nextMonth").addEventListener("click", () => {
    currentBaseDate.setMonth(currentBaseDate.getMonth() + 1); renderCalendar();
});

document.addEventListener("DOMContentLoaded", () => {
    loadAvailability();
});
