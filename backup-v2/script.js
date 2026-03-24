import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js";
import { getDatabase, ref, push, onValue, remove, update, set, get } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-database.js";
import { getAuth, signOut } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyAn7gIui9U5Yt6dDjJAX-gIUxQCkzkwz-o",
  authDomain: "hutang-notes.firebaseapp.com",
  databaseURL: "https://hutang-notes-default-rtdb.firebaseio.com",
  projectId: "hutang-notes",
  storageBucket: "hutang-notes.firebasestorage.app",
  messagingSenderId: "705787619261",
  appId: "1:705787619261:web:44ba4dfad2535d202e94d4"
};

const WEB_PUSH_PUBLIC_KEY = "BGk-P9mFil_YW7XIj5QZSiEsZ0_DqgIFrAFnYqQ8eXIKKRDb50LD9VEmM1TjsUyIVvcK2zR6YzS5y8tBHWkPfzM";

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);

let tasksRef;
let habitsRef;
let currentUserId = "";
let currentUserUid = "";

let allTasks = [];
let allHabits = [];
let timerInterval;
let timeLeft = 25 * 60;
let isTimerRunning = false;
let notifiedTasks = new Set();
let currentFilter = "all";
let currentRoutineFilter = "daily";
let pendingReminders = [];
let currentEditTaskId = null;
let currentReminderTarget = "new";
let activeAlarmTimeouts = [];
let isAlarmActive = false;
let selectedCalendarDate = null;
let currentCalDate = new Date();

window.addEventListener("DOMContentLoaded", () => {
    checkUserLogin();
    setupUserRefs();
    loadData();
    setupDateInputs();
    checkTheme();
    checkNotificationPermission();
    setupReminderOptions();
    setupModalReminderTypeHandler();
    updateTimerDisplay();
    renderWidgets();
    registerServiceWorker();
    setInterval(checkReminders, 30000);
});

function checkUserLogin() {
    const currentUser = localStorage.getItem("currentUser");
    const storedUid = localStorage.getItem("currentUserUid");
    if (!currentUser || !storedUid) {
        window.location.href = "login.html";
        return;
    }

    currentUserId = currentUser;
    currentUserUid = storedUid;
    const currentUserEl = document.getElementById("current-user");
    if (currentUserEl) {
        currentUserEl.textContent = currentUser;
    }
}

function setupUserRefs() {
    tasksRef = ref(db, "tasks");
    habitsRef = ref(db, "habits");
}

