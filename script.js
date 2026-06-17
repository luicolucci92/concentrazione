(function () {
  "use strict";

  const STORAGE_KEY = "focusTimerSettings";
  const TIMER_STATE_KEY = "focusTimerRuntime";
  const DEFAULT_DURATION = 2 * 60;

  const els = {
    timeDisplay: document.getElementById("timeDisplay"),
    subDisplay: document.getElementById("subDisplay"),
    statusText: document.getElementById("statusText"),
    quickGrid: document.getElementById("quickGrid"),
    quickButtons: Array.from(document.querySelectorAll(".quick-btn")),
    minutesInput: document.getElementById("minutesInput"),
    secondsInput: document.getElementById("secondsInput"),
    soundSelect: document.getElementById("soundSelect"),
    volumeSlider: document.getElementById("volumeSlider"),
    volumeValue: document.getElementById("volumeValue"),
    testSoundBtn: document.getElementById("testSoundBtn"),
    notifyBtn: document.getElementById("notifyBtn"),
    notifyStatus: document.getElementById("notifyStatus"),
    startBtn: document.getElementById("startBtn"),
    pauseBtn: document.getElementById("pauseBtn"),
    resetBtn: document.getElementById("resetBtn"),
    alarmOverlay: document.getElementById("alarmOverlay"),
    okBtn: document.getElementById("okBtn"),
    finishBtn: document.getElementById("finishBtn")
  };

  let audioContext = null;
  let alarmNodes = [];
  let alarmInterval = null;
  let tickInterval = null;
  let deadlineTimeout = null;
  let selectedDuration = DEFAULT_DURATION;
  let remainingWhenPaused = DEFAULT_DURATION;
  let endTime = null;
  let isRunning = false;
  let isAlarmOpen = false;
  let notificationAsked = false;

  const soundPatterns = {
    bell: [
      { frequency: 784, start: 0, duration: 0.42, type: "sine", gain: 0.72 },
      { frequency: 988, start: 0.16, duration: 0.54, type: "sine", gain: 0.58 },
      { frequency: 659, start: 0.38, duration: 0.7, type: "triangle", gain: 0.46 }
    ],
    chime: [
      { frequency: 523, start: 0, duration: 0.24, type: "sine", gain: 0.62 },
      { frequency: 659, start: 0.18, duration: 0.24, type: "sine", gain: 0.72 },
      { frequency: 1046, start: 0.36, duration: 0.48, type: "sine", gain: 0.52 }
    ],
    pulse: [
      { frequency: 440, start: 0, duration: 0.2, type: "square", gain: 0.45 },
      { frequency: 440, start: 0.28, duration: 0.2, type: "square", gain: 0.45 },
      { frequency: 440, start: 0.56, duration: 0.2, type: "square", gain: 0.45 }
    ],
    beep: [
      { frequency: 880, start: 0, duration: 0.3, type: "sine", gain: 0.72 },
      { frequency: 880, start: 0.38, duration: 0.3, type: "sine", gain: 0.72 }
    ]
  };

  function clampNumber(value, min, max) {
    const numeric = Number.parseInt(value, 10);
    if (Number.isNaN(numeric)) return min;
    return Math.min(Math.max(numeric, min), max);
  }

  function formatTime(totalSeconds) {
    const safeSeconds = Math.max(0, Math.ceil(totalSeconds));
    const minutes = Math.floor(safeSeconds / 60);
    const seconds = safeSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function getManualDuration() {
    const minutes = clampNumber(els.minutesInput.value, 0, 999);
    const seconds = clampNumber(els.secondsInput.value, 0, 59);
    return Math.max(1, minutes * 60 + seconds);
  }

  function setManualInputs(totalSeconds) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    els.minutesInput.value = String(minutes);
    els.secondsInput.value = String(seconds);
  }

  function saveSettings() {
    const settings = {
      duration: selectedDuration,
      sound: els.soundSelect.value,
      volume: getVolume()
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }

  function saveTimerState(extraState) {
    const state = Object.assign({
      duration: selectedDuration,
      endTime,
      isRunning,
      isAlarmOpen,
      remaining: Math.max(0, Math.ceil(getRemainingFromClock())),
      updatedAt: Date.now()
    }, extraState || {});
    localStorage.setItem(TIMER_STATE_KEY, JSON.stringify(state));
  }

  function clearTimerState() {
    localStorage.removeItem(TIMER_STATE_KEY);
  }

  function loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      selectedDuration = DEFAULT_DURATION;
      if (saved.sound && soundPatterns[saved.sound]) {
        els.soundSelect.value = saved.sound;
      }
      if (Number.isFinite(saved.volume)) {
        els.volumeSlider.value = String(Math.round(Math.min(Math.max(saved.volume, 0.2), 1) * 100));
      }
    } catch (error) {
      selectedDuration = DEFAULT_DURATION;
    }
    remainingWhenPaused = selectedDuration;
    setManualInputs(selectedDuration);
    updateVolumeLabel();
    updateNotificationStatus();
  }

  function updateControlState() {
    els.startBtn.disabled = isRunning || isAlarmOpen;
    els.pauseBtn.disabled = !isRunning;
    els.resetBtn.disabled = !isRunning && !isAlarmOpen;
    els.quickButtons.forEach((button) => {
      button.disabled = isRunning || isAlarmOpen;
    });
    els.minutesInput.disabled = isRunning || isAlarmOpen;
    els.secondsInput.disabled = isRunning || isAlarmOpen;
  }

  function restoreTimerState() {
    let state = null;
    try {
      state = JSON.parse(localStorage.getItem(TIMER_STATE_KEY) || "null");
    } catch (error) {
      state = null;
    }

    if (!state || !Number.isFinite(state.duration) || state.duration <= 0) {
      return false;
    }

    selectedDuration = Math.round(state.duration);
    setManualInputs(selectedDuration);

    if (state.isRunning && Number.isFinite(state.endTime)) {
      const remaining = Math.max(0, (state.endTime - Date.now()) / 1000);
      endTime = state.endTime;
      remainingWhenPaused = Math.max(1, Math.ceil(remaining));

      if (remaining > 0) {
        isRunning = true;
        stopTicker();
        tickInterval = window.setInterval(tick, 250);
        scheduleDeadlineCheck();
        updateDisplay(remaining);
        els.subDisplay.textContent = `Ripreso: ${formatTime(remaining)}`;
        setStatus("Attivo");
        saveTimerState();
        updateControlState();
        return true;
      }

      completeTimer();
      return true;
    }

    if (state.isAlarmOpen) {
      remainingWhenPaused = selectedDuration;
      updateDisplay(0);
      els.subDisplay.textContent = "Tempo scaduto";
      setStatus("Scaduto");
      showAlarm();
      saveTimerState({ isRunning: false, endTime: null, remaining: 0, isAlarmOpen: true });
      updateControlState();
      return true;
    }

    clearTimerState();
    return false;
  }

  function updateQuickSelection() {
    els.quickButtons.forEach((button) => {
      const seconds = Number(button.dataset.minutes) * 60;
      button.classList.toggle("active", seconds === selectedDuration);
    });
  }

  function updateDisplay(remainingSeconds) {
    els.timeDisplay.textContent = formatTime(remainingSeconds);
    updateQuickSelection();
  }

  function setStatus(text) {
    els.statusText.textContent = text;
  }

  function syncDurationFromInputs() {
    selectedDuration = getManualDuration();
    remainingWhenPaused = selectedDuration;
    isRunning = false;
    endTime = null;
    stopTicker();
    saveSettings();
    clearTimerState();
    updateDisplay(remainingWhenPaused);
    els.subDisplay.textContent = `Intervallo impostato: ${formatTime(selectedDuration)}`;
    setStatus("Pronto");
    updateControlState();
  }

  function getRemainingFromClock() {
    if (!endTime) return remainingWhenPaused;
    return Math.max(0, (endTime - Date.now()) / 1000);
  }

  function stopTicker() {
    window.clearInterval(tickInterval);
    window.clearTimeout(deadlineTimeout);
    tickInterval = null;
    deadlineTimeout = null;
  }

  function scheduleDeadlineCheck() {
    window.clearTimeout(deadlineTimeout);
    if (!isRunning || !endTime) return;
    const delay = Math.max(0, Math.min(endTime - Date.now() + 80, 2147483647));
    deadlineTimeout = window.setTimeout(tick, delay);
  }

  function tick() {
    const remaining = getRemainingFromClock();
    updateDisplay(remaining);
    if (remaining <= 0) {
      completeTimer();
    }
  }

  function ensureAudio() {
    if (!audioContext) {
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (AudioCtor) {
        audioContext = new AudioCtor();
      }
    }
    if (audioContext && audioContext.state === "suspended") {
      audioContext.resume();
    }
  }

  function getVolume() {
    return clampNumber(els.volumeSlider.value, 20, 100) / 100;
  }

  function updateVolumeLabel() {
    els.volumeValue.textContent = `${Math.round(getVolume() * 100)}%`;
  }

  function updateNotificationStatus() {
    if (!("Notification" in window)) {
      els.notifyStatus.textContent = "Questo browser non supporta gli avvisi di sistema.";
      els.notifyBtn.disabled = true;
      return;
    }
    if (Notification.permission === "granted") {
      els.notifyStatus.textContent = "Avvisi attivi: quando il timer scade in background vedrai una notifica.";
      els.notifyBtn.textContent = "Avvisi attivi";
      els.notifyBtn.disabled = true;
      return;
    }
    if (Notification.permission === "denied") {
      els.notifyStatus.textContent = "Avvisi bloccati: riattivali dalle impostazioni del browser/sito.";
      els.notifyBtn.textContent = "Avvisi bloccati";
      els.notifyBtn.disabled = true;
      return;
    }
    els.notifyStatus.textContent = "Per vedere un avviso fuori dalla pagina, abilita le notifiche.";
    els.notifyBtn.textContent = "Abilita avvisi in background";
    els.notifyBtn.disabled = false;
  }

  function requestNotificationAccess(forcePrompt) {
    if (!("Notification" in window) || (!forcePrompt && notificationAsked) || Notification.permission !== "default") {
      updateNotificationStatus();
      return;
    }
    notificationAsked = true;
    Notification.requestPermission()
      .then(updateNotificationStatus)
      .catch(updateNotificationStatus);
  }

  function showSystemNotification() {
    if (!("Notification" in window) || Notification.permission !== "granted") {
      return;
    }
    try {
      const notification = new Notification("Tempo scaduto", {
        body: "Tocca qui e premi OK per ripartire.",
        tag: "focus-timer-finished",
        renotify: true
      });
      notification.onclick = () => {
        window.focus();
        notification.close();
      };
    } catch (error) {
      // Some mobile browsers expose Notification but restrict direct page usage.
    }
  }

  function stopAlarmSound() {
    window.clearInterval(alarmInterval);
    alarmInterval = null;
    alarmNodes.forEach((node) => {
      try {
        node.stop();
      } catch (error) {
        // The oscillator may already be stopped.
      }
    });
    alarmNodes = [];
  }

  function playPattern() {
    ensureAudio();
    if (!audioContext) return;

    const now = audioContext.currentTime;
    const pattern = soundPatterns[els.soundSelect.value] || soundPatterns.bell;
    const volume = getVolume();

    pattern.forEach((note) => {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const start = now + note.start;
      const end = start + note.duration;

      oscillator.type = note.type;
      oscillator.frequency.setValueAtTime(note.frequency, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(Math.min(note.gain * volume, 0.95), start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);

      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start(start);
      oscillator.stop(end + 0.03);
      alarmNodes.push(oscillator);
    });
  }

  function startAlarmSound() {
    stopAlarmSound();
    playPattern();
    alarmInterval = window.setInterval(playPattern, 1100);
  }

  function showAlarm() {
    isAlarmOpen = true;
    els.alarmOverlay.hidden = false;
    document.title = "Tempo scaduto - Timer concentrazione";
    els.okBtn.focus({ preventScroll: true });
    showSystemNotification();
    if (navigator.vibrate) {
      navigator.vibrate([250, 120, 250, 120, 450]);
    }
    startAlarmSound();
    saveTimerState({ isRunning: false, endTime: null, remaining: 0, isAlarmOpen: true });
    updateControlState();
  }

  function hideAlarm() {
    isAlarmOpen = false;
    els.alarmOverlay.hidden = true;
    document.title = "Timer concentrazione";
    stopAlarmSound();
    saveTimerState({ isAlarmOpen: false });
    updateControlState();
  }

  function startTimer(durationSeconds, preserveInterval) {
    if (isRunning || isAlarmOpen) return;
    ensureAudio();
    requestNotificationAccess();
    const countdownDuration = Math.max(1, Math.round(durationSeconds || getManualDuration()));
    if (!preserveInterval) {
      selectedDuration = countdownDuration;
      setManualInputs(selectedDuration);
    }
    remainingWhenPaused = countdownDuration;
    endTime = Date.now() + countdownDuration * 1000;
    isRunning = true;
    stopTicker();
    tickInterval = window.setInterval(tick, 250);
    scheduleDeadlineCheck();
    saveSettings();
    saveTimerState();
    updateDisplay(countdownDuration);
    els.subDisplay.textContent = `In corso: ${formatTime(countdownDuration)}`;
    setStatus("Attivo");
    updateControlState();
    tick();
  }

  function pauseTimer() {
    if (!isRunning) return;
    remainingWhenPaused = Math.max(1, Math.ceil(getRemainingFromClock()));
    isRunning = false;
    endTime = null;
    stopTicker();
    clearTimerState();
    updateDisplay(remainingWhenPaused);
    els.subDisplay.textContent = `Fermato: ${formatTime(remainingWhenPaused)}`;
    setStatus("Stop");
    updateControlState();
  }

  function resetTimer() {
    hideAlarm();
    isRunning = false;
    endTime = null;
    remainingWhenPaused = selectedDuration;
    stopTicker();
    clearTimerState();
    updateDisplay(selectedDuration);
    els.subDisplay.textContent = "Timer reimpostato";
    setStatus("Pronto");
    updateControlState();
  }

  function completeTimer() {
    isRunning = false;
    endTime = null;
    remainingWhenPaused = selectedDuration;
    stopTicker();
    saveTimerState({ isRunning: false, endTime: null, remaining: 0, isAlarmOpen: true });
    updateDisplay(0);
    els.subDisplay.textContent = "Tempo scaduto";
    setStatus("Scaduto");
    if (!isAlarmOpen) {
      showAlarm();
    }
    updateControlState();
  }

  els.quickGrid.addEventListener("click", (event) => {
    const button = event.target.closest(".quick-btn");
    if (!button) return;
    selectedDuration = Number(button.dataset.minutes) * 60;
    remainingWhenPaused = selectedDuration;
    isRunning = false;
    endTime = null;
    stopTicker();
    setManualInputs(selectedDuration);
    saveSettings();
    clearTimerState();
    updateDisplay(selectedDuration);
    els.subDisplay.textContent = `Intervallo impostato: ${button.dataset.minutes} min`;
    setStatus("Pronto");
    updateControlState();
  });

  [els.minutesInput, els.secondsInput].forEach((input) => {
    input.addEventListener("change", syncDurationFromInputs);
    input.addEventListener("input", () => {
      if (!isRunning) {
        syncDurationFromInputs();
      }
    });
  });

  els.soundSelect.addEventListener("change", saveSettings);
  els.volumeSlider.addEventListener("input", () => {
    updateVolumeLabel();
    saveSettings();
  });
  els.testSoundBtn.addEventListener("click", () => {
    ensureAudio();
    playPattern();
  });
  els.notifyBtn.addEventListener("click", () => requestNotificationAccess(true));

  els.startBtn.addEventListener("click", () => {
    const durationToStart = remainingWhenPaused > 0 && remainingWhenPaused < selectedDuration
      ? remainingWhenPaused
      : getManualDuration();
    startTimer(durationToStart, durationToStart < selectedDuration);
  });

  els.pauseBtn.addEventListener("click", pauseTimer);
  els.resetBtn.addEventListener("click", resetTimer);

  els.okBtn.addEventListener("click", () => {
    hideAlarm();
    startTimer(selectedDuration);
  });

  els.finishBtn.addEventListener("click", () => {
    hideAlarm();
    resetTimer();
    els.subDisplay.textContent = "Ripetizione interrotta";
  });

  document.addEventListener("visibilitychange", () => {
    if (isRunning) {
      saveTimerState();
      tick();
      scheduleDeadlineCheck();
    }
  });

  window.addEventListener("focus", () => {
    if (isRunning) {
      saveTimerState();
      tick();
      scheduleDeadlineCheck();
    }
  });

  window.addEventListener("pageshow", () => {
    if (isRunning) {
      saveTimerState();
      tick();
      scheduleDeadlineCheck();
    }
  });

  loadSettings();
  if (!restoreTimerState()) {
    updateDisplay(selectedDuration);
    clearTimerState();
    updateControlState();
  }
})();
