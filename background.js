// Background service worker with proper error handling
// Background service worker with proper error handling
class BackgroundTimer {
  constructor() {
    this.currentTimer = null;
    this.isRunning = false;
    this.isBreak = false;
    this.timeLeft = 25 * 60;
    this.sessionCount = 0;
    this.settings = null;
    this.init();
  }

  async init() {
    await this.loadSettings();
    await this.restoreTimerState();
    this.setupMessageListeners();
    this.setupAlarms();

    console.log('Background timer initialized');
  }

  async loadSettings() {
    const data = await chrome.storage.local.get(['settings']);
    this.settings = data.settings || {
      workTime: 25,
      breakTime: 5,
      longBreakTime: 15,
      sessionsBeforeLongBreak: 4,
      autoStartBreaks: true,
      autoStartNextSession: false,
      focusProtection: true
    };
  }

  async restoreTimerState() {
    try {
      const data = await chrome.storage.local.get(['timerState']);
      if (data.timerState) {
        this.timeLeft = data.timerState.timeLeft || this.settings.workTime * 60;
        this.isRunning = data.timerState.isRunning || false;
        this.isBreak = data.timerState.isBreak || false;
        this.sessionCount = data.timerState.sessionCount || 0;
        this.endTime = data.timerState.endTime || null;

        // Validate and correct timer state
        if (this.timeLeft < 0) this.timeLeft = this.settings.workTime * 60;
        if (this.isRunning) {
          // Verify if expired while closed
          if (this.endTime && Date.now() > this.endTime) {
            this.timeLeft = 0;
            this.completeSession();
          } else {
            this.startBackgroundTimer();
          }
        }
      }
    } catch (error) {
      console.log('Error restoring timer state:', error);
    }
  }

  async saveTimerState() {
    try {
      await chrome.storage.local.set({
        timerState: {
          timeLeft: this.timeLeft,
          isRunning: this.isRunning,
          isBreak: this.isBreak,
          sessionCount: this.sessionCount,
          endTime: this.endTime,
          lastUpdated: Date.now()
        }
      });
    } catch (error) {
      console.log('Error saving timer state:', error);
    }
  }

  setupMessageListeners() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      // console.log('Background received:', request.type, 'from:', sender.id);

      // Handle different message types
      switch (request.type) {
        case 'startTimer':
          this.startTimer();
          sendResponse({ success: true });
          break;

        case 'startBreak':
          this.startBreak(request.breakTime);
          sendResponse({ success: true });
          break;

        case 'pauseTimer':
          this.pauseTimer();
          sendResponse({ success: true });
          break;

        case 'resetTimer':
          this.resetTimer();
          sendResponse({ success: true });
          break;

        case 'getTimerState':
          sendResponse(this.getTimerState());
          break;

        case 'updateSettings':
          if (request.settings) {
            this.settings = request.settings;
            chrome.storage.local.set({ settings: this.settings });

            // If timer isn't running, reset to new work time
            if (!this.isRunning) {
              this.timeLeft = this.settings.workTime * 60;
              this.broadcastTimerStateSafe();
            }
          }
          sendResponse({ success: true });
          break;

        case 'playAudio':
        // Audio removed
          sendResponse({ success: true });
          break;

        default:
          sendResponse({ success: false, error: 'Unknown message type' });
      }