function sanitizeUserKey(value) {
    return String(value || "guest").replace(/[.#$/\[\]]/g, "_");
}

function loadData() {
    onValue(tasksRef, (snapshot) => {
        const data = snapshot.val();
        allTasks = data
            ? Object.entries(data)
                .map(([id, val]) => normalizeTask({ id, ...val }))
                .filter((task) => belongsToCurrentUser(task))
            : [];

        allTasks.sort((a, b) => {
            if (Boolean(a.pinned) === Boolean(b.pinned)) {
                return (a.date || "").localeCompare(b.date || "");
            }
            return a.pinned ? -1 : 1;
        });

        renderTasks();
        renderRoutineTasks();
        renderCalendar();
        updateStats();
        updateAnalytics();
        renderWidgets();
        checkReminders();
    });

    onValue(habitsRef, (snapshot) => {
        const data = snapshot.val();
        allHabits = data
            ? Object.entries(data)
                .map(([id, val]) => ({ id, ...val }))
                .filter((habit) => belongsToCurrentUser(habit))
            : [];
        renderHabits();
        updateStats();
        renderWidgets();
    });
}

function belongsToCurrentUser(item) {
    return item.ownerId === currentUserUid || item.ownerName === currentUserId;
}

function normalizeTask(task) {
    const reminders = Array.isArray(task.reminders) ? task.reminders : [];
    const recurrence = task.recurrence || inferRecurrenceFromReminders(reminders);
    const startDate = task.date || getLocalDateKey(new Date(task.createdAt || Date.now()));
    const baseDate = parseLocalDateKey(startDate);

    return {
        ...task,
        reminders,
        recurrence,
        completed: Boolean(task.completed),
        pinned: Boolean(task.pinned),
        date: startDate,
        subtasks: Array.isArray(task.subtasks) ? task.subtasks : [],
        collaborators: Array.isArray(task.collaborators) ? task.collaborators : [],
        completedOccurrences: Array.isArray(task.completedOccurrences) ? task.completedOccurrences : [],
        recurringMeta: {
            dayOfWeek: typeof task.recurringMeta?.dayOfWeek === "number" ? task.recurringMeta.dayOfWeek : baseDate.getDay(),
            dateOfMonth: typeof task.recurringMeta?.dateOfMonth === "number" ? task.recurringMeta.dateOfMonth : baseDate.getDate()
        }
    };
}

function inferRecurrenceFromReminders(reminders) {
    const recurring = reminders.find((item) => ["daily", "weekly", "monthly"].includes(item.type));
    return recurring ? recurring.type : "none";
}

function isRecurringTask(task) {
    return ["daily", "weekly", "monthly"].includes(task.recurrence);
}

function taskOccursOnDate(task, dateKey) {
    if (!task || !dateKey) return false;

    if (!isRecurringTask(task)) {
        return task.date === dateKey;
    }

    if (dateKey < task.date) return false;

    const targetDate = parseLocalDateKey(dateKey);
    switch (task.recurrence) {
        case "daily":
            return true;
        case "weekly":
            return targetDate.getDay() === task.recurringMeta.dayOfWeek;
        case "monthly":
            return targetDate.getDate() === task.recurringMeta.dateOfMonth;
        default:
            return false;
    }
}

function isTaskCompletedForDate(task, dateKey = getLocalDateKey(new Date())) {
    if (isRecurringTask(task)) {
        return task.completedOccurrences.includes(dateKey);
    }
    return Boolean(task.completed);
}

function getCompletedCount(task) {
    if (isRecurringTask(task)) {
        return task.completedOccurrences.length;
    }
    return task.completed ? 1 : 0;
}

function getTodayRecurringTasks() {
    const todayKey = getLocalDateKey(new Date());
    return allTasks.filter((task) => isRecurringTask(task) && taskOccursOnDate(task, todayKey));
}

function getCompletionDateLabel(dateKey) {
    if (!dateKey) return "";
    return parseLocalDateKey(dateKey).toLocaleDateString("id-ID", {
        day: "numeric",
        month: "short",
        year: "numeric"
    });
}

window.logout = () => {
    if (!confirm("Logout dari aplikasi?")) return;

    const finishLogout = () => {
        localStorage.removeItem("currentUser");
        localStorage.removeItem("currentUserUid");
        localStorage.removeItem("currentUserEmail");
        localStorage.removeItem("currentUserType");
        window.location.href = "login.html";
    };

    if (localStorage.getItem("currentUserType") === "google") {
        signOut(auth).finally(finishLogout);
        return;
    }

    finishLogout();
};

window.checkNotificationPermission = () => {
    if (!("Notification" in window)) return;

    const banner = document.getElementById("notif-banner");
    if (!banner) return;

    if (Notification.permission === "default") {
        banner.style.display = "flex";
    } else if (Notification.permission === "granted") {
        banner.style.display = "none";
    }
};

window.requestNotificationPermission = () => {
    if (!("Notification" in window)) return;

    Notification.requestPermission().then((permission) => {
        if (permission !== "granted") return;

        const banner = document.getElementById("notif-banner");
        if (banner) banner.style.display = "none";

        new Notification("Super Planner", {
            body: "Notifikasi diaktifkan! Anda akan diingatkan saat waktu tugas tiba."
        });
    });
};

window.sendNotification = (title, body) => {
    window.stopActiveAlarm();

    let repeatCount = 0;
    const maxRepeat = 3;
    const audio = document.getElementById("notif-sound");
    const stopBtn = document.getElementById("stop-alarm-btn");
    const headerStopBtn = document.getElementById("header-stop-alarm-btn");
    isAlarmActive = true;

    if (stopBtn) stopBtn.style.display = "flex";
    if (headerStopBtn) headerStopBtn.disabled = false;

    function playAlarm() {
        if (!isAlarmActive) return;

        if (audio) {
            audio.currentTime = 0;
            audio.play().catch(() => {});
        }

        if (Notification.permission === "granted") {
            new Notification(title, {
                body,
                requireInteraction: true,
                vibrate: [200, 100, 200]
            });
        }

        alert(`🔔 ${title}\n\n${body}`);
        repeatCount += 1;

        if (repeatCount < maxRepeat && isAlarmActive) {
            const timeoutId = setTimeout(playAlarm, 5000);
            activeAlarmTimeouts.push(timeoutId);
            return;
        }

        window.stopActiveAlarm();
    }

    playAlarm();
};

window.stopActiveAlarm = () => {
    activeAlarmTimeouts.forEach((timeoutId) => clearTimeout(timeoutId));
    activeAlarmTimeouts = [];
    isAlarmActive = false;

    const audio = document.getElementById("notif-sound");
    const stopBtn = document.getElementById("stop-alarm-btn");
    const headerStopBtn = document.getElementById("header-stop-alarm-btn");

    if (audio) {
        audio.pause();
        audio.currentTime = 0;
    }
    if (stopBtn) stopBtn.style.display = "none";
    if (headerStopBtn) headerStopBtn.disabled = true;
};

window.checkReminders = () => {
    const now = new Date();
    const todayKey = getLocalDateKey(now);

    allTasks.forEach((task) => {
        if (!taskOccursOnDate(task, todayKey)) return;
        if (isTaskCompletedForDate(task, todayKey)) return;

        if (task.reminders.length > 0) {
            task.reminders.forEach((reminder, index) => {
                if (!reminder.time) return;

                const shouldNotify = checkReminderCondition(reminder, now, task, todayKey);
                const reminderKey = `${task.id}-${index}-${todayKey}-${reminder.time}`;

                if (shouldNotify && !notifiedTasks.has(reminderKey)) {
                    sendNotification("⏰ Pengingat Tugas!", `${task.text}\nWaktu: ${reminder.time} (${getReminderLabel(reminder.type)})`);
                    notifiedTasks.add(reminderKey);
                }
            });
        }

        if (!task.time) return;

        const taskTime = new Date(`${todayKey}T${task.time}`);
        const diff = taskTime - now;
        const fiveMinutes = 5 * 60 * 1000;
        const notifyKey = `${task.id}-${todayKey}`;

        if (diff >= -fiveMinutes && diff <= fiveMinutes && !notifiedTasks.has(notifyKey)) {
            let message = "";
            if (diff < -60000) {
                message = `⏰ Sudah lewat ${Math.round(Math.abs(diff) / 60000)} menit!\n${task.text}`;
            } else if (diff < 0) {
                message = `⏰ Mulai sekarang!\n${task.text}`;
            } else if (diff < 60000) {
                message = `⏰ Sekarang juga!\n${task.text}`;
            } else {
                message = `⏰ Tinggal ${Math.round(diff / 60000)} menit!\n${task.text}`;
            }

            sendNotification("⏰ Pengingat!", message);
            notifiedTasks.add(notifyKey);
        }

        if (diff < -fiveMinutes) {
            notifiedTasks.delete(notifyKey);
        }
    });
};

function checkReminderCondition(reminder, now, task, todayKey) {
    const currentTime = now.toTimeString().slice(0, 5);
    if (reminder.time !== currentTime) return false;

    switch (reminder.type) {
        case "once":
            return task.date === todayKey;
        case "daily":
            return taskOccursOnDate(task, todayKey);
        case "weekly":
            return taskOccursOnDate(task, todayKey) && reminder.dayOfWeek === now.getDay();
        case "monthly":
            return taskOccursOnDate(task, todayKey) && reminder.dayOfMonth === now.getDate();
        case "custom": {
            if (reminder.untilDelete === false) {
                const lastTrigger = reminder.lastTriggered ? new Date(reminder.lastTriggered) : null;
                if (!lastTrigger) return true;
                return now - lastTrigger >= getCustomIntervalMs(reminder);
            }
            return task.date <= todayKey;
        }
        default:
            return false;
    }
}

function getCustomIntervalMs(reminder) {
    const value = reminder.value || 1;
    const unit = reminder.unit || "days";

    switch (unit) {
        case "hours":
            return value * 60 * 60 * 1000;
        case "days":
            return value * 24 * 60 * 60 * 1000;
        case "weeks":
            return value * 7 * 24 * 60 * 60 * 1000;
        default:
            return value * 24 * 60 * 60 * 1000;
    }
}

function getReminderLabel(type) {
    switch (type) {
        case "once":
            return "Sekali";
        case "daily":
            return "Harian";
        case "weekly":
            return "Mingguan";
        case "monthly":
            return "Bulanan";
        case "custom":
            return "Custom";
        default:
            return type;
    }
}

function setupReminderOptions() {
    const options = document.querySelectorAll(".reminder-option input");
    options.forEach((option) => {
        option.addEventListener("change", (e) => {
            document.querySelectorAll(".reminder-option").forEach((item) => item.classList.remove("active"));
            e.target.parentElement.classList.add("active");

            const customDiv = document.getElementById("custom-reminder-options");
            if (!customDiv) return;
            customDiv.classList.toggle("show", e.target.value === "custom");
        });
    });

    const onceOption = document.getElementById("reminder-once");
    if (onceOption) onceOption.classList.add("active");
}

function setupModalReminderTypeHandler() {
    const modalReminderType = document.getElementById("modal-reminder-type");
    if (!modalReminderType) return;

    modalReminderType.addEventListener("change", (e) => {
        const customOptions = document.getElementById("modal-custom-options");
        if (!customOptions) return;
        customOptions.style.display = e.target.value === "custom" ? "block" : "none";
    });
}

window.addMultipleReminders = () => {
    currentReminderTarget = "new";
    document.getElementById("reminder-modal").style.display = "flex";
};

window.addReminderToTask = () => {
    currentReminderTarget = "edit";
    document.getElementById("reminder-modal").style.display = "flex";
};

window.saveModalReminder = () => {
    const type = document.getElementById("modal-reminder-type").value;
    const time = document.getElementById("modal-reminder-time").value;

    if (!time) {
        alert("Mohon pilih waktu pengingat");
        return;
    }

    const baseDateKey = currentEditTaskId && currentReminderTarget === "edit"
        ? allTasks.find((task) => task.id === currentEditTaskId)?.date || getLocalDateKey(new Date())
        : document.getElementById("task-date").value || getLocalDateKey(new Date());

    const reminder = buildReminder(type, time, baseDateKey);

    if (currentReminderTarget === "edit" && currentEditTaskId) {
        const task = allTasks.find((item) => item.id === currentEditTaskId);
        if (!task) return;

        const reminders = [...task.reminders, reminder];
        update(ref(db, `tasks/${currentEditTaskId}`), { reminders });
        renderEditReminders(reminders);
    } else {
        pendingReminders.push(reminder);
        renderPendingReminders();
    }

    closeReminderModal();
};

function buildReminder(type, time, baseDateKey) {
    const baseDate = parseLocalDateKey(baseDateKey || getLocalDateKey(new Date()));
    const reminder = {
        type,
        time,
        createdAt: Date.now()
    };

    if (type === "custom") {
        reminder.value = parseInt(document.getElementById("modal-custom-value").value, 10) || 1;
        reminder.unit = document.getElementById("modal-custom-unit").value;
        reminder.untilDelete = document.getElementById("modal-until-delete").checked;
    } else if (type === "weekly") {
        reminder.dayOfWeek = baseDate.getDay();
    } else if (type === "monthly") {
        reminder.dayOfMonth = baseDate.getDate();
    }

    return reminder;
}

window.closeReminderModal = () => {
    document.getElementById("reminder-modal").style.display = "none";
    currentReminderTarget = "new";
};

function renderPendingReminders() {
    const container = document.getElementById("multi-reminder-list");
    if (!container) return;

    container.innerHTML = "";
    pendingReminders.forEach((reminder, index) => {
        const el = document.createElement("div");
        el.className = "reminder-item";
        el.innerHTML = `
            <span class="badge-reminder-type">${getReminderLabel(reminder.type)}</span>
            <span><i class="fas fa-clock"></i> ${reminder.time}</span>
            <i class="fas fa-times remove-reminder" onclick="removePendingReminder(${index})"></i>
        `;
        container.appendChild(el);
    });
}

window.removePendingReminder = (index) => {
    pendingReminders.splice(index, 1);
    renderPendingReminders();
};

window.parseNaturalLanguage = () => {
    const input = document.getElementById("task-input").value.toLowerCase();
    const today = new Date();

    if (input.includes("besok")) {
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        document.getElementById("task-date").value = getLocalDateKey(tomorrow);
    } else if (input.includes("lusa")) {
        const dayAfter = new Date(today);
        dayAfter.setDate(dayAfter.getDate() + 2);
        document.getElementById("task-date").value = getLocalDateKey(dayAfter);
    } else {
        document.getElementById("task-date").value = getLocalDateKey(today);
    }

    if (input.includes("prioritas tinggi") || input.includes("urgent")) {
        document.getElementById("task-priority").value = "high";
    } else if (input.includes("prioritas rendah")) {
        document.getElementById("task-priority").value = "low";
    } else {
        document.getElementById("task-priority").value = "med";
    }

    const timeMatch = input.match(/jam\s(\d{1,2})(?::(\d{2}))?/);
    if (timeMatch) {
        const h = timeMatch[1].padStart(2, "0");
        const m = (timeMatch[2] || "00").padStart(2, "0");
        document.getElementById("task-time").value = `${h}:${m}`;
    }
};

function setupDateInputs() {
    const dateInput = document.getElementById("task-date");
    if (dateInput) {
        dateInput.value = getLocalDateKey(new Date());
    }
}

window.toggleRoutineOptions = () => {
    const checkbox = document.getElementById("task-is-routine");
    const options = document.getElementById("routine-options");
    if (!checkbox || !options) return;

    options.classList.toggle("hidden", !checkbox.checked);
};

window.addTask = () => {
    const text = document.getElementById("task-input").value.trim();
    if (!text) {
        alert("Isi tugas dulu!");
        return;
    }

    const date = document.getElementById("task-date").value || getLocalDateKey(new Date());
    const time = document.getElementById("task-time").value || null;
    const reminderType = document.querySelector('input[name="reminder-type"]:checked').value;
    const isRoutine = document.getElementById("task-is-routine").checked;
    const selectedRoutineType = document.getElementById("task-routine-type").value;
    const primaryType = isRoutine ? selectedRoutineType : reminderType;
    let reminders = [];

    if (time) {
        reminders.push(buildReminder(primaryType, time, date));
    }

    reminders = [...reminders, ...pendingReminders];

    const recurrence = isRoutine
        ? selectedRoutineType
        : (["daily", "weekly", "monthly"].includes(reminderType) ? reminderType : inferRecurrenceFromReminders(reminders));
    const baseDate = parseLocalDateKey(date);

    const newTask = {
        text,
        ownerId: currentUserUid,
        ownerName: currentUserId,
        date,
        time,
        priority: document.getElementById("task-priority").value,
        category: document.getElementById("task-category").value,
        tags: document.getElementById("task-tags").value.trim(),
        completed: false,
        completedOccurrences: [],
        pinned: false,
        createdAt: Date.now(),
        notified: false,
        recurrence,
        recurringMeta: {
            dayOfWeek: baseDate.getDay(),
            dateOfMonth: baseDate.getDate()
        },
        reminders,
        subtasks: [],
        collaborators: []
    };

    push(tasksRef, newTask);

    document.getElementById("task-input").value = "";
    document.getElementById("task-tags").value = "";
    document.getElementById("task-time").value = "";
    document.getElementById("task-date").value = getLocalDateKey(new Date());
    document.querySelector('#reminder-once input').checked = true;
    document.querySelectorAll(".reminder-option").forEach((item) => item.classList.remove("active"));
    document.getElementById("reminder-once").classList.add("active");
    document.getElementById("custom-reminder-options").classList.remove("show");
    document.getElementById("task-is-routine").checked = false;
    toggleRoutineOptions();
    pendingReminders = [];
    renderPendingReminders();
};

window.toggleTask = (id, currentStatus, dateKey = getLocalDateKey(new Date())) => {
    const task = allTasks.find((item) => item.id === id);
    if (!task) return;

    const taskPath = ref(db, `tasks/${id}`);

    if (isRecurringTask(task)) {
        const completedOccurrences = new Set(task.completedOccurrences);
        if (currentStatus) {
            completedOccurrences.delete(dateKey);
        } else {
            completedOccurrences.add(dateKey);
        }
        update(taskPath, { completedOccurrences: Array.from(completedOccurrences).sort() });
        return;
    }

    update(taskPath, { completed: !currentStatus });
    if (!currentStatus) {
        notifiedTasks.delete(`${id}-${dateKey}`);
    }
};

window.pinTask = (id, currentPin) => {
    update(ref(db, `tasks/${id}`), { pinned: !currentPin });
};

window.deleteTask = (id) => {
    if (!confirm("Hapus tugas ini?")) return;
    remove(ref(db, `tasks/${id}`));
};

window.openEdit = (id) => {
    const task = allTasks.find((item) => item.id === id);
    if (!task) return;

    currentEditTaskId = id;
    document.getElementById("edit-id").value = id;
    document.getElementById("edit-title").value = task.text;
    document.getElementById("edit-priority").value = task.priority;
    renderEditSubtasks(task.subtasks);
    renderEditReminders(task.reminders);
    document.getElementById("edit-modal").style.display = "flex";
};

function renderEditSubtasks(subtasks) {
    const container = document.getElementById("edit-subtask-list");
    if (!container) return;

    container.innerHTML = "";
    if (!subtasks.length) {
        container.innerHTML = '<div style="color: var(--text-sub); font-size: 0.85rem; padding: 10px;">Belum ada sub-tugas</div>';
        return;
    }

    subtasks.forEach((subtask, index) => {
        const el = document.createElement("div");
        el.className = `subtask-item ${subtask.completed ? "completed" : ""}`;
        el.innerHTML = `
            <div class="subtask-check" onclick="toggleSubtask(${index})">
                ${subtask.completed ? '<i class="fas fa-check"></i>' : ""}
            </div>
            <span style="flex: 1;">${subtask.text}</span>
            <button class="icon-btn delete" onclick="removeSubtask(${index})"><i class="fas fa-times"></i></button>
        `;
        container.appendChild(el);
    });
}

window.addSubtask = () => {
    const input = document.getElementById("new-subtask");
    const text = input.value.trim();
    if (!text || !currentEditTaskId) return;

    const task = allTasks.find((item) => item.id === currentEditTaskId);
    if (!task) return;

    const subtasks = [...task.subtasks, { text, completed: false }];
    update(ref(db, `tasks/${currentEditTaskId}`), { subtasks });
    input.value = "";
    renderEditSubtasks(subtasks);
};

window.toggleSubtask = (index) => {
    const task = allTasks.find((item) => item.id === currentEditTaskId);
    if (!task) return;

    const subtasks = [...task.subtasks];
    subtasks[index].completed = !subtasks[index].completed;
    update(ref(db, `tasks/${currentEditTaskId}`), { subtasks });
    renderEditSubtasks(subtasks);
};

window.removeSubtask = (index) => {
    const task = allTasks.find((item) => item.id === currentEditTaskId);
    if (!task) return;

    const subtasks = [...task.subtasks];
    subtasks.splice(index, 1);
    update(ref(db, `tasks/${currentEditTaskId}`), { subtasks });
    renderEditSubtasks(subtasks);
};

function renderEditReminders(reminders) {
    const container = document.getElementById("edit-reminder-list");
    if (!container) return;

    container.innerHTML = "";
    if (!reminders.length) {
        container.innerHTML = '<div style="color: var(--text-sub); font-size: 0.85rem; padding: 10px;">Belum ada pengingat</div>';
        return;
    }

    reminders.forEach((reminder, index) => {
        const el = document.createElement("div");
        el.className = "reminder-list-item";
        el.innerHTML = `
            <div class="reminder-info">
                <div class="reminder-type">${getReminderLabel(reminder.type)}</div>
                <div class="reminder-time"><i class="fas fa-clock"></i> ${reminder.time}</div>
            </div>
            <button class="icon-btn delete" onclick="removeEditReminder(${index})"><i class="fas fa-trash"></i></button>
        `;
        container.appendChild(el);
    });
}

window.removeEditReminder = (index) => {
    const task = allTasks.find((item) => item.id === currentEditTaskId);
    if (!task) return;

    const reminders = [...task.reminders];
    reminders.splice(index, 1);

    const recurrence = inferRecurrenceFromReminders(reminders);
    update(ref(db, `tasks/${currentEditTaskId}`), { reminders, recurrence });
    renderEditReminders(reminders);
};

window.saveEdit = () => {
    const id = document.getElementById("edit-id").value;
    const newText = document.getElementById("edit-title").value.trim();
    const newPrio = document.getElementById("edit-priority").value;
    if (!newText) {
        alert("Judul tugas tidak boleh kosong");
        return;
    }

    update(ref(db, `tasks/${id}`), { text: newText, priority: newPrio });
    document.getElementById("edit-modal").style.display = "none";
};

window.renderTasks = () => {
    const container = document.getElementById("task-list-container");
    const search = document.getElementById("search-input").value.toLowerCase();
    if (!container) return;

    container.innerHTML = "";

    let filtered = allTasks.filter((task) => {
        const matchesText = task.text.toLowerCase().includes(search);
        return matchesText && !isRecurringTask(task);
    });

    if (currentFilter === "completed") {
        filtered = filtered.filter((task) => task.completed);
    } else {
        filtered = filtered.filter((task) => !task.completed);
        if (currentFilter === "reminder") {
            filtered = filtered.filter((task) => task.reminders.length > 0);
        }
    }

    if (!filtered.length) {
        container.innerHTML = '<div style="text-align:center; padding: 20px; color: var(--text-sub);">Tidak ada tugas ditemukan</div>';
        return;
    }

    filtered.forEach((task) => container.appendChild(createTaskCard(task, { completed: task.completed, occurrenceDate: task.date })));
};

function createTaskCard(task, options = {}) {
    const {
        completed = false,
        occurrenceDate = task.date,
        showOccurrence = false
    } = options;

    const el = document.createElement("div");
    el.className = `task-item p-${task.priority} ${completed ? "completed" : ""} ${task.pinned ? "pinned" : ""}`;

    let reminderBadge = "";
    if (!completed && task.reminders.length > 0) {
        reminderBadge = `<span class="badge badge-reminder"><i class="fas fa-bell"></i> ${task.reminders.length} alarm</span>`;
    }

    let recurrenceBadge = "";
    if (isRecurringTask(task)) {
        const labelMap = { daily: "Harian", weekly: "Mingguan", monthly: "Bulanan" };
        recurrenceBadge = `<span class="badge badge-routine">${labelMap[task.recurrence]}</span>`;
    }

    let subtaskProgress = "";
    if (task.subtasks.length > 0) {
        const completedSubtasks = task.subtasks.filter((item) => item.completed).length;
        subtaskProgress = `<span class="badge" style="background: var(--bg);"><i class="fas fa-tasks"></i> ${completedSubtasks}/${task.subtasks.length}</span>`;
    }

    let collabBadge = "";
    if (task.collaborators.length > 0) {
        collabBadge = `<span class="collab-badge"><i class="fas fa-user-friends"></i> ${task.collaborators.length}</span>`;
    }

    let badges = "";
    if (task.priority === "high") badges += `<span class="badge badge-p-high">High</span>`;
    else if (task.priority === "med") badges += `<span class="badge badge-p-med">Med</span>`;
    else badges += `<span class="badge badge-p-low">Low</span>`;

    badges += `<span class="badge badge-cat">${task.category}</span>`;
    if (task.tags) badges += `<span class="badge" style="background:transparent; border:1px solid var(--border)">${task.tags}</span>`;
    if (recurrenceBadge) badges += recurrenceBadge;
    if (reminderBadge) badges += reminderBadge;
    if (subtaskProgress) badges += subtaskProgress;
    if (collabBadge) badges += collabBadge;

    const dateInfo = showOccurrence ? getCompletionDateLabel(occurrenceDate) : formatDate(task.date);

    el.innerHTML = `
        <div class="task-check" onclick="toggleTask('${task.id}', ${completed}, '${occurrenceDate}')">
            ${completed ? '<i class="fas fa-check"></i>' : ""}
        </div>
        <div class="task-content">
            <div class="task-title">${task.text}</div>
            <div class="task-meta">
                <span><i class="far fa-calendar"></i> ${dateInfo}</span>
                ${task.time ? `<span><i class="far fa-clock"></i> ${task.time}</span>` : ""}
                ${badges}
            </div>
            ${renderSubtasks(task.subtasks, task.id)}
        </div>
        <div class="task-actions">
            <button class="icon-btn" onclick="pinTask('${task.id}', ${task.pinned})"><i class="fas fa-thumbtack"></i></button>
            <button class="icon-btn" onclick="openEdit('${task.id}')"><i class="fas fa-pen"></i></button>
            <button class="icon-btn delete" onclick="deleteTask('${task.id}')"><i class="fas fa-trash"></i></button>
        </div>
    `;

    return el;
}

function renderSubtasks(subtasks, taskId) {
    if (!subtasks.length) return "";

    let html = '<div class="subtask-list">';
    subtasks.forEach((subtask, index) => {
        html += `
            <div class="subtask-item ${subtask.completed ? "completed" : ""}">
                <div class="subtask-check" onclick="toggleTaskSubtask('${taskId}', ${index})">
                    ${subtask.completed ? '<i class="fas fa-check"></i>' : ""}
                </div>
                <span>${subtask.text}</span>
            </div>
        `;
    });
    html += "</div>";
    return html;
}

window.toggleTaskSubtask = (taskId, subtaskIndex) => {
    const task = allTasks.find((item) => item.id === taskId);
    if (!task) return;

    const subtasks = [...task.subtasks];
    subtasks[subtaskIndex].completed = !subtasks[subtaskIndex].completed;
    update(ref(db, `tasks/${taskId}`), { subtasks });
};

window.filterTasks = (filter, button) => {
    currentFilter = filter;
    document.querySelectorAll("#view-tasks .filter-btn").forEach((btn) => btn.classList.remove("active"));
    if (button) button.classList.add("active");
    renderTasks();
};

window.filterRoutineTasks = (filter, button) => {
    currentRoutineFilter = filter;
    document.querySelectorAll("#view-routine .filter-btn").forEach((btn) => btn.classList.remove("active"));
    if (button) button.classList.add("active");
    renderRoutineTasks();
};

window.renderRoutineTasks = () => {
    const activeContainer = document.getElementById("routine-list-container");
    const completedContainer = document.getElementById("routine-completed-container");
    const summary = document.getElementById("routine-summary");
    if (!activeContainer || !completedContainer || !summary) return;

    const todayKey = getLocalDateKey(new Date());
    const filtered = getTodayRecurringTasks().filter((task) => task.recurrence === currentRoutineFilter);
    const activeTasks = filtered.filter((task) => !isTaskCompletedForDate(task, todayKey));
    const completedTasks = filtered.filter((task) => isTaskCompletedForDate(task, todayKey));

    summary.textContent = `${activeTasks.length} aktif • ${completedTasks.length} selesai hari ini`;
    activeContainer.innerHTML = "";
    completedContainer.innerHTML = "";

    if (!activeTasks.length) {
        activeContainer.innerHTML = '<div style="text-align:center; padding: 20px; color: var(--text-sub);">Belum ada tugas rutin aktif untuk hari ini.</div>';
    } else {
        activeTasks.forEach((task) => activeContainer.appendChild(createTaskCard(task, {
            completed: false,
            occurrenceDate: todayKey,
            showOccurrence: true
        })));
    }

    if (!completedTasks.length) {
        completedContainer.innerHTML = '<div style="color: var(--text-sub); font-size: 0.9rem;">Belum ada tugas rutin yang selesai hari ini.</div>';
    } else {
        completedTasks.forEach((task) => completedContainer.appendChild(createTaskCard(task, {
            completed: true,
            occurrenceDate: todayKey,
            showOccurrence: true
        })));
    }
};

function updateAnalytics() {
    const total = allTasks.length;
    const completed = allTasks.reduce((sum, task) => sum + getCompletedCount(task), 0);
    const pending = allTasks.filter((task) => !isRecurringTask(task) && !task.completed).length + getTodayRecurringTasks().filter((task) => !isTaskCompletedForDate(task)).length;
    const rate = total > 0 ? Math.min(100, Math.round((completed / Math.max(total, 1)) * 100)) : 0;

    document.getElementById("analytics-total").textContent = total;
    document.getElementById("analytics-completed").textContent = completed;
    document.getElementById("analytics-pending").textContent = pending;
    document.getElementById("analytics-rate").textContent = `${rate}%`;

    const categories = {};
    allTasks.forEach((task) => {
        categories[task.category] = (categories[task.category] || 0) + 1;
    });

    const categoryChart = document.getElementById("category-chart");
    const maxCat = Math.max(...Object.values(categories), 1);
    categoryChart.innerHTML = "";
    Object.entries(categories).forEach(([cat, count]) => {
        const height = (count / maxCat) * 100;
        categoryChart.innerHTML += `
            <div class="bar" style="height: ${height}%">
                <span class="bar-value">${count}</span>
                <span class="bar-label">${cat}</span>
            </div>
        `;
    });

    const priorities = { high: 0, med: 0, low: 0 };
    allTasks.forEach((task) => {
        if (priorities[task.priority] !== undefined) priorities[task.priority] += 1;
    });

    const priorityChart = document.getElementById("priority-chart");
    const maxPrio = Math.max(...Object.values(priorities), 1);
    priorityChart.innerHTML = "";
    Object.entries(priorities).forEach(([prio, count]) => {
        const height = (count / maxPrio) * 100;
        priorityChart.innerHTML += `
            <div class="bar" style="height: ${height}%; background: ${prio === "high" ? "#EF4444" : prio === "med" ? "#F59E0B" : "#10B981"}">
                <span class="bar-value">${count}</span>
                <span class="bar-label">${prio.toUpperCase()}</span>
            </div>
        `;
    });

    const productivityChart = document.getElementById("productivity-chart");
    const last7Days = [];
    for (let i = 6; i >= 0; i -= 1) {
        const dateObj = new Date();
        dateObj.setDate(dateObj.getDate() - i);
        const dateKey = getLocalDateKey(dateObj);

        const count = allTasks.reduce((sum, task) => {
            if (isRecurringTask(task)) {
                return sum + (task.completedOccurrences.includes(dateKey) ? 1 : 0);
            }
            return sum + (task.completed && task.date === dateKey ? 1 : 0);
        }, 0);

        last7Days.push({
            day: dateObj.toLocaleDateString("id-ID", { weekday: "short" }),
            count
        });
    }

    const maxProd = Math.max(...last7Days.map((item) => item.count), 1);
    productivityChart.innerHTML = "";
    last7Days.forEach((item) => {
        const height = (item.count / maxProd) * 100;
        productivityChart.innerHTML += `
            <div class="bar" style="height: ${Math.max(height, 5)}%">
                <span class="bar-value">${item.count}</span>
                <span class="bar-label">${item.day}</span>
            </div>
        `;
    });
}

function renderWidgets() {
    const todayKey = getLocalDateKey(new Date());
    const todayTasks = allTasks.filter((task) => taskOccursOnDate(task, todayKey) && !isTaskCompletedForDate(task, todayKey)).length;
    document.getElementById("widget-today").textContent = `${todayTasks} tugas`;

    const overdue = allTasks.filter((task) => !isRecurringTask(task) && task.date < todayKey && !task.completed).length;
    document.getElementById("widget-overdue").textContent = `${overdue} tugas`;

    const maxStreak = allHabits.reduce((max, habit) => habit.count > max ? habit.count : max, 0);
    document.getElementById("widget-streak").textContent = `${maxStreak} hari`;

    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - 7);
    const completedThisWeek = allTasks.reduce((sum, task) => {
        if (isRecurringTask(task)) {
            return sum + task.completedOccurrences.filter((dateKey) => dateKey >= getLocalDateKey(weekStart)).length;
        }
        return sum + (task.completed && task.date >= getLocalDateKey(weekStart) ? 1 : 0);
    }, 0);
    document.getElementById("widget-week").textContent = `${completedThisWeek} selesai`;
}

window.exportJSON = () => {
    const data = {
        tasks: allTasks,
        habits: allHabits,
        exportedAt: new Date().toISOString(),
        version: "3.0"
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `super-planner-backup-${getLocalDateKey(new Date())}.json`;
    a.click();
    URL.revokeObjectURL(url);
};

window.exportCSV = () => {
    let csv = "Judul,Prioritas,Kategori,Tags,Tanggal,Waktu,Status,Recurring,Dibuat\n";
    allTasks.forEach((task) => {
        const status = isRecurringTask(task) ? `Selesai ${task.completedOccurrences.length}x` : (task.completed ? "Selesai" : "Aktif");
        csv += `"${task.text}","${task.priority}","${task.category}","${task.tags || ""}","${task.date || ""}","${task.time || ""}","${status}","${task.recurrence || "none"}","${new Date(task.createdAt).toLocaleDateString("id-ID")}"\n`;
    });

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `super-planner-tasks-${getLocalDateKey(new Date())}.csv`;
    a.click();
    URL.revokeObjectURL(url);
};

window.importJSON = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);
            if (Array.isArray(data.tasks)) {
                data.tasks.forEach((task) => {
                    delete task.id;
                    task.ownerId = currentUserUid;
                    task.ownerName = currentUserId;
                    push(tasksRef, task);
                });
            }
            if (Array.isArray(data.habits)) {
                data.habits.forEach((habit) => {
                    delete habit.id;
                    habit.ownerId = currentUserUid;
                    habit.ownerName = currentUserId;
                    push(habitsRef, habit);
                });
            }
            alert("Data berhasil diimport!");
        } catch {
            alert("Error: Format file tidak valid");
        }
    };
    reader.readAsText(file);
};

