// public/embed-v2.js

const API_URL = "/api/v2/availability";
let dataByDate = {}; // Format: { "YYYY-MM-DD": { blockedSlots: [], isFullDayBlocked: false } }
let currentBaseDate = new Date();
currentBaseDate.setDate(1);

let selectedDateKey = null;

const MONTHS_FR = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
const WEEKDAYS_FR = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];

// --- 1. FONCTIONS DE TEMPS ET DE CALCUL ---

function pad(n) { return n.toString().padStart(2, "0"); }

function toKey(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Convertit un index (0 à 23) en heure "HH:mm" (de 08:00 à 19:30)
function indexToTime(index) {
    const hour = Math.floor(index / 2) + 8;
    const min = (index % 2 === 0) ? "00" : "30";
    return `${pad(hour)}:${min}`;
}

// Le coeur du système : calcule les blocs disponibles pour une journée spécifique
function calculateDailySlots(dateKey) {
    const isWeekend = new Date(dateKey + "T00:00:00").getDay() === 0 || new Date(dateKey + "T00:00:00").getDay() === 6;
    const minSlotsRequired = isWeekend ? 8 : 4; // 8 slots = 4h, 4 slots = 2h

    let slots = new Array(24).fill('available');
    const dayData = dataByDate[dateKey] || { blockedSlots: [], isFullDayBlocked: false };

    if (dayData.isFullDayBlocked) {
        return new Array(24).fill('unavailable');
    }

    // 1. Placer les blocages de l'admin
    const blockedSet = new Set(dayData.blockedSlots);
    for (let i = 0; i < 24; i++) {
        if (blockedSet.has(indexToTime(i))) {
            slots[i] = 'booked';
        }
    }

    // 2. Appliquer le tampon de ménage (2 slots = 1h) APRÈS chaque réservation
    for (let i = 0; i < 23; i++) {
        // Si le slot actuel est booké, et que le prochain ne l'est pas, c'est la fin d'une réservation
        if (slots[i] === 'booked' && slots[i+1] !== 'booked') {
            if (i + 1 < 24) slots[i + 1] = 'cleaning';
            if (i + 2 < 24 && slots[i + 2] !== 'booked') slots[i + 2] = 'cleaning';
        }
    }

    // 3. Appliquer la contrainte de durée minimale (2h semaine, 4h weekend)
    let currentFreeChunk = [];
    for (let i = 0; i <= 24; i++) {
        if (i < 24 && slots[i] === 'available') {
            currentFreeChunk.push(i);
        } else {
            if (currentFreeChunk.length > 0 && currentFreeChunk.length < minSlotsRequired) {
                // Trop court, on le bloque
                currentFreeChunk.forEach(idx => slots[idx] = 'system_blocked');
            }
            currentFreeChunk = [];
        }
    }

    // Uniformiser les statuts bloqués pour l'UI (booked, cleaning, system_blocked -> unavailable)
    return slots.map(s => s === 'available' ? 'available' : 'unavailable');
}

// --- 2. GESTION DE L'INTERFACE (UI) ---

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

function renderCalendar() {
    const grid = document.getElementById("calendarGrid");
    const monthLabel = document.getElementById("currentMonthLabel");
    
    const year = currentBaseDate.getFullYear();
    const monthIndex = currentBaseDate.getMonth();
    
    monthLabel.textContent = `${MONTHS_FR[monthIndex]} ${year}`;
    grid.innerHTML = "";

    // En-têtes des jours
    WEEKDAYS_FR.forEach(label => {
        const div = document.createElement("div");
        div.className = "text-center font-label text-[0.75rem] uppercase font-bold text-outline-variant pb-2";
        div.textContent = label;
        grid.appendChild(div);
    });

    const firstDay = new Date(year, monthIndex, 1).getDay();
    const lastDay = new Date(year, monthIndex + 1, 0).getDate();

    // Padding début du mois
    for (let i = 0; i < firstDay; i++) {
        const empty = document.createElement("div");
        empty.className = "aspect-square md:aspect-video lg:aspect-square bg-surface-dim opacity-30 rounded-xl";
        grid.appendChild(empty);
    }

    const todayDate = new Date();
    todayDate.setHours(0,0,0,0);

    for (let d = 1; d <= lastDay; d++) {
        const dateObj = new Date(year, monthIndex, d);
        const key = toKey(dateObj);
        
        const btn = document.createElement("button");
        btn.textContent = d;

        // Si date passée
        if (dateObj < todayDate) {
            btn.className = "aspect-square md:aspect-video lg:aspect-square bg-surface-dim text-on-surface-variant opacity-50 cursor-not-allowed flex items-center justify-center font-body font-medium rounded-xl";
            btn.disabled = true;
        } else {
            // Calculer si la journée a des dispos
            const slots = calculateDailySlots(key);
            const hasAvailable = slots.includes('available');

            if (hasAvailable) {
                btn.className = "aspect-square md:aspect-video lg:aspect-square bg-secondary-container text-secondary flex items-center justify-center font-body font-medium hover:ring-2 ring-secondary ring-offset-2 transition-all rounded-xl cursor-pointer";
            } else {
                btn.className = "aspect-square md:aspect-video lg:aspect-square bg-error-container text-error flex items-center justify-center font-body font-medium hover:ring-2 ring-error ring-offset-2 transition-all rounded-xl cursor-pointer";
            }

            // État sélectionné
            if (key === selectedDateKey) {
                btn.className = "aspect-square md:aspect-video lg:aspect-square bg-primary text-on-primary flex items-center justify-center font-body font-bold ring-4 ring-primary-container ring-offset-0 scale-105 shadow-md rounded-xl";
            }

            btn.onclick = () => {
                selectedDateKey = key;
                renderCalendar(); // Re-render pour afficher l'état sélectionné
                renderTimeline(key, dateObj);
            };
        }
        grid.appendChild(btn);
    }
}

function renderTimeline(dateKey, dateObj) {
    const pane = document.getElementById('timeline-pane');
    const timelineGrid = document.getElementById('timelineGrid');
    const dateLabel = document.getElementById('timelineDateLabel');
    const totalFreeLabel = document.getElementById('timelineTotalFree');

    dateLabel.textContent = `${dateObj.getDate()} ${MONTHS_FR[dateObj.getMonth()]} ${dateObj.getFullYear()}`;
    timelineGrid.innerHTML = "";

    const slots = calculateDailySlots(dateKey);
    let totalFreeSlots = 0;
    
    // Regrouper les slots consécutifs du même statut pour l'affichage
    let chunks = [];
    let currentStatus = slots[0];
    let startIdx = 0;

    for (let i = 1; i <= 24; i++) {
        if (i === 24 || slots[i] !== currentStatus) {
            chunks.push({
                status: currentStatus,
                startIdx: startIdx,
                endIdx: i,
                durationSlots: i - startIdx
            });
            if (i < 24) {
                currentStatus = slots[i];
                startIdx = i;
            }
        }
        if (i < 24 && slots[i] === 'available') {
            totalFreeSlots++;
        }
    }

    totalFreeLabel.textContent = `${totalFreeSlots * 0.5} hours available`;

    // Dessiner les blocs dans la timeline
    chunks.forEach(chunk => {
        const startTime = indexToTime(chunk.startIdx);
        const hoursDuration = chunk.durationSlots * 0.5;
        // Hauteur dynamique basée sur la durée (ex: 1 slot = 45px)
        const minHeight = chunk.durationSlots * 45; 

        const blockDiv = document.createElement('div');
        blockDiv.className = `group flex gap-4 min-h-[${minHeight}px]`;

        let contentHTML = "";
        if (chunk.status === 'available') {
            contentHTML = `
                <div class="h-full w-full bg-surface p-4 flex flex-col justify-center border border-outline-variant border-opacity-30 shadow-sm rounded-xl mb-4">
                    <div class="flex items-center gap-2 mb-1">
                        <div class="w-2 h-2 rounded-full bg-secondary"></div>
                        <span class="text-xs font-label uppercase font-bold text-secondary">Available</span>
                    </div>
                    <span class="text-[11px] font-body text-on-surface-variant">${hoursDuration} Hours Free</span>
                </div>
            `;
        } else {
            contentHTML = `
                <div class="h-full w-full bg-surface-variant p-4 flex flex-col justify-center rounded-xl mb-4">
                    <span class="text-xs font-label uppercase font-bold text-on-surface-variant">Unavailable</span>
                </div>
            `;
        }

        blockDiv.innerHTML = `
            <div class="flex flex-col items-center">
                <span class="text-xs font-label text-outline whitespace-nowrap">${startTime}</span>
                <div class="w-[1px] flex-1 bg-surface-container-high"></div>
            </div>
            <div class="flex-1 pb-0">
                ${contentHTML}
            </div>
        `;
        timelineGrid.appendChild(blockDiv);
    });

    // Ajouter le marqueur de fin (20:00)
    const endMarker = document.createElement('div');
    endMarker.className = "group flex gap-4 h-[20px]";
    endMarker.innerHTML = `
        <div class="flex flex-col items-center">
            <span class="text-xs font-label text-outline whitespace-nowrap">20:00</span>
        </div>
        <div class="flex-1"></div>
    `;
    timelineGrid.appendChild(endMarker);

    // Ouvrir le panneau sur mobile
    if (window.innerWidth < 768) {
        pane.classList.add('show');
    }
}

// Initialisation des boutons de navigation
document.getElementById('prevMonthBtn').addEventListener('click', () => {
    currentBaseDate.setMonth(currentBaseDate.getMonth() - 1);
    renderCalendar();
});

document.getElementById('nextMonthBtn').addEventListener('click', () => {
    currentBaseDate.setMonth(currentBaseDate.getMonth() + 1);
    renderCalendar();
});

document.addEventListener("DOMContentLoaded", () => {
    loadAvailability();
});
