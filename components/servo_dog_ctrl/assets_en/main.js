/*
SPDX-FileCopyrightText: 2025 Espressif Systems (Shanghai) CO LTD
SPDX-License-Identifier: Apache-2.0
*/

const ACTION_NAMES = {
  '1': 'Lie down', '2': 'Bow', '3': 'Lean back', '4': 'Wiggle',
  '5': 'Rock', '6': 'Sway', '7': 'Shake', '8': 'Poke',
  '9': 'Kick', '10': 'Jump fwd', '11': 'Jump back', '12': 'Retract',
  'F': 'Forward', 'B': 'Backward', 'L': 'Turn left', 'R': 'Turn right'
};

const DISTANCE_THRESHOLD = 0.2;
const SEND_INTERVAL = 500;
const STATUS_POLL_MS = 1500;

/* ---------- toasts ---------- */
function toast(message, type = 'info') {
  const stack = document.getElementById('toast-stack');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  stack.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

async function sendRequest(endpoint, data = null) {
  const options = {
    method: data ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' }
  };
  if (data) options.body = JSON.stringify(data);

  const response = await fetch(endpoint, options);
  if (!response.ok) {
    let message = 'Connection error';
    try {
      const errorData = await response.json();
      if (errorData.error === 'Control disabled in calibration mode') {
        message = 'Control is disabled while calibrating';
      }
    } catch (_) { /* ignore parse failure, use default message */ }
    throw new Error(message);
  }
  return response.json();
}

/* ---------- live status pill ---------- */
class StatusPoller {
  constructor() {
    this.pill = document.getElementById('status-pill');
    this.led = document.getElementById('status-led');
    this.text = document.getElementById('status-text');
    this.wasOffline = false;
    this.poll();
    setInterval(() => this.poll(), STATUS_POLL_MS);
  }

  async poll() {
    try {
      const data = await sendRequest('/status');
      const busy = data.name && data.name !== 'DOG_STATE_IDLE';
      this.pill.dataset.state = busy ? 'busy' : 'online';
      this.text.textContent = (data.name || 'IDLE').replace('DOG_STATE_', '');
      if (this.wasOffline) {
        toast('Connected to ESP-Hi', 'success');
        this.wasOffline = false;
      }
    } catch (err) {
      this.pill.dataset.state = 'offline';
      this.text.textContent = 'OFFLINE';
      this.wasOffline = true;
    }
  }
}

/* ---------- tabs ---------- */
class Tabs {
  constructor() {
    this.tabs = Array.from(document.querySelectorAll('.tab'));
    this.indicator = document.getElementById('tab-indicator');
    this.tabs.forEach((tab, i) => {
      tab.addEventListener('click', () => this.activate(tab, i));
    });
    requestAnimationFrame(() => this.moveIndicator(this.tabs.findIndex(t => t.classList.contains('active'))));
    window.addEventListener('resize', () => this.moveIndicator(this.tabs.findIndex(t => t.classList.contains('active'))));
  }

  activate(tab, index) {
    this.tabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    document.getElementById(`panel-${tab.dataset.tab}`).classList.add('active');
    this.moveIndicator(index);
  }

  moveIndicator(index) {
    const tab = this.tabs[index];
    if (!tab) return;
    this.indicator.style.transform = `translateX(${tab.offsetLeft - 4}px)`;
  }
}

/* ---------- control panel ---------- */
class ControlPanel {
  constructor() {
    this.deck = document.getElementById('action-deck');
    this.joystickZone = document.getElementById('joystick');
    this.lastDir = null;
    this.interval = null;

    this.buildDeck();
    this.initJoystick();
    this.initKeyboard();
  }

  buildDeck() {
    for (let i = 1; i <= 12; i++) {
      const tile = document.createElement('button');
      tile.className = 'action-tile';
      tile.type = 'button';
      tile.innerHTML = `<span class="idx">${String(i).padStart(2, '0')}</span><span class="label">${ACTION_NAMES[i]}</span>`;
      tile.addEventListener('click', () => this.sendAction(i));
      this.deck.appendChild(tile);
    }
  }

  async sendAction(id) {
    try {
      await sendRequest('/control', { action: id.toString() });
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  initJoystick() {
    const manager = nipplejs.create({
      zone: this.joystickZone,
      size: 110,
      mode: 'dynamic',
      position: { left: '50%', top: '50%' },
      color: '#d7a34d',
    });
    manager.on('start move end', (evt, data) => this.handleJoystickEvent(evt, data));
  }

  handleJoystickEvent(evt, data) {
    if (evt.type === 'end' || data.force < DISTANCE_THRESHOLD) {
      clearInterval(this.interval);
      this.lastDir = null;
      return;
    }

    const angle = data.angle && data.angle.radian;
    if (angle === undefined) return;
    const degrees = (angle * 180 / Math.PI + 360) % 360;

    let dir;
    if (degrees >= 45 && degrees < 135) dir = 'F';
    else if (degrees >= 135 && degrees < 225) dir = 'L';
    else if (degrees >= 225 && degrees < 315) dir = 'B';
    else dir = 'R';

    if (dir !== this.lastDir) {
      this.lastDir = dir;
      clearInterval(this.interval);
      this.sendMove(dir);
      this.interval = setInterval(() => this.sendMove(dir), SEND_INTERVAL);
    }
  }

  initKeyboard() {
    const keyMap = { ArrowUp: 'F', ArrowDown: 'B', ArrowLeft: 'L', ArrowRight: 'R' };
    const active = new Set();
    document.addEventListener('keydown', (e) => {
      const dir = keyMap[e.key];
      if (!dir || active.has(e.key)) return;
      active.add(e.key);
      this.sendMove(dir);
      clearInterval(this.interval);
      this.interval = setInterval(() => this.sendMove(dir), SEND_INTERVAL);
    });
    document.addEventListener('keyup', (e) => {
      if (!keyMap[e.key]) return;
      active.delete(e.key);
      if (active.size === 0) clearInterval(this.interval);
    });
  }

  async sendMove(dir) {
    try {
      await sendRequest('/control', { move: dir });
    } catch (err) {
      toast(err.message, 'error');
    }
  }
}

/* ---------- calibration panel ---------- */
class CalibrationPanel {
  constructor() {
    this.cfg = { fl: 0, fr: 0, bl: 0, br: 0 };
    this.current = null;
    this.display = document.getElementById('value-display');
    this.stepper = document.getElementById('stepper');
    this.minus = document.getElementById('minus');
    this.plus = document.getElementById('plus');
    this.intro = document.getElementById('calibrate-intro');
    this.iface = document.getElementById('calibrate-interface');
    this.startBtn = document.getElementById('start-calibration');
    this.exitBtn = document.getElementById('exit-calibration');
    this.pins = Array.from(document.querySelectorAll('.pin'));

    this.startBtn.onclick = () => this.start();
    this.exitBtn.onclick = () => this.exit();
    this.minus.onclick = () => this.adjust(-1);
    this.plus.onclick = () => this.adjust(1);
    this.pins.forEach(p => {
      p.addEventListener('click', () => this.select(p));
      p.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.select(p); } });
    });
  }

  async start() {
    try {
      this.cfg = await sendRequest('/start_calibration');
      this.updateDisplay();
      this.intro.hidden = true;
      this.iface.hidden = false;
    } catch (err) {
      document.getElementById('config-error').textContent = err.message;
    }
  }

  async exit() {
    try {
      await sendRequest('/exit_calibration');
      this.iface.hidden = true;
      this.intro.hidden = false;
      this.deselect();
    } catch (err) {
      document.getElementById('calibrate-error').textContent = err.message;
    }
  }

  select(pin) {
    this.pins.forEach(p => p.classList.remove('active'));
    pin.classList.add('active');
    this.current = pin.dataset.pos;
    this.display.textContent = `${this.cfg[this.current]}\u00b0`;
    this.stepper.hidden = false;
  }

  deselect() {
    this.pins.forEach(p => p.classList.remove('active'));
    this.current = null;
    this.stepper.hidden = true;
  }

  async adjust(delta) {
    if (!this.current) return;
    const next = Math.max(-25, Math.min(25, this.cfg[this.current] + delta));
    this.cfg[this.current] = next;
    this.updateDisplay();
    try {
      await sendRequest('/adjust', { servo: this.current, value: next });
    } catch (err) {
      document.getElementById('calibrate-error').textContent = err.message;
    }
  }

  updateDisplay() {
    Object.entries(this.cfg).forEach(([pos, value]) => {
      const valueEl = document.querySelector(`.pin[data-pos="${pos}"] .pin-value`);
      if (valueEl) valueEl.textContent = value;
    });
    if (this.current) this.display.textContent = `${this.cfg[this.current]}\u00b0`;
  }
}

