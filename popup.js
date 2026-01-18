class ProductiFlow {
  constructor() {
    this.isRunning = false;
    this.isBreak = false;
    this.timeLeft = 25 * 60;
    this.sessionCount = 0;
    this.settings = null;
    this.tasks = [];
    this.stats = null;
    this.achievements = [];
    this.currentTimer = null;
    this.backgroundAvailable = false;

    this.init();
  }

  async init() {
    await this.loadData();
    this.setupEventListeners();
    this.renderTasks();
    this.updateStats();
    this.updateStats();
    this.updateTimerDisplay();

    // Settings Button removed

    // Apply Theme & Set Active Button
    if (this.settings && this.settings.theme) {
      this.applyTheme(this.settings.theme);
      const activeBtn = document.querySelector(`.theme-btn[data-theme="${this.settings.theme}"]`);
      if (activeBtn) {
        document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
        activeBtn.classList.add('active');
      }
    }

    // Set Greeting
    this.setGreeting();

    // Test background connection and sync state
    await this.testBackgroundConnection();
  }

  async testBackgroundConnection() {
    try {
      const response = await this.sendToBackground({ type: 'getTimerState' });
      if (response) {
        this.backgroundAvailable = true;
        this.timeLeft = response.timeLeft;
        this.isRunning = response.isRunning;
        this.isBreak = response.isBreak;
        this.sessionCount = response.sessionCount || 0;
        this.updateTimerDisplay();
        console.log('Background connection established');
      }
    } catch (error) {
      this.backgroundAvailable = false;
      console.log('Running in standalone mode - background not available');
    }

    // Listen for background updates
    this.setupBackgroundListener();
  }

  setGreeting() {
    const hours = new Date().getHours();
    let greeting = 'Good Morning';

    if (hours >= 12 && hours < 17) {
      greeting = 'Good Afternoon';
    } else if (hours >= 17) {
      greeting = 'Good Evening';
    }

    const greetingEl = document.getElementById('greeting');
    if (greetingEl) {
      greetingEl.textContent = greeting;
    }
  }

  setupBackgroundListener() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.type === 'timerUpdate') {
        this.timeLeft = request.timeLeft;
        this.isRunning = request.isRunning;
        this.isBreak = request.isBreak;
        this.sessionCount = request.sessionCount || 0;
        this.updateTimerDisplay();
      }

      if (request.type === 'sessionComplete') {
        this.handleSessionComplete(request.duration, request.isBreak, request.stats);
      }

      sendResponse({ received: true });
      return true;
    });
  }

  async sendToBackground(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    });
  }

  async loadData() {
    try {
      const data = await chrome.storage.local.get([
        'settings', 'tasks', 'stats', 'achievements'
      ]);

      this.settings = data.settings || {
        workTime: 25,
        breakTime: 5,
        longBreakTime: 15,
        sessionsBeforeLongBreak: 4,
        dailyGoal: 240 // 4 hours in minutes
      };

      this.tasks = data.tasks || [];
      this.stats = data.stats || {
        focusTime: {},
        streak: 0,
        completedTasks: 0,
        completedSessions: 0,
        lastActiveDate: new Date().toDateString()
      };

      this.timeLeft = this.settings.workTime * 60;

    } catch (error) {
      console.log('Error loading data, using defaults');
      this.setDefaultData();
    }
  }

  setDefaultData() {
    this.settings = {
      workTime: 25,
      breakTime: 5,
      longBreakTime: 15,
      sessionsBeforeLongBreak: 4,
      dailyGoal: 240
    };
    this.tasks = [];
    this.stats = {
      focusTime: {},
      streak: 0,
      completedTasks: 0,
      completedSessions: 0,
      lastActiveDate: new Date().toDateString()
    };
    this.timeLeft = this.settings.workTime * 60;
  }

  setupEventListeners() {
    // Tab navigation
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.switchTab(e.target.dataset.tab);
      });
    });

    // Timer controls
    document.getElementById('startTimer').addEventListener('click', () => this.startTimer());
    document.getElementById('startBreak').addEventListener('click', () => this.startBreakTimer());
    document.getElementById('pauseTimer').addEventListener('click', () => this.pauseTimer());
    document.getElementById('resetTimer').addEventListener('click', () => this.resetTimer());

    // Timer settings
    document.getElementById('workTime').addEventListener('change', (e) => {
      const value = parseInt(e.target.value);
      if (value > 0) {
        this.updateSetting('workTime', value);
      }
    });
    document.getElementById('breakTime').addEventListener('change', (e) => {
      const value = parseInt(e.target.value);
      if (value > 0) {
        this.updateSetting('breakTime', value);
      }
    });

    // Advanced Settings
    const setupCheckbox = (id, key) => {
      const el = document.getElementById(id);
      if (el) {
        el.checked = this.settings[key];
        el.addEventListener('change', (e) => {
          this.updateSetting(key, e.target.checked);
        });
      }
    };

    setupCheckbox('autoStartBreaks', 'autoStartBreaks');
    setupCheckbox('autoStartNextSession', 'autoStartNextSession');
    setupCheckbox('focusProtection', 'focusProtection');

    // Goal Edit Listeners
    const editBtn = document.getElementById('editGoalBtn');
    const overlay = document.getElementById('goalEditOverlay');
    const cancelBtn = document.getElementById('cancelGoalEdit');
    const saveBtn = document.getElementById('saveGoalEdit');

    if (editBtn) {
      editBtn.addEventListener('click', () => {
        const currentMinutes = this.settings.dailyGoal || 240;
        const h = Math.floor(currentMinutes / 60);
        const m = currentMinutes % 60;
        document.getElementById('goalHours').value = h;
        document.getElementById('goalMinutes').value = m;
        overlay.classList.remove('hidden');
      });
    }

    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        overlay.classList.add('hidden');
      });
    }

    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        const h = parseInt(document.getElementById('goalHours').value) || 0;
        const m = parseInt(document.getElementById('goalMinutes').value) || 0;
        const total = (h * 60) + m;
        this.updateSetting('dailyGoal', total);
        // Immediately update display
        this.updateStats(); // Use the main function to handle new format
        overlay.classList.add('hidden');
      });
    }

    // Task management
    document.getElementById('addTask').addEventListener('click', () => this.addTask());
    document.getElementById('taskInput').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.addTask();
    });

    // Task filters
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        this.renderTasks(e.target.dataset.filter);
      });
    });

    // Event delegation for tasks
    document.getElementById('taskList').addEventListener('click', (e) => {
      this.handleTaskListClick(e);
    });
    document.getElementById('taskList').addEventListener('change', (e) => {
      this.handleTaskListChange(e);
    });

    // Profile Settings
    const nameInput = document.getElementById('displayName');
    if (nameInput) {
      if (this.profile && this.profile.displayName) nameInput.value = this.profile.displayName;
      nameInput.addEventListener('change', (e) => {
        if (!this.profile) this.profile = {};
        this.profile.displayName = e.target.value;
        this.saveData();
      });
    }

    // Theme Selector
    document.querySelectorAll('.theme-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const theme = e.target.dataset.theme;
        this.applyTheme(theme);
        this.updateSetting('theme', theme);

        // Update active state
        document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
      });
    });
  }

  handleTaskListClick(e) {
    const deleteBtn = e.target.closest('.delete-task-btn');
    if (deleteBtn) {
      const taskId = deleteBtn.dataset.taskId;
      this.deleteTask(taskId);
    }
  }

  handleTaskListChange(e) {
    if (e.target.classList.contains('task-checkbox')) {
      const taskId = e.target.dataset.taskId;
      this.toggleTask(taskId);
    }
  }

  switchTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));

    document.getElementById(tabName).classList.add('active');
    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

    if (tabName === 'analytics') {
      this.updateAnalytics();
    }
  }

  // ====== TIMER METHODS - SINGLE IMPLEMENTATION ======
  async startTimer() {
    this.animateButton('startTimer');

    this.isRunning = true;
    this.isBreak = false;
    this.timeLeft = this.settings.workTime * 60;

    try {
      await this.sendToBackground({ type: 'startTimer' });
    } catch (error) {
      console.log('Background unavailable, using local timer');
      this.startLocalTimer();
    }

    this.updateTimerDisplay();
  }

  async startBreakTimer() {
    this.animateButton('startBreak');

    this.isRunning = true;
    this.isBreak = true;

    // Calculate break type
    const breakTime = (this.sessionCount % this.settings.sessionsBeforeLongBreak === 0 && this.sessionCount > 0)
      ? this.settings.longBreakTime
      : this.settings.breakTime;

    this.timeLeft = breakTime * 60;

    try {
      await this.sendToBackground({
        type: 'startBreak',
        breakTime: breakTime
      });
    } catch (error) {
      console.log('Background unavailable, using local timer');
      this.startLocalTimer();
    }

    this.updateTimerDisplay();
  }

  startLocalTimer() {
    if (this.currentTimer) {
      clearInterval(this.currentTimer);
    }

    this.currentTimer = setInterval(() => {
      if (this.isRunning) {
        this.timeLeft--;
        this.updateTimerDisplay();

        if (this.timeLeft <= 0) {
          const completedMinutes = this.isBreak ?
            (this.isBreak ? this.timeLeft : this.settings.workTime) : this.settings.workTime;
          this.handleSessionComplete(completedMinutes, this.isBreak);
          this.isRunning = false;
          if (this.currentTimer) {
            clearInterval(this.currentTimer);
            this.currentTimer = null;
          }
        }
      }
    }, 1000);
  }

  async pauseTimer() {
    this.animateButton('pauseTimer');

    this.isRunning = false;
    try {
      await this.sendToBackground({ type: 'pauseTimer' });
    } catch (error) {
      // Ignore - we already updated local state
    }
    this.updateTimerDisplay();
  }

  async resetTimer() {
    this.animateButton('resetTimer');

    this.isRunning = false;
    this.isBreak = false;
    this.timeLeft = this.settings.workTime * 60;
    try {
      await this.sendToBackground({ type: 'resetTimer' });
    } catch (error) {
      // Ignore - we already updated local state
    }
    this.updateTimerDisplay();
  }

  handleSessionComplete(duration, wasBreak, stats) {
    if (!wasBreak) {
      this.sessionCount++;
      // Stats are now updated by background and passed here
      if (stats) {
        this.stats = stats;
      } else {
        this.recordFocusTime(duration);
      }
      this.showCustomNotification(
        '🎉 Focus Session Complete!',
        wasBreak ? 'Break time is over!' : 'Great job! Take a break when you are ready.',
        'success'
      );
    } else {
      this.showCustomNotification(
        '⏰ Break Time Over!',
        'Ready to focus again?',
        'info'
      );
    }

    this.updateStats();
    // No need to save data here as background already did it found stats were passed
    if (!stats) {
      this.saveData();
    }
  }

  updateTimerDisplay() {
    const minutes = Math.floor(this.timeLeft / 60);
    const seconds = this.timeLeft % 60;

    document.getElementById('minutes').textContent = minutes.toString().padStart(2, '0');
    document.getElementById('seconds').textContent = seconds.toString().padStart(2, '0');
    // Session Count removed from Pomodoro tab


    // Update session type and styling
    const timerDisplay = document.querySelector('.timer-display');
    const sessionInfo = document.getElementById('sessionType');
    const startBtn = document.getElementById('startTimer');
    const breakBtn = document.getElementById('startBreak');

    if (this.isBreak) {
      timerDisplay.className = 'timer-display break-mode';
      sessionInfo.textContent = this.timeLeft === this.settings.longBreakTime * 60
        ? 'Long Break 🌴'
        : 'Break Time 🍃';
      startBtn.disabled = true;
      breakBtn.disabled = false;
    } else {
      timerDisplay.className = 'timer-display work-mode';
      sessionInfo.textContent = 'Focus Time 🎯';
      startBtn.disabled = false;
      breakBtn.disabled = true;
    }

    // Update button styles
    startBtn.style.opacity = startBtn.disabled ? '0.6' : '1';
    breakBtn.style.opacity = breakBtn.disabled ? '0.6' : '1';
  }

  recordFocusTime(minutes) {
    const today = new Date().toDateString();
    this.stats.focusTime[today] = (this.stats.focusTime[today] || 0) + minutes;
    this.updateStreak();
    this.saveData();
  }

  updateStreak() {
    const today = new Date().toDateString();
    const lastActive = this.stats.lastActiveDate;

    if (lastActive !== today) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      if (lastActive === yesterday.toDateString()) {
        this.stats.streak = (this.stats.streak || 0) + 1;
      } else if (lastActive && lastActive !== today) {
        this.stats.streak = 1;
      } else {
        this.stats.streak = this.stats.streak || 1;
      }

      this.stats.lastActiveDate = today;
    }
  }

  addTask() {
    const input = document.getElementById('taskInput');
    const priority = document.getElementById('prioritySelect').value;
    const dueDateInput = document.getElementById('dueDate');
    const dueDate = dueDateInput.value;

    if (input.value.trim()) {
      const task = {
        id: Date.now().toString(),
        title: input.value.trim(),
        priority: priority,
        dueDate: dueDate ? new Date(dueDate).getTime() : null,
        completed: false,
        createdAt: Date.now()
      };

      this.tasks.unshift(task);
      this.saveData();
      this.renderTasks();

      input.value = '';
      dueDateInput.value = '';
      input.focus();

      this.showCustomNotification('📝 Task Added!', 'New task created successfully!', 'success');
    }
  }

  toggleTask(taskId) {
    const task = this.tasks.find(t => t.id === taskId);
    if (task) {
      const taskElement = document.querySelector(`[data-task-id="${taskId}"]`);

      // Add completion animation
      if (taskElement && !task.completed) {
        taskElement.style.transform = 'scale(0.95)';
        setTimeout(() => {
          taskElement.style.transform = '';
        }, 150);
      }

      task.completed = !task.completed;

      if (task.completed) {
        this.stats.completedTasks++;
        this.showCustomNotification('✅ Task Completed!', 'Great job!', 'success');
      } else {
        this.stats.completedTasks = Math.max(0, this.stats.completedTasks - 1);
      }

      this.saveData();
      this.renderTasks(this.getCurrentFilter());
      this.updateStats();
    }
  }

  getCurrentFilter() {
    const activeFilter = document.querySelector('.filter-btn.active');
    return activeFilter ? activeFilter.dataset.filter : 'all';
  }

  getTaskPoints(priority) {
    const points = { low: 1, medium: 2, high: 3 };
    return points[priority] || 1;
  }

  deleteTask(taskId) {
    const task = this.tasks.find(t => t.id === taskId);
    if (task && task.completed) {
      this.stats.completedTasks = Math.max(0, this.stats.completedTasks - 1);
    }

    this.tasks = this.tasks.filter(t => t.id !== taskId);
    this.saveData();
    this.renderTasks(this.getCurrentFilter());
    this.updateStats();

    this.showCustomNotification('🗑️ Task Deleted!', 'Task removed successfully.', 'info');
  }

  renderTasks(filter = 'all') {
    const taskList = document.getElementById('taskList');
    let filteredTasks = this.tasks;

    if (filter === 'active') {
      filteredTasks = this.tasks.filter(task => !task.completed);
    } else if (filter === 'completed') {
      filteredTasks = this.tasks.filter(task => task.completed);
    }

    if (filteredTasks.length === 0) {
      const message = filter === 'completed'
        ? 'Complete some tasks to see them here!'
        : 'Add a task to get started!';

      taskList.innerHTML = `
        <div class="empty-state" style="text-align: center; padding: 40px; color: #999;">
          <p style="margin-bottom: 8px;">No tasks found</p>
          <small>${message}</small>
        </div>
      `;
      return;
    }

    taskList.innerHTML = filteredTasks.map(task => `
      <div class="task-item ${task.completed ? 'completed' : ''}" data-task-id="${task.id}">
        <input type="checkbox" class="task-checkbox" data-task-id="${task.id}" ${task.completed ? 'checked' : ''}>
        <div class="task-content">
          <div class="task-title">${this.escapeHtml(task.title)}</div>
          <div class="task-meta">
            <span class="priority ${task.priority}">${task.priority.toUpperCase()}</span>
            ${task.dueDate ? `<span class="due-date">${new Date(task.dueDate).toLocaleDateString()}</span>` : ''}
          </div>
        </div>
        <div class="task-actions">
          <button class="delete-task-btn" data-task-id="${task.id}" title="Delete">🗑️</button>
        </div>
      </div>
    `).join('');
  }

  updateStats() {
    const today = new Date().toDateString();
    const todayFocus = this.stats.focusTime[today] || 0;

    // Update simple stats
    const tEl = document.getElementById('todayFocus');
    if (tEl) tEl.textContent = this.formatTime(todayFocus);
    // Removed duplicate IDs from previous steps if any, ensuring safety

    document.getElementById('sessionCountDisplay').textContent = this.stats.completedSessions || 0;
    document.getElementById('streak').textContent = `🔥 ${this.stats.streak || 0} days`;

    // Goal Progress
    const dailyGoal = this.settings.dailyGoal || 240;
    const goalFormatted = this.formatTime(dailyGoal);
    const todayFormatted = this.formatTime(todayFocus);

    document.getElementById('goalProgressDisplay').textContent = `${todayFormatted} / ${goalFormatted}`;
    document.getElementById('dailyGoalTarget').textContent = goalFormatted;

    // Render Weekly Chart
    this.renderWeeklyChart();
  }

  renderWeeklyChart() {
    const today = new Date();
    const currentDay = today.getDay(); // 0 (Sun) to 6 (Sat)
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - currentDay); // Go back to Sunday

    const weeklyData = [];
    let maxVal = 60; // Min scale: 1 hour

    for (let i = 0; i < 7; i++) {
      const d = new Date(startOfWeek);
      d.setDate(startOfWeek.getDate() + i);
      const val = this.stats.focusTime[d.toDateString()] || 0;
      weeklyData.push(val);
      if (val > maxVal) maxVal = val;
    }

    weeklyData.forEach((val, index) => {
      const bar = document.getElementById(`bar-${index}`);
      if (bar) {
        const heightIdx = (val / maxVal) * 100; // Percentage
        const height = Math.min(100, Math.max(5, heightIdx));
        bar.style.height = `${height}%`;
        bar.title = `${this.formatTime(val)}`;
      }
    });
  }

  formatTime(minutes) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
  }

  updateAnalytics() {
    this.updateStats();
    // Achievements removed
  }

  // Points and Achievements methods removed

  updateSetting(key, value) {
    this.settings[key] = value;

    // Update UI inputs
    if (key === 'workTime') {
      document.getElementById('workTime').value = value;
    } else if (key === 'breakTime') {
      document.getElementById('breakTime').value = value;
  }

    this.saveData();

    // Update background if available
    this.sendToBackground({ type: 'updateSettings', settings: this.settings })
      .catch(() => { }); // Ignore errors

    if (!this.isRunning) {
      this.timeLeft = this.settings.workTime * 60;
      this.updateTimerDisplay();
    }
  }

  async saveData() {
    try {
      await chrome.storage.local.set({
        settings: this.settings,
        tasks: this.tasks,
        stats: this.stats,
        achievements: this.achievements
      });
    } catch (error) {
      console.log('Error saving data:', error);
    }
  }

  showCustomNotification(title, message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `custom-notification notification-${type}`;

    const icons = { success: '🎉', info: '💡', achievement: '🏆' };

    notification.innerHTML = `
      <div class="notification-icon">${icons[type] || '💡'}</div>
      <div class="notification-content">
        <div class="notification-title">${title}</div>
        <div class="notification-message">${message}</div>
      </div>
      <button class="notification-close">×</button>
    `;

    document.body.appendChild(notification);

    setTimeout(() => notification.classList.add('show'), 100);
    setTimeout(() => this.removeNotification(notification), 5000);

    notification.querySelector('.notification-close').addEventListener('click', () => {
      this.removeNotification(notification);
    });
  }

  removeNotification(notification) {
    notification.classList.remove('show');
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 300);
  }

  escapeHtml(unsafe) {
    if (!unsafe) return '';
    return unsafe
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  animateButton(buttonId) {
    const button = document.getElementById(buttonId);
    if (button) {
      button.classList.add('clicked');
      setTimeout(() => {
        button.classList.remove('clicked');
      }, 300);
    }
  }

  applyTheme(theme) {
    document.body.className = '';
    if (theme && theme !== 'rose') {
      document.body.classList.add(`theme-${theme}`);
    }
  }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  window.productiFlow = new ProductiFlow();
});