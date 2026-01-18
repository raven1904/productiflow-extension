// Offscreen script to handle audio playback
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'playAudioOffscreen') {
    playTone(request.sound);
  }
});

const audioContext = new (window.AudioContext || window.webkitAudioContext)();

function playTone(type) {
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }

  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();

  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);

  const now = audioContext.currentTime;

  switch (type) {
    case 'start':
      // Rising chime
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(440, now);
      oscillator.frequency.exponentialRampToValueAtTime(880, now + 0.5);
      gainNode.gain.setValueAtTime(0.5, now);
      gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
      oscillator.start(now);
      oscillator.stop(now + 0.5);
      break;

    case 'break_start':
      // Relaxing descending tone
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(660, now);
      oscillator.frequency.linearRampToValueAtTime(440, now + 1);
      gainNode.gain.setValueAtTime(0.3, now);
      gainNode.gain.exponentialRampToValueAtTime(0.01, now + 1);
      oscillator.start(now);
      oscillator.stop(now + 1);
      break;

    case 'complete':
      // Success fanfare
      playFanfare(now);
      break;

    default:
      break;
  }
}

function playFanfare(startTime) {
    // Simple Arpeggio: C - E - G - C
    const notes = [523.25, 659.25, 783.99, 1046.50];
    const duration = 0.15;

    notes.forEach((freq, index) => {
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        const time = startTime + (index * duration);

        osc.connect(gain);
        gain.connect(audioContext.destination);

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, time);
        
        gain.gain.setValueAtTime(0.3, time);
        gain.gain.exponentialRampToValueAtTime(0.01, time + duration);

        osc.start(time);
        osc.stop(time + duration);
    });
}
