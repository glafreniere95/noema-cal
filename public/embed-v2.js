// public/embed-v2.js

const API_URL = "/api/v2/availability";

let dataByDate = {}; // Format: { "YYYY-MM-DD": { blockedSlots: [], isFullDayBlocked: false } }
let currentBaseDate = new Date();
currentBaseDate.setDate(1);
currentBaseDate.setHours(0, 0, 0, 0);

let selectedDateKey = null;
let mobileCalendarScrollY = 0;
let wasMobileLayout = window.matchMedia("(max-width: 767px)").matches;
let resizeFrame = null;
let timelineCloseTimer = null;

const MONTHS_FR = [
    "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
    "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"
];

const WEEKDAYS_FR = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];
const WEEKDAYS_FR_MOBILE = ["DIM", "LUN", "MAR", "MER", "JEU", "VEN", "SAM"];

// --- 1. FONCTIONS DE TEMPS ET DE CALCUL ---

function pad(n) {
    return n.toString().padStart(2, "0");
}

function toKey(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function fromKey(dateKey) {
    const [year, month, day] = dateKey.split("-").map(Number);
    return new Date(year, month - 1, day);
}

function getToday() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
}

function isMobileLayout() {
    return window.matchMedia("(max-width: 767px)").matches;
}

function prefersReducedMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function formatHours(hours) {
    return Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
}

// Convertit un index (0 à 23) en heure "HH:mm" (de 08:00 à 19:30)
function indexToTime(index) {
    const hour = Math.floor(index / 2) + 8;
    const min = index % 2 === 0 ? "00" : "30";
    return `${pad(hour)}:${min}`;
}

// Calcule les blocs disponibles pour une journée spécifique.
function calculateDailySlots(dateKey) {
    const dayDate = fromKey(dateKey);
    const isWeekend = dayDate.getDay() === 0 || dayDate.getDay() === 6;
    const minSlotsRequired = isWeekend ? 8 : 4; // 8 slots = 4h, 4 slots = 2h

    const slots = new Array(24).fill("available");
    const dayData = dataByDate[dateKey] || { blockedSlots: [], isFullDayBlocked: false };

    if (dayData.isFullDayBlocked) {
        return new Array(24).fill("unavailable");
    }

    // 1. Placer les blocages de l'admin.
    const blockedSet = new Set(dayData.blockedSlots || []);
    for (let i = 0; i < 24; i++) {
        if (blockedSet.has(indexToTime(i))) {
            slots[i] = "booked";
        }
    }

    // 2. Appliquer le tampon de ménage de 1h après chaque réservation.
    for (let i = 0; i < 23; i++) {
        if (slots[i] === "booked" && slots[i + 1] !== "booked") {
            if (i + 1 < 24) slots[i + 1] = "cleaning";
            if (i + 2 < 24 && slots[i + 2] !== "booked") slots[i + 2] = "cleaning";
        }
    }

    // 3. Appliquer la contrainte de durée minimale.
    let currentFreeChunk = [];
    for (let i = 0; i <= 24; i++) {
        if (i < 24 && slots[i] === "available") {
            currentFreeChunk.push(i);
        } else {
            if (currentFreeChunk.length > 0 && currentFreeChunk.length < minSlotsRequired) {
                currentFreeChunk.forEach((idx) => {
                    slots[idx] = "system_blocked";
                });
            }
            currentFreeChunk = [];
        }
    }

    // Uniformiser les statuts bloqués pour l'UI.
    return slots.map((status) => status === "available" ? "available" : "unavailable");
}

function hasAvailability(dateKey) {
    return calculateDailySlots(dateKey).includes("available");
}

// --- 2. CHARGEMENT DES DONNÉES ---

async function loadAvailability() {
    try {
        const res = await fetch(API_URL);
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
        }

        const items = await res.json();
        dataByDate = {};

        for (const item of items) {
            dataByDate[item.date] = item;
        }

        // Tablette et desktop démarrent directement sur aujourd'hui.
        if (!isMobileLayout()) {
            const today = getToday();
            selectedDateKey = toKey(today);
            currentBaseDate = new Date(today.getFullYear(), today.getMonth(), 1);
        }

        renderCalendar();

        if (!isMobileLayout() && selectedDateKey) {
            renderTimeline(selectedDateKey, fromKey(selectedDateKey), { animate: false });
        }
    } catch (err) {
        console.error("Erreur de chargement", err);
    }
}