/* ---------- sequence panel ---------- */
class SequencePanel {
  constructor() {
    this.select = document.getElementById('action-select');
    this.delayInput = document.getElementById('delay-input');
    this.addBtn = document.getElementById('add-action');
    this.list = document.getElementById('sequence-list');
    this.saveBtn = document.getElementById('save-sequence');
    this.playBtn = document.getElementById('play-sequence');
    this.errorEl = document.getElementById('custom-error');

    this.sequence = [];
    this.isPlaying = false;

    this.addBtn.onclick = () => this.add();
    this.saveBtn.onclick = () => this.save();
    this.playBtn.onclick = () => this.play();
    this.list.addEventListener('click', (e) => {
      if (e.target.classList.contains('remove')) {
        this.sequence.splice(Number(e.target.dataset.index), 1);
        this.render();
      }
    });

    this.load();
  }

  add() {
    const action = this.select.value;
    const delay = parseFloat(this.delayInput.value);
    this.errorEl.textContent = '';

    if (!action) { this.errorEl.textContent = 'Select an action first'; return; }
    if (isNaN(delay) || delay < 0 || delay > 10) { this.errorEl.textContent = 'Delay must be 0\u201310 seconds'; return; }
    if (this.sequence.length >= 4) { this.errorEl.textContent = 'Maximum of 4 steps'; return; }

    this.sequence.push({ action, delay });
    this.render();
  }