window.backupToFirebase = () => {
    const backupData = {
        tasks: allTasks,
        habits: allHabits,
        backedUpAt: Date.now()
    };

    set(ref(db, `backups/${sanitizeUserKey(currentUserUid || currentUserId)}`), backupData)
        .then(() => alert("Backup ke cloud berhasil!"))
        .catch((err) => alert(`Backup gagal: ${err.message}`));
};

window.restoreFromFirebase = () => {
    get(ref(db, `backups/${sanitizeUserKey(currentUserUid || currentUserId)}`))
        .then((snapshot) => {
            if (!snapshot.exists()) {
                alert("Tidak ada backup di cloud");
                return;
            }

            const data = snapshot.val();
            if (!confirm("Ini akan menimpa data saat ini. Lanjutkan?")) return;

            allTasks.forEach((task) => remove(ref(db, `tasks/${task.id}`)));
            allHabits.forEach((habit) => remove(ref(db, `habits/${habit.id}`)));

            if (Array.isArray(data.tasks)) {
                data.tasks.forEach((task) => {
                    delete task.id;
                    task.ownerId = currentUserUid;
                    task.ownerName = currentUserId;
                    push(tasksRef, task);
                });
            }

            if (Array.isArray(data.habits)) {
                data.habits.forEach((habit) => {
                    delete habit.id;
                    habit.ownerId = currentUserUid;
                    habit.ownerName = currentUserId;
                    push(habitsRef, habit);
                });
            }

            alert("Restore berhasil!");
        })
        .catch((err) => alert(`Restore gagal: ${err.message}`));
};