// --- 3. CALENDRIER ---

function renderCalendar({ animate = false } = {}) {
    const root = document.getElementById("calendarGrid");
    const monthLabel = document.getElementById("currentMonthLabel");

    const baseMonth = new Date(
        currentBaseDate.getFullYear(),
        currentBaseDate.getMonth(),
        1
    );

    monthLabel.textContent = `${MONTHS_FR[baseMonth.getMonth()]} ${baseMonth.getFullYear()}`;
    root.innerHTML = "";

    // Mobile: deux mois consécutifs verticalement.
    if (isMobileLayout()) {
        root.appendChild(buildMonthSection(baseMonth, false));

        const nextMonth = new Date(baseMonth.getFullYear(), baseMonth.getMonth() + 1, 1);
        root.appendChild(buildMonthSection(nextMonth, true));
    } else {
        // Tablette et desktop: un mois, avec la timeline visible à droite.
        root.appendChild(buildMonthSection(baseMonth, false));
    }

    if (animate) {
        animateCalendarRefresh();
    }
}

function animateCalendarRefresh() {
    if (prefersReducedMotion()) return;

    const root = document.getElementById("calendarGrid");
    root.classList.remove("calendar-refresh");
    void root.offsetWidth;
    root.classList.add("calendar-refresh");

    window.setTimeout(() => {
        root.classList.remove("calendar-refresh");
    }, 240);
}

function buildMonthSection(monthDate, showTitle) {
    const year = monthDate.getFullYear();
    const monthIndex = monthDate.getMonth();

    const section = document.createElement("section");
    section.className = "month-section";

    if (showTitle) {
        const title = document.createElement("h2");
        title.className = "month-title-secondary";
        title.textContent = `${MONTHS_FR[monthIndex]} ${year}`;
        section.appendChild(title);
    }

    const grid = document.createElement("div");
    grid.className = "month-grid";

    WEEKDAYS_FR.forEach((label) => {
        const weekday = document.createElement("div");
        weekday.className = "weekday-cell";
        weekday.textContent = label;
        grid.appendChild(weekday);
    });

    const firstDayIndex = new Date(year, monthIndex, 1).getDay();
    const lastDay = new Date(year, monthIndex + 1, 0).getDate();
    const today = getToday();

    let renderedDayCells = 0;

    for (let i = 0; i < firstDayIndex; i++) {
        grid.appendChild(createEmptyDayCell());
        renderedDayCells++;
    }

    for (let day = 1; day <= lastDay; day++) {
        const dateObj = new Date(year, monthIndex, day);
        const dateKey = toKey(dateObj);
        const button = document.createElement("button");

        button.type = "button";
        button.className = "day-cell";
        button.dataset.dateKey = dateKey;
        button.textContent = String(day);
        button.setAttribute(
            "aria-label",
            `${day} ${MONTHS_FR[monthIndex]} ${year}`
        );

        if (dateObj < today) {
            button.classList.add("day-past");
            button.disabled = true;
        } else {
            button.classList.add(hasAvailability(dateKey) ? "day-available" : "day-unavailable");

            if (dateKey === selectedDateKey) {
                button.classList.add("day-selected");
                button.setAttribute("aria-current", "date");
            }

            button.addEventListener("click", () => {
                selectDate(dateObj);
            });
        }

        grid.appendChild(button);
        renderedDayCells++;
    }

    // Toujours compléter 6 semaines pour garder une géométrie stable sur desktop/tablette.
    while (renderedDayCells < 42) {
        grid.appendChild(createEmptyDayCell());
        renderedDayCells++;
    }

    section.appendChild(grid);
    return section;
}

function createEmptyDayCell() {
    const empty = document.createElement("div");
    empty.className = "day-cell day-empty";
    empty.setAttribute("aria-hidden", "true");
    return empty;
}

function syncCalendarSelection() {
    document.querySelectorAll(".day-cell.day-selected").forEach((button) => {
        button.classList.remove("day-selected");
        button.removeAttribute("aria-current");
    });

    if (!selectedDateKey) return;

    document.querySelectorAll(`.day-cell[data-date-key="${selectedDateKey}"]`).forEach((button) => {
        button.classList.add("day-selected");
        button.setAttribute("aria-current", "date");
    });
}