      return true; // Keep message channel open for async responses
    });
  }

  setupAlarms() {
    // Daily streak check - runs every 60 minutes
    chrome.alarms.create('dailyStreakCheck', { periodInMinutes: 60 });

    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === 'dailyStreakCheck') {
        this.checkAndUpdateStreak();
      }
    });
  }

  startTimer() {
    console.log('Starting focus timer');
    this.isRunning = true;
    this.isBreak = false;
    this.enableFocusProtection();
    // Audio removed

    const now = Date.now();
    this.endTime = now + (this.settings.workTime * 60 * 1000);

    this.startBackgroundTimer();
    this.saveTimerState();
    this.broadcastTimerStateSafe();
  }

  startBreak(breakTime) {
    console.log('Starting break timer with', breakTime, 'minutes');
    this.isRunning = true;
    this.isBreak = true;
    this.timeLeft = breakTime * 60;

    this.disableFocusProtection();
    // Audio removed

    const now = Date.now();
    this.endTime = now + (breakTime * 60 * 1000);

    this.startBackgroundTimer();
    this.saveTimerState();
    this.broadcastTimerStateSafe();
  }

  pauseTimer() {
    console.log('Pausing timer');
    this.isRunning = false;
    this.disableFocusProtection();
    this.saveTimerState();
    this.broadcastTimerStateSafe();
  }

  resetTimer() {
    console.log('Resetting timer');
    this.isRunning = false;
    this.isBreak = false;
    this.timeLeft = this.settings.workTime * 60;
    this.disableFocusProtection();
    this.saveTimerState();
    this.broadcastTimerStateSafe();
  }

  startBackgroundTimer() {
    // Clear existing timer
    if (this.currentTimer) {
      clearInterval(this.currentTimer);
      this.currentTimer = null;
    }

    // Start new timer
    this.currentTimer = setInterval(() => {
      if (this.isRunning && this.endTime) {
        const now = Date.now();
        const remaining = Math.ceil((this.endTime - now) / 1000);
        this.timeLeft = remaining > 0 ? remaining : 0;

        this.saveTimerState();

        // Only broadcast if popup might be open
        this.broadcastTimerStateSafe();

        if (this.timeLeft <= 0) {
          this.completeSession();
        }
      } else {
        // Stop timer if not running
        if (this.currentTimer) {
          clearInterval(this.currentTimer);
          this.currentTimer = null;
        }
      }
    }, 1000);
  }

  async completeSession() {
    console.log('Session completed');
    this.isRunning = false;
    // Audio removed

    // Calculate actual session duration (in minutes)
    const sessionDuration = this.isBreak
      ? (this.isBreak ? (this.timeLeft + this.getSessionDuration()) / 60 : this.settings.breakTime)
      : this.settings.workTime;

    let updatedStats = null;
    if (!this.isBreak) {
      this.sessionCount++;
      updatedStats = await this.recordFocusTime(sessionDuration);
      this.disableFocusProtection(); // Break starting or session ended
    }

    // Show notification
    this.showNotification(
      this.isBreak ? '⏰ Break Complete!' : '🎉 Focus Session Complete!',
      this.isBreak ? 'Break time is over!' : 'Great work! Time for a break.'
    );

    // Broadcast completion (UI handles points/awards)
    this.broadcastSessionCompleteSafe(sessionDuration, updatedStats);

    // Auto-Advance Logic
    if (!this.isBreak) {
      // Work session ended. Check if we should auto-start break.
      if (this.settings.autoStartBreaks) {
        const breakTime = (this.sessionCount % this.settings.sessionsBeforeLongBreak === 0 && this.sessionCount > 0)
          ? this.settings.longBreakTime
          : this.settings.breakTime;
        this.startBreak(breakTime);
      } else {
        // Just save state as stopped
        this.saveTimerState();
        this.broadcastTimerStateSafe();
      }
    } else {
      // Break session ended. Check if we should auto-start work.
      if (this.settings.autoStartNextSession) {
        this.startTimer();
      } else {
        // Just save state as stopped
        this.saveTimerState();
        this.broadcastTimerStateSafe();
      }
    }
  }

  getSessionDuration() {
    return this.isBreak ? this.settings.breakTime : this.settings.workTime;
  }

  // SAFE broadcasting methods that don't throw errors
  broadcastTimerStateSafe() {
    const state = this.getTimerState();
    chrome.runtime.sendMessage({
      type: 'timerUpdate',
      ...state
    }).catch(() => {
      // This is NORMAL - popup is closed, no one to receive the message
    });
  }

  broadcastSessionCompleteSafe(duration, stats) {
    chrome.runtime.sendMessage({
      type: 'sessionComplete',
      duration: duration,
      isBreak: this.isBreak,
      sessionCount: this.sessionCount,
      stats: stats
    }).catch(() => {
      // Normal - popup is closed
    });
  }

  getTimerState() {
    return {
      timeLeft: this.timeLeft,
      isRunning: this.isRunning,
      isBreak: this.isBreak,
      sessionCount: this.sessionCount,
      settings: this.settings
    };
  }

  async saveTimerState() {
    try {
      await chrome.storage.local.set({
        timerState: {
          timeLeft: this.timeLeft,
          isRunning: this.isRunning,
          isBreak: this.isBreak,
          sessionCount: this.sessionCount,
          lastUpdated: Date.now()
        }
      });
    } catch (error) {
      console.log('Error saving timer state:', error);
    }
  }

  async recordFocusTime(minutes) {
    try {
      const data = await chrome.storage.local.get(['stats']);
      const stats = data.stats || {
        focusTime: {},
        streak: 0,
        completedSessions: 0,
        lastActiveDate: new Date().toDateString()
      };

      const today = new Date().toDateString();
      stats.focusTime[today] = (stats.focusTime[today] || 0) + minutes;
      stats.completedSessions = (stats.completedSessions || 0) + 1;

      await chrome.storage.local.set({ stats: stats });
      return stats; // Return updated stats
    } catch (error) {
      console.log('Error recording focus time:', error);
      return null;
    }
  }

  showNotification(title, message) {
    // Check if we have permission
    if (!chrome.notifications) {
      console.log('Notifications API not available');
      return;
    }

    chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon48.png'),
      title: title,
      message: message,
      priority: 1
    }, (notificationId) => {
      if (chrome.runtime.lastError) {
        console.log('Notification error:', chrome.runtime.lastError);
      }
    });
  }

  async checkAndUpdateStreak() {
    try {
      const data = await chrome.storage.local.get(['stats']);
      const stats = data.stats || {};
      const today = new Date().toDateString();

      if (stats.lastActiveDate !== today) {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);

        if (stats.lastActiveDate === yesterday.toDateString()) {
          stats.streak = (stats.streak || 0) + 1;
        } else if (stats.lastActiveDate && stats.lastActiveDate !== today) {
          stats.streak = 1;
        } else {
          stats.streak = stats.streak || 0;
        }

        stats.lastActiveDate = today;
        await chrome.storage.local.set({ stats: stats });
      }
    } catch (error) {
      console.log('Error updating streak:', error);
    }
  }

  // --- Focus Protection (Site Blocking) ---
  async enableFocusProtection() {
    if (this.settings && this.settings.focusProtection === false) return;

    try {
      await chrome.declarativeNetRequest.updateEnabledRulesets({
        enableRulesetIds: ['ruleset_1']
      });
      console.log('Focus Protection ENABLED');
    } catch (e) {
      console.log('Error enabling blocking rules:', e);
    }
  }

  async disableFocusProtection() {
    try {
      await chrome.declarativeNetRequest.updateEnabledRulesets({
        disableRulesetIds: ['ruleset_1']
      });
      console.log('Focus Protection DISABLED');
    } catch (e) {
      console.log('Error disabling blocking rules:', e);
    }
  }

  // --- Audio Logic Removed ---
  async playAudio(type) {
    // Audio feature removed
    return;
  }

  async createOffscreen() {
    // Audio removed
    return;
  }
}

// Initialize when extension loads
chrome.runtime.onInstalled.addListener((details) => {
  console.log('ProductiFlow installed/updated - initializing background timer');

  // Initialize default data
  chrome.storage.local.get(['settings'], (data) => {
    if (!data.settings) {
      chrome.storage.local.set({
        settings: {
          workTime: 25,
          breakTime: 5,
          longBreakTime: 15,
          sessionsBeforeLongBreak: 4,
          dailyGoal: 240
        },
        stats: {
          focusTime: {},
          streak: 0,
          completedSessions: 0,
          lastActiveDate: new Date().toDateString()
        },
        tasks: []
      });
    }
  });
});

// Start background timer manager
const backgroundTimer = new BackgroundTimer();