window.clearAllData = () => {
    if (!confirm("SEMUA DATA AKAN DIHAPUS! Ini tidak bisa dikembalikan. Lanjutkan?")) return;
    if (!confirm("Yakin 100%? Semua tugas dan habit akan hilang!")) return;

    allTasks.forEach((task) => remove(ref(db, `tasks/${task.id}`)));
    allHabits.forEach((habit) => remove(ref(db, `habits/${habit.id}`)));
    alert("Semua data telah dihapus");
};

window.openCollabModal = () => {
    document.getElementById("collab-modal").style.display = "flex";
};

window.closeCollabModal = () => {
    document.getElementById("collab-modal").style.display = "none";
};

window.inviteCollaborator = () => {
    const email = document.getElementById("collab-email").value;
    if (!email) {
        alert("Masukkan email kolaborator");
        return;
    }

    alert(`Undangan terkirim ke ${email}\n\nNote: Fitur kolaborasi lengkap memerlukan Firebase Cloud Functions.`);
    closeCollabModal();
};

window.generateShareLink = () => {
    const shareData = {
        tasks: allTasks.filter((task) => task.shared).map((task) => ({
            text: task.text,
            priority: task.priority,
            category: task.category,
            date: task.date,
            time: task.time
        }))
    };

    const encoded = btoa(JSON.stringify(shareData));
    const shareUrl = `${window.location.origin}${window.location.pathname}?shared=${encoded}`;

    navigator.clipboard.writeText(shareUrl)
        .then(() => alert("Link berbagi telah disalin ke clipboard!"))
        .catch(() => prompt("Copy link ini:", shareUrl));
};