function selectDate(dateObj, { direction = null, animate = true } = {}) {
    const normalizedDate = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate());
    const previousDate = selectedDateKey ? fromKey(selectedDateKey) : null;

    if (direction === null && previousDate) {
        direction = normalizedDate > previousDate ? 1 : normalizedDate < previousDate ? -1 : 0;
    }

    selectedDateKey = toKey(normalizedDate);

    const calendarWindowChanged = keepSelectedDateInsideMobileCalendarWindow(normalizedDate);

    if (calendarWindowChanged) {
        renderCalendar({ animate: true });
    } else {
        syncCalendarSelection();
    }

    renderTimeline(selectedDateKey, normalizedDate, {
        direction: direction || 0,
        animate
    });
}

function keepSelectedDateInsideMobileCalendarWindow(dateObj) {
    if (!isMobileLayout()) return false;

    const baseStart = new Date(currentBaseDate.getFullYear(), currentBaseDate.getMonth(), 1);
    const windowEnd = new Date(currentBaseDate.getFullYear(), currentBaseDate.getMonth() + 2, 0);

    if (dateObj < baseStart) {
        currentBaseDate = new Date(dateObj.getFullYear(), dateObj.getMonth(), 1);
        return true;
    }

    if (dateObj > windowEnd) {
        currentBaseDate = new Date(dateObj.getFullYear(), dateObj.getMonth() - 1, 1);
        return true;
    }

    return false;
}

// --- 4. TIMELINE ---

function renderTimeline(dateKey, dateObj, { direction = 0, animate = true } = {}) {
    const pane = document.getElementById("timeline-pane");
    const timelineGrid = document.getElementById("timelineGrid");
    const dateLabel = document.getElementById("timelineDateLabel");
    const totalFreeLabel = document.getElementById("timelineTotalFree");
    const panelWasOpen = pane.classList.contains("show");

    dateLabel.textContent = `${dateObj.getDate()} ${MONTHS_FR[dateObj.getMonth()]} ${dateObj.getFullYear()}`;
    timelineGrid.innerHTML = "";

    const slots = calculateDailySlots(dateKey);

    // Les 24 demi-heures de 08:00 à 20:00 représentent exactement 12 heures.
    const totalFreeSlots = slots.filter((status) => status === "available").length;
    totalFreeLabel.textContent = `${formatHours(totalFreeSlots * 0.5)} hours available`;

    const chunks = buildTimelineChunks(slots);

    chunks.forEach((chunk) => {
        timelineGrid.appendChild(createTimelineChunk(chunk));
    });

    if (isMobileLayout()) {
        renderMobileDateNavigator(dateObj, { smooth: panelWasOpen });
        openMobileTimeline(pane);
    }

    // À la première ouverture mobile, le panneau lui-même fait l'animation.
    // Pour les changements de journée, on anime doucement le contenu.
    if (animate && (!isMobileLayout() || panelWasOpen)) {
        animateTimelineChange(direction);
    }
}

function animateTimelineChange(direction = 0) {
    if (prefersReducedMotion()) return;

    const shift = direction > 0 ? 12 : direction < 0 ? -12 : 0;
    const targets = [
        document.querySelector(".timeline-header"),
        isMobileLayout() ? document.getElementById("mobileDateNavigator") : null,
        document.querySelector(".timeline-track")
    ].filter(Boolean);

    targets.forEach((element, index) => {
        element.getAnimations().forEach((animation) => animation.cancel());
        element.animate(
            [
                {
                    opacity: 0.68,
                    transform: `translateX(${shift}px)`
                },
                {
                    opacity: 1,
                    transform: "translateX(0)"
                }
            ],
            {
                duration: 210 + (index * 20),
                easing: "cubic-bezier(0.22, 1, 0.36, 1)",
                fill: "both"
            }
        );
    });
}

function buildTimelineChunks(slots) {
    const chunks = [];
    let currentStatus = slots[0];
    let startIdx = 0;

    for (let i = 1; i <= slots.length; i++) {
        if (i === slots.length || slots[i] !== currentStatus) {
            chunks.push({
                status: currentStatus,
                startIdx,
                endIdx: i,
                durationSlots: i - startIdx
            });

            if (i < slots.length) {
                currentStatus = slots[i];
                startIdx = i;
            }
        }
    }

    return chunks;
}

