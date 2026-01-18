class OptionsPage {
  constructor() {
    this.settings = {};
    this.profile = {};
    this.init();
  }

  async init() {
    await this.loadData();
    this.bindEvents();
    this.renderUI();
    this.setupTheme();
  }

  async loadData() {
    const data = await chrome.storage.local.get(['settings', 'profile', 'stats']);
    
    // Defaults
    this.settings = data.settings || {
      workTime: 25,
      breakTime: 5,
      longBreakTime: 15,
      sessionsBeforeLongBreak: 4,
      autoStartBreaks: true,
      autoStartNextSession: false,
      focusProtection: true,
      sound: true,
      theme: 'rose',
      dailyGoal: 240
    };

    this.profile = data.profile || {
      name: ''
    };

    this.stats = data.stats || {
      focusTime: {},
      streak: 0
    };
  }

  bindEvents() {
    // Navigation
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tab = e.currentTarget.dataset.tab;
        this.switchTab(tab);
      });
    });

    // Inputs - Settings
    const bindInput = (id, key, type = 'value') => {
      const el = document.getElementById(id);
      if(!el) return;
      
      if (type === 'checkbox') {
        el.checked = this.settings[key];
        el.addEventListener('change', (e) => this.saveSetting(key, e.target.checked));
      } else {
        el.value = this.settings[key];
        el.addEventListener('change', (e) => this.saveSetting(key, parseInt(e.target.value) || el.value));
      }
    };

    bindInput('workTime', 'workTime');
    bindInput('breakTime', 'breakTime');
    bindInput('longBreakTime', 'longBreakTime');
    bindInput('sessionsBeforeLongBreak', 'sessionsBeforeLongBreak');
    // bindInput('dailyGoal', 'dailyGoal'); // Handled manually below

    // Daily Goal Manual Binding
    const goalH = document.getElementById('dailyGoalHours');
    const goalM = document.getElementById('dailyGoalMinutes');
    
    if (goalH && goalM) {
        // Load initial values
        const total = this.settings.dailyGoal || 240;
        goalH.value = Math.floor(total / 60);
        goalM.value = total % 60;

        const saveGoal = () => {
            const h = parseInt(goalH.value) || 0;
            const m = parseInt(goalM.value) || 0;
            const minutes = (h * 60) + m;
            this.saveSetting('dailyGoal', minutes);
            
            // Update display logic if needed (e.g., stats view)
             const goalHours = Math.floor(minutes / 60);
             const goalMins = minutes % 60;
             document.getElementById('dailyGoalDisplay').textContent = `${goalHours}h ${goalMins > 0 ? goalMins + 'm' : ''}`;
        };

        goalH.addEventListener('change', saveGoal);
        goalM.addEventListener('change', saveGoal);
    }
    
    bindInput('autoStartBreaks', 'autoStartBreaks', 'checkbox');
    bindInput('autoStartNextSession', 'autoStartNextSession', 'checkbox');
    bindInput('sound', 'sound', 'checkbox');
    bindInput('focusProtection', 'focusProtection', 'checkbox');

    // Profile Input
    const nameInput = document.getElementById('userName');
    nameInput.value = this.profile.name || '';
    nameInput.addEventListener('change', (e) => {
        this.profile.name = e.target.value;
        this.saveProfile();
        this.updateAvatar();
    });

    // Theme Selection
    document.querySelectorAll('.theme-option').forEach(opt => {
        opt.addEventListener('click', (e) => {
            const theme = e.currentTarget.dataset.theme;
            this.saveSetting('theme', theme);
            this.applyTheme(theme);
        });
    });
  }

  switchTab(tabId) {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));

    document.querySelector(`[data-tab="${tabId}"]`).classList.add('active');
    document.getElementById(tabId).classList.add('active');
  }

  async saveSetting(key, value) {
    this.settings[key] = value;
    await chrome.storage.local.set({ settings: this.settings });
    
    // Notify background to update if needed
    chrome.runtime.sendMessage({ type: 'updateSettings', settings: this.settings }).catch(() => {});
  }

  async saveProfile() {
      await chrome.storage.local.set({ profile: this.profile });
  }

  renderUI() {
      // Render Stats
      const totalMinutes = Object.values(this.stats.focusTime || {}).reduce((a,b) => a+b, 0);
      const hours = Math.floor(totalMinutes / 60);
      
      document.getElementById('totalFocusTime').textContent = `${hours}h`;
      document.getElementById('currentStreak').textContent = this.stats.streak || 0;
      
      const goalHours = Math.floor((this.settings.dailyGoal || 240) / 60);
      document.getElementById('dailyGoalDisplay').textContent = `${goalHours}h`;

      this.updateAvatar();
  }

  updateAvatar() {
      const name = this.profile.name || 'User';
      const initials = name.substring(0, 2).toUpperCase();
      document.getElementById('avatarInitials').textContent = initials;
  }

  // updateLevel removed

  setupTheme() {
      this.applyTheme(this.settings.theme || 'rose');
      
      // Select the active theme in UI
      const activeTheme = this.settings.theme || 'rose';
      document.querySelectorAll('.theme-option').forEach(opt => {
          if(opt.dataset.theme === activeTheme) {
              opt.classList.add('active');
          } else {
              opt.classList.remove('active');
          }
      });
  }

  applyTheme(theme) {
      document.body.className = ''; // Reset
      if(theme !== 'rose') {
          document.body.classList.add(`theme-${theme}`);
      }
      
      // Update Selection UI
       document.querySelectorAll('.theme-option').forEach(opt => {
          if(opt.dataset.theme === theme) {
              opt.classList.add('active');
          } else {
              opt.classList.remove('active');
          }
      });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new OptionsPage();
});