window.addHabit = () => {
    const name = document.getElementById("habit-input").value.trim();
    if (!name) return;

    push(habitsRef, {
        ownerId: currentUserUid,
        ownerName: currentUserId,
        name,
        count: 0,
        lastDone: null
    });

    document.getElementById("habit-input").value = "";
};

window.checkHabit = (id, currentCount) => {
    update(ref(db, `habits/${id}`), {
        count: currentCount + 1,
        lastDone: new Date().toDateString()
    });
};

window.resetHabit = (id) => {
    if (!confirm("Reset progres habit ini ke 0?")) return;
    update(ref(db, `habits/${id}`), { count: 0, lastDone: null });
};

window.deleteHabit = (id) => {
    if (!confirm("Hapus habit ini? Progres tidak bisa dikembalikan.")) return;
    remove(ref(db, `habits/${id}`));
};

window.renderHabits = () => {
    const container = document.getElementById("habit-list-container");
    if (!container) return;

    container.innerHTML = "";
    allHabits.forEach((habit) => {
        const el = document.createElement("div");
        el.className = "habit-item";
        el.innerHTML = `
            <div>
                <div style="font-weight:600;">${habit.name}</div>
                <div class="habit-streak">Streak: ${habit.count} hari</div>
                <div style="font-size:0.8rem; color:var(--text-sub);">Total: ${habit.count} kali</div>
            </div>
            <div class="habit-actions">
                <button class="habit-btn reset" onclick="resetHabit('${habit.id}')"><i class="fas fa-rotate-left"></i> Reset</button>
                <button class="habit-btn delete" onclick="deleteHabit('${habit.id}')"><i class="fas fa-trash"></i> Hapus</button>
                <button class="icon-btn" style="color:var(--success); font-size:1.5rem;" onclick="checkHabit('${habit.id}', ${habit.count})" title="Tambah progres">
                    <i class="fas fa-plus-circle"></i>
                </button>
            </div>
        `;
        container.appendChild(el);
    });
};