function createTimelineChunk(chunk) {
    const startTime = indexToTime(chunk.startIdx);
    const hoursDuration = chunk.durationSlots * 0.5;

    const block = document.createElement("div");
    block.className = "timeline-chunk";
    block.dataset.slots = String(chunk.durationSlots);

    // Chaque tranche prend une portion exacte de la hauteur disponible.
    // Les 24 demi-heures remplissent donc toujours 08:00 à 20:00 sans scroll.
    block.style.flex = `${chunk.durationSlots} 1 0`;

    const axis = document.createElement("div");
    axis.className = "timeline-axis";

    const time = document.createElement("span");
    time.className = "timeline-time";
    time.textContent = startTime;

    const line = document.createElement("div");
    line.className = "timeline-line";

    axis.appendChild(time);
    axis.appendChild(line);

    const content = document.createElement("div");
    content.className = "timeline-content";

    const card = document.createElement("div");
    card.className = `timeline-card ${chunk.status}`;

    if (chunk.status === "available") {
        const statusRow = document.createElement("div");
        statusRow.className = "timeline-status-row";

        const dot = document.createElement("span");
        dot.className = "timeline-status-dot";

        const label = document.createElement("span");
        label.className = "timeline-card-label";
        label.textContent = "Available";

        const detail = document.createElement("span");
        detail.className = "timeline-card-detail";
        detail.textContent = `${formatHours(hoursDuration)} Hours Free`;

        statusRow.appendChild(dot);
        statusRow.appendChild(label);
        card.appendChild(statusRow);
        card.appendChild(detail);
    } else {
        const label = document.createElement("span");
        label.className = "timeline-card-label";
        label.textContent = "Unavailable";
        card.appendChild(label);
    }

    content.appendChild(card);
    block.appendChild(axis);
    block.appendChild(content);

    return block;
}

// --- 5. CARROUSEL DE DATES MOBILE ---

function renderMobileDateNavigator(selectedDate, { smooth = true } = {}) {
    const strip = document.getElementById("mobileDateStrip");
    const prevButton = document.getElementById("mobilePrevDayBtn");
    const today = getToday();

    strip.innerHTML = "";

    // 29 dates donnent assez de contenu pour un vrai swipe horizontal,
    // tout en recentrant la date sélectionnée après chaque sélection.
    for (let offset = -14; offset <= 14; offset++) {
        const dateObj = new Date(
            selectedDate.getFullYear(),
            selectedDate.getMonth(),
            selectedDate.getDate() + offset
        );

        const dateKey = toKey(dateObj);
        const button = document.createElement("button");
        const weekday = document.createElement("span");
        const number = document.createElement("span");

        button.type = "button";
        button.className = "mobile-date-chip";
        button.dataset.dateKey = dateKey;
        button.setAttribute(
            "aria-label",
            `${dateObj.getDate()} ${MONTHS_FR[dateObj.getMonth()]} ${dateObj.getFullYear()}`
        );

        weekday.className = "mobile-date-weekday";
        weekday.textContent = WEEKDAYS_FR_MOBILE[dateObj.getDay()];

        number.className = "mobile-date-number";
        number.textContent = String(dateObj.getDate());

        button.appendChild(weekday);
        button.appendChild(number);

        if (dateObj < today) {
            button.classList.add("past");
            button.disabled = true;
        } else {
            button.classList.add(hasAvailability(dateKey) ? "available" : "unavailable");
            button.addEventListener("click", () => {
                const currentDate = selectedDateKey ? fromKey(selectedDateKey) : selectedDate;
                const direction = dateObj > currentDate ? 1 : dateObj < currentDate ? -1 : 0;
                selectDate(dateObj, { direction });
            });
        }

        if (dateKey === selectedDateKey) {
            button.classList.add("selected");
            button.setAttribute("aria-current", "date");
        }

        strip.appendChild(button);
    }

    prevButton.disabled = selectedDate <= today;

    requestAnimationFrame(() => {
        updateMobileDateSizing();
        centerSelectedMobileDate(smooth);
    });
}

function updateMobileDateSizing() {
    const strip = document.getElementById("mobileDateStrip");
    if (!strip || !strip.clientWidth) return;

    const styles = window.getComputedStyle(strip);
    const gap = parseFloat(styles.columnGap || styles.gap) || 6;
    const availableWidth = strip.clientWidth;
    const minimumChipWidth = 44;

    // On privilégie 5 cases complètes. Si l'espace est trop serré, on passe à 3.
    // Le résultat reste toujours un nombre impair pour garder la date sélectionnée centrée.
    const fiveChipWidth = (availableWidth - (gap * 4)) / 5;
    const visibleCount = fiveChipWidth >= minimumChipWidth ? 5 : 3;
    const chipWidth = (availableWidth - (gap * (visibleCount - 1))) / visibleCount;

    strip.style.setProperty("--mobile-chip-width", `${chipWidth}px`);
    strip.dataset.visibleDays = String(visibleCount);
}

