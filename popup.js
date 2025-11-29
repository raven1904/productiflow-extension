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
    this.updateTimerDisplay();

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
        this.sessionCount = response.sessionCount;
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

  setupBackgroundListener() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.type === 'timerUpdate') {
        this.timeLeft = request.timeLeft;
        this.isRunning = request.isRunning;
        this.isBreak = request.isBreak;
        this.sessionCount = request.sessionCount;
        this.updateTimerDisplay();
      }

      if (request.type === 'sessionComplete') {
        this.handleSessionComplete(request.duration, request.isBreak);
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
        sessionsBeforeLongBreak: 4
      };

      this.tasks = data.tasks || [];
      this.stats = data.stats || {
        focusTime: {},
        streak: 0,
        points: 0,
        completedTasks: 0,
        completedSessions: 0
      };

      this.achievements = data.achievements || this.getDefaultAchievements();
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
      sessionsBeforeLongBreak: 4
    };
    this.tasks = [];
    this.stats = {
      focusTime: {},
      streak: 0,
      points: 0,
      completedTasks: 0,
      completedSessions: 0
    };
    this.achievements = this.getDefaultAchievements();
    this.timeLeft = this.settings.workTime * 60;
  }

  getDefaultAchievements() {
    return [
      { id: 'first_session', name: 'First Step', description: 'Complete your first focus session', icon: '🎯', unlocked: false, points: 10 },
      { id: 'task_master', name: 'Task Master', description: 'Complete 10 tasks', icon: '✅', unlocked: false, points: 25 },
      { id: 'marathon', name: 'Marathon', description: 'Focus for 10 hours total', icon: '🏃', unlocked: false, points: 50 },
      { id: 'streak_7', name: 'Weekly Warrior', description: '7-day streak', icon: '🔥', unlocked: false, points: 100 },
      { id: 'perfectionist', name: 'Perfectionist', description: 'Complete all tasks for a day', icon: '⭐', unlocked: false, points: 75 }
    ];
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
      this.updateSetting('workTime', parseInt(e.target.value));
    });
    document.getElementById('breakTime').addEventListener('change', (e) => {
      this.updateSetting('breakTime', parseInt(e.target.value));
    });

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

  async startTimer() {
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
    this.isRunning = true;
    this.isBreak = true;
    const breakTime = this.sessionCount % this.settings.sessionsBeforeLongBreak === 0
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
          this.handleSessionComplete(
            this.isBreak ? this.settings.breakTime : this.settings.workTime,
            this.isBreak
          );
          this.isRunning = false;
          if (this.currentTimer) {
            clearInterval(this.currentTimer);
          }
        }
      }
    }, 1000);
  }

  async pauseTimer() {
    this.isRunning = false;
    try {
      await this.sendToBackground({ type: 'pauseTimer' });
    } catch (error) {
      // Ignore - we already updated local state
    }
    this.updateTimerDisplay();
  }

  async resetTimer() {
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

  handleSessionComplete(duration, wasBreak) {
    if (!wasBreak) {
      this.sessionCount++;
      this.recordFocusTime(duration);
      this.awardPoints(5);
      this.showCustomNotification(
        '🎉 Focus Session Complete!',
        'Great job! Take a break when you are ready.',
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
    this.checkAchievements();
    this.saveData();
  }

  updateTimerDisplay() {
    const minutes = Math.floor(this.timeLeft / 60);
    const seconds = this.timeLeft % 60;

    document.getElementById('minutes').textContent = minutes.toString().padStart(2, '0');
    document.getElementById('seconds').textContent = seconds.toString().padStart(2, '0');
    document.getElementById('sessionCount').textContent = this.sessionCount;

    // Update session type
    const timerDisplay = document.querySelector('.timer-display');
    const sessionInfo = document.getElementById('sessionType');

    if (this.isBreak) {
      timerDisplay.className = 'timer-display break-mode';
      sessionInfo.textContent = 'Break Time 🍃';
    } else {
      timerDisplay.className = 'timer-display work-mode';
      sessionInfo.textContent = 'Focus Time 🎯';
    }

    this.updateButtonStates();
  }

  updateButtonStates() {
    const startBtn = document.getElementById('startTimer');
    const breakBtn = document.getElementById('startBreak');

    if (this.isBreak) {
      startBtn.disabled = true;
      startBtn.style.opacity = '0.6';
      breakBtn.disabled = false;
      breakBtn.style.opacity = '1';
    } else {
      startBtn.disabled = false;
      startBtn.style.opacity = '1';
      breakBtn.disabled = true;
      breakBtn.style.opacity = '0.6';
    }
  }

  recordFocusTime(minutes) {
    const today = new Date().toDateString();
    this.stats.focusTime[today] = (this.stats.focusTime[today] || 0) + minutes;
    this.updateStreak();
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
    const dueDate = document.getElementById('dueDate').value;

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
      document.getElementById('dueDate').value = '';
      input.focus();

      this.showCustomNotification('📝 Task Added!', 'New task created successfully!', 'success');
    }
  }

  toggleTask(taskId) {
    const task = this.tasks.find(t => t.id === taskId);
    if (task) {
      task.completed = !task.completed;

      if (task.completed) {
        this.stats.completedTasks++;
        const pointsEarned = this.getTaskPoints(task.priority);
        this.awardPoints(pointsEarned);
        this.checkAchievements();
        this.showCustomNotification('✅ Task Completed!', `You earned ${pointsEarned} points!`, 'success');
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
      taskList.innerHTML = `
        <div class="empty-state">
          <p>No tasks found</p>
          <small>${filter === 'completed' ? 'Complete some tasks to see them here!' : 'Add a task to get started!'}</small>
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
    const weekFocus = this.getWeeklyFocus();

    document.getElementById('focusToday').textContent = this.formatTime(todayFocus);
    document.getElementById('todayFocus').textContent = this.formatTime(todayFocus);
    document.getElementById('weekFocus').textContent = this.formatTime(weekFocus);
    document.getElementById('streak').textContent = `🔥 ${this.stats.streak || 0}`;
    document.getElementById('points').textContent = `⭐ ${this.stats.points || 0}`;

    const productivityScore = Math.min(100, Math.round((this.stats.completedTasks / Math.max(this.tasks.length, 1)) * 100));
    document.getElementById('productivityScore').textContent = `${productivityScore}%`;
  }

  getWeeklyFocus() {
    const today = new Date();
    let total = 0;
    for (let i = 0; i < 7; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() - i);
      total += this.stats.focusTime[date.toDateString()] || 0;
    }
    return total;
  }

  formatTime(minutes) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
  }

  updateAnalytics() {
    this.updateStats();
    this.renderAchievements();
  }

  renderAchievements() {
    const list = document.getElementById('achievementsList');
    list.innerHTML = this.achievements.map(achievement => `
      <div class="achievement-item ${achievement.unlocked ? '' : 'achievement-locked'}">
        <span class="achievement-icon">${achievement.icon}</span>
        <div>
          <div><strong>${achievement.name}</strong></div>
          <div>${achievement.description}</div>
          <div><small>${achievement.points} points</small></div>
        </div>
      </div>
    `).join('');
  }

  awardPoints(points) {
    this.stats.points = (this.stats.points || 0) + points;
    this.updateStats();
    this.saveData();
  }

  checkAchievements() {
    const today = new Date().toDateString();
    const todayTasks = this.tasks.filter(task =>
      new Date(task.createdAt).toDateString() === today
    );
    const completedToday = todayTasks.filter(task => task.completed);

    if (this.sessionCount > 0 && !this.achievements[0].unlocked) {
      this.unlockAchievement('first_session');
    }
    if (this.stats.completedTasks >= 10 && !this.achievements[1].unlocked) {
      this.unlockAchievement('task_master');
    }
    const totalFocus = Object.values(this.stats.focusTime).reduce((a, b) => a + b, 0);
    if (totalFocus >= 600 && !this.achievements[2].unlocked) {
      this.unlockAchievement('marathon');
    }
    if (this.stats.streak >= 7 && !this.achievements[3].unlocked) {
      this.unlockAchievement('streak_7');
    }
    if (todayTasks.length > 0 && completedToday.length === todayTasks.length && !this.achievements[4].unlocked) {
      this.unlockAchievement('perfectionist');
    }
  }

  unlockAchievement(achievementId) {
    const achievement = this.achievements.find(a => a.id === achievementId);
    if (achievement && !achievement.unlocked) {
      achievement.unlocked = true;
      this.awardPoints(achievement.points);
      this.showCustomNotification(
        '🏆 Achievement Unlocked!',
        `${achievement.name}: ${achievement.description}`,
        'achievement'
      );
      this.saveData();
    }
  }

  updateSetting(key, value) {
    this.settings[key] = value;
    this.saveData();

    // Update background if available
    this.sendToBackground({ type: 'updateSettings', settings: this.settings })
      .catch(() => { }); // Ignore errors

    if (!this.isRunning) {
      this.resetTimer();
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
    return unsafe
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // Enhanced button click handler with animations
  async startTimer() {
    // Add click animation
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
    // Add click animation
    this.animateButton('startBreak');

    this.isRunning = true;
    this.isBreak = true;
    const breakTime = this.sessionCount % this.settings.sessionsBeforeLongBreak === 0
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

  async pauseTimer() {
    // Add click animation
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
    // Add click animation
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

  // New method for button animations
  animateButton(buttonId) {
    const button = document.getElementById(buttonId);
    if (button) {
      button.classList.add('clicked');
      setTimeout(() => {
        button.classList.remove('clicked');
      }, 300);
    }
  }

  // Enhanced task completion with animation
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
        const pointsEarned = this.getTaskPoints(task.priority);
        this.awardPoints(pointsEarned);
        this.checkAchievements();
        this.showCustomNotification('✅ Task Completed!', `You earned ${pointsEarned} points!`, 'success');
      } else {
        this.stats.completedTasks = Math.max(0, this.stats.completedTasks - 1);
      }

      this.saveData();
      this.renderTasks(this.getCurrentFilter());
      this.updateStats();
    }
  }

  // Enhanced tab switching with animation
  switchTab(tabName) {
    const previousTab = document.querySelector('.tab-content.active');
    const previousButton = document.querySelector('.tab-btn.active');

    if (previousTab) {
      previousTab.style.opacity = '0';
      previousTab.style.transform = 'translateX(-10px)';
    }

    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));

    document.getElementById(tabName).classList.add('active');
    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

    const newTab = document.getElementById(tabName);
    const newButton = document.querySelector(`[data-tab="${tabName}"]`);

    // Animate new tab in
    setTimeout(() => {
      newTab.style.opacity = '1';
      newTab.style.transform = 'translateX(0)';

      // Add button animation
      newButton.style.transform = 'scale(0.95)';
      setTimeout(() => {
        newButton.style.transform = '';
      }, 150);
    }, 50);

    if (tabName === 'analytics') {
      this.updateAnalytics();
    }
  }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  window.productiFlow = new ProductiFlow();
});