window.changeMonth = (delta) => {
    currentCalDate.setMonth(currentCalDate.getMonth() + delta);
    renderCalendar();
};

window.renderCalendar = () => {
    const grid = document.getElementById("calendar-grid");
    const monthLabel = document.getElementById("cal-month-year");
    if (!grid || !monthLabel) return;

    grid.innerHTML = "";

    const year = currentCalDate.getFullYear();
    const month = currentCalDate.getMonth();
    monthLabel.innerText = new Date(year, month).toLocaleString("id-ID", { month: "long", year: "numeric" });

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    for (let i = 0; i < firstDay; i += 1) {
        grid.innerHTML += "<div></div>";
    }

    if (!selectedCalendarDate) {
        selectedCalendarDate = getLocalDateKey(new Date());
    }

    const todayStr = new Date().toDateString();

    for (let day = 1; day <= daysInMonth; day += 1) {
        const dateKey = getLocalDateKey(new Date(year, month, day));
        const isToday = new Date(year, month, day).toDateString() === todayStr;
        const isSelected = dateKey === selectedCalendarDate;
        const tasksOnDate = allTasks.filter((task) => taskOccursOnDate(task, dateKey));
        const tasksCount = tasksOnDate.length;
        let dots = "";
        for (let dot = 0; dot < Math.min(tasksCount, 4); dot += 1) {
            dots += '<span class="cal-dot"></span>';
        }

        grid.innerHTML += `
            <div class="cal-day ${isToday ? "today" : ""} ${tasksCount > 0 ? "has-tasks" : ""} ${isSelected ? "selected" : ""}" onclick="selectCalendarDate('${dateKey}')">
                <span class="day-num">${day}</span>
                ${tasksCount > 0 ? `<span class="cal-task-count">${tasksCount}</span>` : ""}
                <div class="day-dots">${dots}</div>
            </div>
        `;
    }

    renderCalendarTasks(selectedCalendarDate);
};