function centerSelectedMobileDate(smooth = true) {
    const strip = document.getElementById("mobileDateStrip");
    const selected = strip.querySelector(".mobile-date-chip.selected");

    if (!selected) return;

    const targetLeft = selected.offsetLeft - ((strip.clientWidth - selected.offsetWidth) / 2);
    strip.scrollTo({
        left: Math.max(0, targetLeft),
        behavior: smooth && !prefersReducedMotion() ? "smooth" : "auto"
    });
}

function navigateSelectedDay(direction) {
    if (!selectedDateKey) return;

    const current = fromKey(selectedDateKey);
    const target = new Date(
        current.getFullYear(),
        current.getMonth(),
        current.getDate() + direction
    );

    if (target < getToday()) return;
    selectDate(target, { direction });
}

// --- 6. OUVERTURE / FERMETURE MOBILE ---

function openMobileTimeline(pane) {
    if (timelineCloseTimer) {
        window.clearTimeout(timelineCloseTimer);
        timelineCloseTimer = null;
    }

    pane.classList.remove("is-closing");

    if (!pane.classList.contains("show")) {
        mobileCalendarScrollY = window.scrollY;
        document.body.style.top = `-${mobileCalendarScrollY}px`;
        document.body.classList.add("timeline-open");
        pane.classList.add("show");
    }
}

function closeMobileTimeline({ restoreScroll = true, immediate = false } = {}) {
    const pane = document.getElementById("timeline-pane");
    const wasOpen = pane.classList.contains("show") || document.body.classList.contains("timeline-open");

    if (!wasOpen) return;

    const finalizeClose = () => {
        pane.classList.remove("show", "is-closing");
        document.body.classList.remove("timeline-open");
        document.body.style.top = "";

        if (restoreScroll) {
            window.scrollTo(0, mobileCalendarScrollY);
        }

        timelineCloseTimer = null;
    };

    if (immediate || prefersReducedMotion()) {
        finalizeClose();
        return;
    }

    pane.classList.add("is-closing");
    timelineCloseTimer = window.setTimeout(finalizeClose, 190);
}

// --- 7. NAVIGATION ET RESPONSIVE ---

document.getElementById("prevMonthBtn").addEventListener("click", () => {
    currentBaseDate = new Date(
        currentBaseDate.getFullYear(),
        currentBaseDate.getMonth() - 1,
        1
    );
    renderCalendar({ animate: true });
});

document.getElementById("nextMonthBtn").addEventListener("click", () => {
    currentBaseDate = new Date(
        currentBaseDate.getFullYear(),
        currentBaseDate.getMonth() + 1,
        1
    );
    renderCalendar({ animate: true });
});

document.getElementById("mobilePrevDayBtn").addEventListener("click", () => {
    navigateSelectedDay(-1);
});

document.getElementById("mobileNextDayBtn").addEventListener("click", () => {
    navigateSelectedDay(1);
});

document.getElementById("timeline-close").addEventListener("click", () => {
    closeMobileTimeline();
});

window.addEventListener("resize", () => {
    if (resizeFrame) {
        cancelAnimationFrame(resizeFrame);
    }

    resizeFrame = requestAnimationFrame(() => {
        const mobileNow = isMobileLayout();

        if (mobileNow !== wasMobileLayout) {
            if (!mobileNow) {
                closeMobileTimeline({ restoreScroll: false, immediate: true });

                if (!selectedDateKey) {
                    const today = getToday();
                    selectedDateKey = toKey(today);
                    currentBaseDate = new Date(today.getFullYear(), today.getMonth(), 1);
                }

                renderCalendar();
                renderTimeline(selectedDateKey, fromKey(selectedDateKey), { animate: false });
            } else {
                closeMobileTimeline({ restoreScroll: false, immediate: true });
                renderCalendar();
            }

            wasMobileLayout = mobileNow;
            return;
        }

        if (mobileNow) {
            updateMobileDateSizing();
            centerSelectedMobileDate(false);
        }
    });
});

document.addEventListener("DOMContentLoaded", () => {
    loadAvailability();
});