  render() {
    this.list.innerHTML = '';
    this.sequence.forEach((item, index) => {
      const li = document.createElement('li');
      li.className = 'tape-item';
      li.innerHTML = `
        <span class="step-no">${String(index + 1).padStart(2, '0')}</span>
        <span class="step-name">${ACTION_NAMES[item.action]}</span>
        <span class="step-delay">+${item.delay}s</span>
        <span class="remove" data-index="${index}">&times;</span>
      `;
      this.list.appendChild(li);
    });
    const hasItems = this.sequence.length > 0;
    this.saveBtn.disabled = !hasItems;
    this.playBtn.disabled = !hasItems || this.isPlaying;
  }

  async play() {
    if (this.isPlaying) return;
    this.isPlaying = true;
    this.render();

    for (const item of this.sequence) {
      if (!this.isPlaying) break;
      try {
        await sendRequest('/control', ['F', 'B', 'L', 'R'].includes(item.action) ? { move: item.action } : { action: item.action });
        await new Promise(resolve => setTimeout(resolve, item.delay * 1000));
      } catch (err) {
        this.errorEl.textContent = err.message;
        break;
      }
    }
    this.isPlaying = false;
    this.render();
  }

  save() {
    try {
      localStorage.setItem('espHiSequence', JSON.stringify(this.sequence));
      toast('Sequence saved', 'success');
    } catch (err) {
      this.errorEl.textContent = 'Save failed';
    }
  }

  load() {
    try {
      const saved = localStorage.getItem('espHiSequence');
      if (saved) {
        this.sequence = JSON.parse(saved);
        this.render();
      }
    } catch (err) {
      console.error('Failed to load saved sequence:', err);
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });

  new StatusPoller();
  new Tabs();
  new ControlPanel();
  new CalibrationPanel();
  new SequencePanel();
});