window.selectCalendarDate = (dateStr) => {
    selectedCalendarDate = dateStr;
    renderCalendar();
};

function renderCalendarTasks(dateKey) {
    const titleEl = document.getElementById("calendar-task-title");
    const listEl = document.getElementById("calendar-task-list");
    if (!titleEl || !listEl) return;

    if (!dateKey) {
        titleEl.textContent = "Pilih tanggal untuk melihat tugas";
        listEl.innerHTML = '<div class="calendar-task-item">Belum ada tanggal terpilih.</div>';
        return;
    }

    const localDate = parseLocalDateKey(dateKey);
    titleEl.textContent = `Tugas: ${localDate.toLocaleDateString("id-ID", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric"
    })}`;

    const tasksOnDate = allTasks
        .filter((task) => taskOccursOnDate(task, dateKey))
        .sort((a, b) => (a.time || "99:99").localeCompare(b.time || "99:99"));

    if (!tasksOnDate.length) {
        listEl.innerHTML = '<div class="calendar-task-item">Tidak ada tugas di tanggal ini.</div>';
        return;
    }

    listEl.innerHTML = tasksOnDate.map((task) => {
        const completed = isTaskCompletedForDate(task, dateKey);
        const recurrenceLabel = isRecurringTask(task) ? ` • ${getReminderLabel(task.recurrence)}` : "";
        return `
            <div class="calendar-task-item">
                <strong>${task.text}</strong>
                <small>${task.time ? `Jam ${task.time}` : "Tanpa jam"} • ${completed ? "Selesai" : "Belum selesai"} • ${task.category || "Tanpa kategori"}${recurrenceLabel}</small>
            </div>
        `;
    }).join("");
};

