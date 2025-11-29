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
      sessionsBeforeLongBreak: 4
    };
  }

  async restoreTimerState() {
    try {
      const data = await chrome.storage.local.get(['timerState']);
      if (data.timerState) {
        this.timeLeft = data.timerState.timeLeft;
        this.isRunning = data.timerState.isRunning;
        this.isBreak = data.timerState.isBreak;
        this.sessionCount = data.timerState.sessionCount || 0;

        // Validate and correct timer state
        if (this.timeLeft < 0) this.timeLeft = this.settings.workTime * 60;
        if (this.isRunning) {
          this.startBackgroundTimer();
        }
      }
    } catch (error) {
      console.log('Error restoring timer state:', error);
    }
  }

  setupMessageListeners() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      console.log('Background received:', request.type, 'from:', sender);

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
          }
          sendResponse({ success: true });
          break;

        default:
          sendResponse({ success: false, error: 'Unknown message type' });
      }

      return true; // Keep message channel open for async responses
    });
  }

  setupAlarms() {
    // Daily streak check
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
    this.timeLeft = this.settings.workTime * 60;
    this.startBackgroundTimer();
    this.saveTimerState();
    this.broadcastTimerStateSafe(); // FIXED: Changed from broadcastTimerState
  }

  startBreak(breakTime) {
    console.log('Starting break timer');
    this.isRunning = true;
    this.isBreak = true;
    this.timeLeft = breakTime * 60;
    this.startBackgroundTimer();
    this.saveTimerState();
    this.broadcastTimerStateSafe(); // FIXED: Changed from broadcastTimerState
  }

  pauseTimer() {
    console.log('Pausing timer');
    this.isRunning = false;
    this.saveTimerState();
    this.broadcastTimerStateSafe(); // FIXED: Changed from broadcastTimerState
  }

  resetTimer() {
    console.log('Resetting timer');
    this.isRunning = false;
    this.isBreak = false;
    this.timeLeft = this.settings.workTime * 60;
    this.saveTimerState();
    this.broadcastTimerStateSafe(); // FIXED: Changed from broadcastTimerState
  }

  startBackgroundTimer() {
    // Clear existing timer
    if (this.currentTimer) {
      clearInterval(this.currentTimer);
      this.currentTimer = null;
    }

    // Start new timer
    this.currentTimer = setInterval(() => {
      if (this.isRunning) {
        this.timeLeft--;
        this.saveTimerState();

        // Only broadcast if popup might be open (reduce errors)
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

  completeSession() {
    console.log('Session completed');
    this.isRunning = false;
    const sessionDuration = this.isBreak ? this.settings.breakTime : this.settings.workTime;

    if (!this.isBreak) {
      this.sessionCount++;
      this.recordFocusTime(sessionDuration);
    }

    this.saveTimerState();
    this.broadcastTimerStateSafe();

    // Show notification (this always works)
    this.showNotification(
      this.isBreak ? '⏰ Break Complete!' : '🎉 Focus Session Complete!',
      this.isBreak ? 'Break time is over!' : 'Great work! Time for a break.'
    );

    // Broadcast completion safely
    this.broadcastSessionCompleteSafe(sessionDuration);
  }

  // SAFE broadcasting methods that don't throw errors
  broadcastTimerStateSafe() {
    const state = this.getTimerState();
    chrome.runtime.sendMessage({
      type: 'timerUpdate',
      ...state
    }).catch(() => {
      // This is NORMAL - popup is closed, no one to receive the message
      // We don't log this to avoid console spam
    });
  }

  broadcastSessionCompleteSafe(duration) {
    chrome.runtime.sendMessage({
      type: 'sessionComplete',
      duration: duration,
      isBreak: this.isBreak
    }).catch(() => {
      // Normal - popup is closed
    });
  }

  getTimerState() {
    return {
      timeLeft: this.timeLeft,
      isRunning: this.isRunning,
      isBreak: this.isBreak,
      sessionCount: this.sessionCount
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
        points: 0,
        completedTasks: 0,
        completedSessions: 0
      };

      const today = new Date().toDateString();
      stats.focusTime[today] = (stats.focusTime[today] || 0) + minutes;

      await chrome.storage.local.set({ stats: stats });
    } catch (error) {
      console.log('Error recording focus time:', error);
    }
  }

  showNotification(title, message) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: title,
      message: message,
      priority: 1
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
}

// Initialize when extension loads
chrome.runtime.onInstalled.addListener(() => {
  console.log('ProductiFlow installed - initializing background timer');

  // Initialize default data
  chrome.storage.local.get(['settings'], (data) => {
    if (!data.settings) {
      chrome.storage.local.set({
        settings: {
          workTime: 25,
          breakTime: 5,
          longBreakTime: 15,
          sessionsBeforeLongBreak: 4
        },
        stats: {
          focusTime: {},
          streak: 0,
          points: 0,
          completedTasks: 0,
          completedSessions: 0,
          lastActiveDate: new Date().toDateString()
        },
        tasks: [],
        achievements: [
          { id: 'first_session', name: 'First Step', description: 'Complete your first focus session', icon: '🎯', unlocked: false, points: 10 },
          { id: 'task_master', name: 'Task Master', description: 'Complete 10 tasks', icon: '✅', unlocked: false, points: 25 },
          { id: 'marathon', name: 'Marathon', description: 'Focus for 10 hours total', icon: '🏃', unlocked: false, points: 50 },
          { id: 'streak_7', name: 'Weekly Warrior', description: '7-day streak', icon: '🔥', unlocked: false, points: 100 },
          { id: 'perfectionist', name: 'Perfectionist', description: 'Complete all tasks for a day', icon: '⭐', unlocked: false, points: 75 }
        ]
      });
    }
  });
});

// Start background timer manager
const backgroundTimer = new BackgroundTimer();