window.startPomodoro = () => {
    document.getElementById("pomodoro-modal").style.display = "flex";
};

window.closePomodoro = () => {
    document.getElementById("pomodoro-modal").style.display = "none";
    resetTimer();
};

window.toggleTimer = () => {
    const btn = document.getElementById("timer-btn");
    if (isTimerRunning) {
        clearInterval(timerInterval);
        btn.innerText = "Lanjut";
        isTimerRunning = false;
        return;
    }

    timerInterval = setInterval(() => {
        timeLeft -= 1;
        updateTimerDisplay();
        if (timeLeft <= 0) {
            clearInterval(timerInterval);
            sendNotification("⏰ Pomodoro Selesai!", "Waktunya istirahat sejenak.");
            resetTimer();
        }
    }, 1000);

    btn.innerText = "Pause";
    isTimerRunning = true;
};

window.resetTimer = () => {
    clearInterval(timerInterval);
    timeLeft = 25 * 60;
    isTimerRunning = false;
    document.getElementById("timer-btn").innerText = "Mulai";
    updateTimerDisplay();
};

function updateTimerDisplay() {
    const timerEl = document.getElementById("timer");
    if (!timerEl) return;

    const minutes = String(Math.floor(timeLeft / 60)).padStart(2, "0");
    const seconds = String(timeLeft % 60).padStart(2, "0");
    timerEl.innerText = `${minutes}:${seconds}`;
}

window.updateStats = () => {
    const completed = allTasks.reduce((sum, task) => sum + getCompletedCount(task), 0);
    document.getElementById("stat-total").innerText = completed;

    const maxStreak = allHabits.reduce((max, habit) => habit.count > max ? habit.count : max, 0);
    document.getElementById("stat-streak").innerText = maxStreak;
};

window.shareProgress = () => {
    const completed = allTasks.reduce((sum, task) => sum + getCompletedCount(task), 0);
    const total = allTasks.length;
    const pending = allTasks.filter((task) => !isRecurringTask(task) && !task.completed).length +
        getTodayRecurringTasks().filter((task) => !isTaskCompletedForDate(task)).length;

    const text = `📊 *Laporan Produktivitas Super Planner*\n\n` +
        `✅ Selesai: ${completed}\n` +
        `🗂️ Total tugas: ${total}\n` +
        `⏳ Tertunda saat ini: ${pending}\n` +
        `🔥 Habit Streak: ${allHabits.reduce((sum, habit) => sum + habit.count, 0)}\n\n` +
        `#SuperPlanner`;

    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
};

window.switchTab = (tabName, button) => {
    document.querySelectorAll(".view-section").forEach((el) => el.classList.remove("active"));
    document.querySelectorAll(".nav-btn").forEach((el) => el.classList.remove("active"));

    const targetView = document.getElementById(`view-${tabName}`);
    if (targetView) targetView.classList.add("active");
    if (button) button.classList.add("active");

    if (tabName === "analytics") updateAnalytics();
    if (tabName === "calendar") renderCalendar();
    if (tabName === "routine") renderRoutineTasks();
};

window.toggleTheme = () => {
    const body = document.body;
    const isDark = body.getAttribute("data-theme") === "dark";
    body.setAttribute("data-theme", isDark ? "light" : "dark");
    localStorage.setItem("theme", isDark ? "light" : "dark");
};

function checkTheme() {
    const saved = localStorage.getItem("theme");
    if (saved) {
        document.body.setAttribute("data-theme", saved);
    } else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
        document.body.setAttribute("data-theme", "dark");
    }
}

function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker.register("sw.js")
        .then((registration) => {
            askPermission(registration);
        })
        .catch((error) => {
            console.log("Service Worker registration failed:", error);
        });
}

function askPermission(registration) {
    if (!("Notification" in window)) return;

    Notification.requestPermission().then((permission) => {
        if (permission === "granted") {
            subscribeUserToPush(registration);
        }
    });
}

function subscribeUserToPush(registration) {
    registration.pushManager.getSubscription()
        .then((existingSubscription) => {
            if (existingSubscription) return existingSubscription;

            return registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(WEB_PUSH_PUBLIC_KEY)
            });
        })
        .then((subscription) => {
            console.log("User is subscribed:", subscription);
        })
        .catch((err) => {
            console.log("Failed to subscribe the user:", err);
        });
}

function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const rawData = atob(base64);
    return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

function formatDate(dateStr) {
    if (!dateStr) return "";
    const date = parseLocalDateKey(dateStr);
    return date.toLocaleDateString("id-ID", { day: "numeric", month: "short" });
}

function getLocalDateKey(dateObj) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, "0");
    const d = String(dateObj.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

function parseLocalDateKey(dateStr) {
    if (!dateStr) return new Date();
    const [y, m, d] = dateStr.split("-").map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
}
