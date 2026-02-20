// Main application: orchestrates upload, parsing, analysis, and rendering

window.onerror = function (msg, src, line, col, err) {
  const status = document.getElementById('upload-status');
  if (status) status.textContent = 'Error: ' + (msg || 'Unknown error');
  console.error('Global error:', msg, src, line, col, err);
};
window.onunhandledrejection = function (e) {
  const status = document.getElementById('upload-status');
  if (status) status.textContent = 'Error: ' + (e.reason?.message || e.reason || 'Unknown async error');
  console.error('Unhandled rejection:', e.reason);
};

// ---- IndexedDB persistence ----
const DB = {
  NAME: 'treadmill-analyzer',
  VERSION: 1,
  STORE: 'data',

  open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.NAME, this.VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(this.STORE)) {
          db.createObjectStore(this.STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  async save(key, value) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE, 'readwrite');
      tx.objectStore(this.STORE).put(value, key);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  },

  async load(key) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE, 'readonly');
      const req = tx.objectStore(this.STORE).get(key);
      req.onsuccess = () => { db.close(); resolve(req.result); };
      req.onerror = () => { db.close(); reject(req.error); };
    });
  }
};

// ---- Goals ----
const Goals = {
  defaults: { monthlyRuns: 16, monthlyMiles: 40, yearlyRuns: 200, yearlyMiles: 500 },

  load() {
    try {
      const saved = localStorage.getItem('treadmill-goals');
      return saved ? { ...this.defaults, ...JSON.parse(saved) } : { ...this.defaults };
    } catch { return { ...this.defaults }; }
  },

  save(goals) {
    try { localStorage.setItem('treadmill-goals', JSON.stringify(goals)); } catch {}
  },

  computeSmartDefaults(workouts) {
    const now = new Date();
    const sixMonthsAgo = new Date(now);
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const recent = workouts.filter(w => new Date(w.startDate) >= sixMonthsAgo);

    if (recent.length < 5) return this.defaults;

    const months = {};
    for (const w of recent) {
      const key = new Date(w.startDate).toISOString().slice(0, 7);
      if (!months[key]) months[key] = { runs: 0, miles: 0 };
      months[key].runs++;
      months[key].miles += w.totalDistance || 0;
    }

    const vals = Object.values(months);
    const avgRuns = vals.reduce((s, m) => s + m.runs, 0) / vals.length;
    const avgMiles = vals.reduce((s, m) => s + m.miles, 0) / vals.length;

    return {
      monthlyRuns: Math.ceil(avgRuns / 2) * 2,
      monthlyMiles: Math.ceil(avgMiles / 5) * 5,
      yearlyRuns: Math.ceil(avgRuns / 2) * 2 * 12,
      yearlyMiles: Math.ceil(avgMiles / 5) * 5 * 12
    };
  },

  computeProgress(workouts, goals) {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();

    const thisMonth = workouts.filter(w => {
      const d = new Date(w.startDate);
      return d.getFullYear() === year && d.getMonth() === month;
    });

    const thisYear = workouts.filter(w => {
      return new Date(w.startDate).getFullYear() === year;
    });

    const monthRuns = thisMonth.length;
    const monthMiles = thisMonth.reduce((s, w) => s + (w.totalDistance || 0), 0);
    const yearRuns = thisYear.length;
    const yearMiles = thisYear.reduce((s, w) => s + (w.totalDistance || 0), 0);

    const monthName = now.toLocaleString('default', { month: 'short' });

    return [
      {
        id: 'monthlyRuns', icon: '🗓️', badge: '🏅',
        label: `${monthName} Runs`,
        current: monthRuns, target: goals.monthlyRuns, unit: 'runs'
      },
      {
        id: 'monthlyMiles', icon: '📏', badge: '🏅',
        label: `${monthName} Miles`,
        current: +monthMiles.toFixed(1), target: goals.monthlyMiles, unit: 'mi'
      },
      {
        id: 'yearlyRuns', icon: '🏃', badge: '🏆',
        label: `${year} Total Runs`,
        current: yearRuns, target: goals.yearlyRuns, unit: 'runs'
      },
      {
        id: 'yearlyMiles', icon: '🛣️', badge: '🏆',
        label: `${year} Total Miles`,
        current: +yearMiles.toFixed(1), target: goals.yearlyMiles, unit: 'mi'
      }
    ];
  },

  render(workouts) {
    const container = document.getElementById('goals-grid');
    if (!container) return;

    let goals = this.load();

    // Auto-set smart defaults on first use
    if (!localStorage.getItem('treadmill-goals')) {
      goals = this.computeSmartDefaults(workouts);
      this.save(goals);
    }

    const progress = this.computeProgress(workouts, goals);
    container.innerHTML = '';

    for (const g of progress) {
      const pct = g.target > 0 ? Math.min((g.current / g.target) * 100, 100) : 0;
      const achieved = g.current >= g.target;

      const card = document.createElement('div');
      card.className = 'goal-card' + (achieved ? ' achieved' : '');
      card.innerHTML = `
        <div class="goal-header">
          <span class="goal-icon">${g.icon}</span>
          <span class="goal-badge">${achieved ? g.badge : '🔒'}</span>
        </div>
        <div class="goal-label">${g.label}</div>
        <div class="goal-progress-text">${g.current} <span style="color:var(--text-secondary);font-weight:400;font-size:0.85rem">/ ${g.target} ${g.unit}</span></div>
        <div class="goal-target" data-goal="${g.id}">Target: ${g.target} ${g.unit} (tap to edit)</div>
        <div class="goal-bar-track"><div class="goal-bar-fill" style="width:${pct}%"></div></div>
        <div class="goal-pct">${Math.round(pct)}%</div>`;
      container.appendChild(card);
    }

    container.querySelectorAll('.goal-target').forEach(el => {
      el.addEventListener('click', () => {
        const goalId = el.dataset.goal;
        const current = goals[goalId];
        const input = document.createElement('input');
        input.type = 'number';
        input.value = current;
        input.min = 1;
        el.textContent = '';
        el.appendChild(input);
        input.focus();
        input.select();

        const save = () => {
          const val = parseInt(input.value);
          if (val > 0) {
            goals[goalId] = val;
            Goals.save(goals);
            Goals.render(workouts);
          }
        };
        input.addEventListener('blur', save);
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
      });
    });
  }
};

// ---- Time Range Helpers ----
function getDateRange(range) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

  switch (range) {
    case 'week': {
      const start = new Date(today);
      start.setDate(start.getDate() - 7);
      return { start, end: today };
    }
    case 'mtd': {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return { start, end: today };
    }
    case '6mo': {
      const start = new Date(today);
      start.setMonth(start.getMonth() - 6);
      return { start, end: today };
    }
    case 'ytd': {
      const start = new Date(now.getFullYear(), 0, 1);
      return { start, end: today };
    }
    default:
      return { start: null, end: null };
  }
}

// ---- App ----
class TreadmillApp {
  constructor() {
    this.workouts = [];
    this.analysisResults = null;
    this.activeRange = 'all';
    this.settings = { age: 30, unit: 'mi', maxHR: 190 };
    this.worker = null;
    this.init();
  }

  async init() {
    this.loadSettings();
    this.setupUpload();
    this.setupTimeFilter();
    this.setupTabs();
    this.setupRunTable();

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }

    await this.loadSavedData();
  }

  async loadSavedData() {
    try {
      const saved = await DB.load('workouts');
      if (saved && saved.length > 0) {
        this.workouts = saved;
        const savedDate = await DB.load('savedDate');
        const status = document.getElementById('upload-status');
        const progress = document.getElementById('upload-progress');
        if (progress) progress.style.display = 'block';
        const progressBar = document.getElementById('progress-bar');
        if (progressBar) progressBar.style.width = '100%';
        if (status) {
          const dateStr = savedDate ? new Date(savedDate).toLocaleDateString() : 'unknown';
          status.textContent = `Loaded ${saved.length} saved runs (imported ${dateStr}). Re-upload to refresh.`;
        }
        this.runAnalysis();
        this.showDashboard();
      }
    } catch (err) {
      console.warn('Could not load saved data:', err);
    }
  }

  async saveData() {
    try {
      await DB.save('workouts', this.workouts);
      await DB.save('savedDate', new Date().toISOString());
    } catch (err) {
      console.warn('Could not save data:', err);
    }
  }

  loadSettings() {
    try {
      const saved = localStorage.getItem('treadmill-settings');
      if (saved) Object.assign(this.settings, JSON.parse(saved));
      this.settings.maxHR = 220 - (this.settings.age || 30);
    } catch {}
  }

  setupTimeFilter() {
    document.querySelectorAll('.time-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.time-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.activeRange = btn.dataset.range;
        if (this.workouts.length > 0) this.runAnalysis();
      });
    });
  }

  setupUpload() {
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    if (!dropZone || !fileInput) return;

    ['dragenter', 'dragover'].forEach(evt => {
      dropZone.addEventListener(evt, e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
    });
    ['dragleave', 'drop'].forEach(evt => {
      dropZone.addEventListener(evt, e => { e.preventDefault(); dropZone.classList.remove('drag-over'); });
    });
    dropZone.addEventListener('drop', e => { if (e.dataTransfer.files[0]) this.handleFile(e.dataTransfer.files[0]); });
    dropZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => { if (fileInput.files[0]) this.handleFile(fileInput.files[0]); });
  }

  async handleFile(file) {
    const status = document.getElementById('upload-status');
    const progress = document.getElementById('upload-progress');
    const progressBar = document.getElementById('progress-bar');
    const dropZone = document.getElementById('drop-zone');

    const lowerName = (file.name || '').toLowerCase();
    if (!lowerName.endsWith('.xml') && !lowerName.endsWith('.zip')) {
      if (status) status.textContent = 'Please upload an export.xml or export.zip file.';
      return;
    }

    if (progress) progress.style.display = 'block';
    if (dropZone) dropZone.style.display = 'none';
    if (status) status.textContent = 'Preparing file...';
    if (progressBar) progressBar.style.width = '0%';

    let xmlFile = file;

    if (lowerName.endsWith('.zip')) {
      try {
        if (typeof JSZip === 'undefined') throw new Error('JSZip failed to load. Check connection.');
        if (status) status.textContent = 'Unzipping export...';
        const zip = await JSZip.loadAsync(file);
        let xmlEntry = zip.file('apple_health_export/export.xml') || zip.file('export.xml');
        if (!xmlEntry) {
          const xmlFiles = Object.keys(zip.files).filter(f => f.endsWith('export.xml'));
          if (xmlFiles.length === 0) { if (status) status.textContent = 'export.xml not found in zip.'; return; }
          xmlEntry = zip.file(xmlFiles[0]);
        }
        if (status) status.textContent = 'Decompressing...';
        const ab = await xmlEntry.async('arraybuffer');
        xmlFile = new Blob([ab], { type: 'application/xml' });
      } catch (err) {
        if (status) status.innerHTML = `<strong>Zip error:</strong> ${err.message}<br>Try uploading export.xml directly.`;
        if (dropZone) dropZone.style.display = '';
        return;
      }
    }

    if (status) status.textContent = 'Parsing workouts...';

    try { this.worker = new Worker('js/parser.worker.js'); }
    catch (err) { if (status) status.textContent = 'Worker error: ' + err.message; return; }

    this.worker.onerror = (err) => {
      if (status) status.textContent = 'Parser crashed: ' + (err.message || 'Try export.xml instead.');
    };

    this.worker.onmessage = (e) => {
      if (e.data.type === 'progress') {
        const pct = Math.round(e.data.value * 100);
        if (progressBar) progressBar.style.width = pct + '%';
        if (status) status.textContent = `Parsing... ${pct}% (${e.data.stats.workouts} runs found)`;
      } else if (e.data.type === 'complete') {
        this.workouts = e.data.data;
        if (progressBar) progressBar.style.width = '100%';
        if (status) status.textContent = `${this.workouts.length} runs loaded. Saving...`;
        this.worker.terminate();
        this.worker = null;
        setTimeout(async () => {
          await this.saveData();
          this.runAnalysis();
          this.showDashboard();
          if (status) status.textContent = `${this.workouts.length} runs saved. Data persists across refreshes.`;
        }, 50);
      } else if (e.data.type === 'error') {
        if (status) status.textContent = 'Parse error: ' + e.data.message;
      }
    };

    this.worker.postMessage({ type: 'parse', file: xmlFile, mode: 'fast' });
  }

  runAnalysis() {
    if (this.workouts.length === 0) return;

    const range = getDateRange(this.activeRange);
    this.settings.dateRange = range;

    this.analysisResults = Analyzer.runAll(this.workouts, this.settings);
    this.renderAll();
  }

  showDashboard() {
    document.getElementById('upload-section')?.classList.add('collapsed');
    document.getElementById('dashboard')?.classList.remove('hidden');
  }

  renderAll() {
    const r = this.analysisResults;
    if (!r) return;

    this.renderSummaryCards(r.summary);
    Charts.renderPersonalRecords(r.personalRecords, r.settings.unit);
    // Goals always use ALL data, not the filtered range
    Goals.render(this.workouts);
    this.renderActiveTab();
    this.renderRunTableData(r.runTable, r.settings.unit);
  }

  renderSummaryCards(summary) {
    setText('stat-total-runs', summary.totalRuns.toLocaleString());
    setText('stat-total-distance', summary.totalDistance.toFixed(1) + ' mi');
    setText('stat-total-time', formatDuration(summary.totalTime));
    setText('stat-avg-pace', formatPace(summary.avgPace) + ' /mi');
    setText('stat-total-cal', Math.round(summary.totalCalories).toLocaleString() + ' kcal');
    setText('stat-streak', summary.currentStreak + ' wk' + (summary.currentStreak !== 1 ? 's' : ''));
  }

  setupTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('tab-' + btn.dataset.tab)?.classList.add('active');
        this.renderActiveTab();
      });
    });
  }

  renderActiveTab() {
    const r = this.analysisResults;
    if (!r) return;
    const tab = document.querySelector('.tab-btn.active')?.dataset.tab;
    const u = r.settings.unit;

    switch (tab) {
      case 'pace':    Charts.renderPaceOverTime(r.pace, u); break;
      case 'hr':      Charts.renderHRZones(r.hrZones); Charts.renderHROverTime(r.hrOverTime); Charts.renderHRDrift(r.hrZones.hrDrift); break;
      case 'volume':  Charts.renderWeeklyMileage(r.weeklyVolume, u); Charts.renderMonthlyMileage(r.monthlyVolume, u); Charts.renderCumulativeDistance(r.cumulativeDistance, u); break;
      case 'calories': Charts.renderCaloriesPerRun(r.calories); Charts.renderCalPerMile(r.calories, u); Charts.renderWeeklyCalories(r.weeklyVolume); break;
      case 'consistency': Charts.renderRunsPerWeek(r.consistency.weeklyRuns); Charts.renderDayOfWeek(r.consistency.dayOfWeek); Charts.renderHeatmap(r.consistency.heatmap); Charts.renderHourDistribution(r.consistency.hourDist); break;
      case 'perrun':  Charts.renderCadence(r.cadence); Charts.renderPaceVsHR(r.correlations.paceVsHR); Charts.renderDistanceVsCal(r.correlations.distanceVsCal); break;
    }
  }

  setupRunTable() {
    document.querySelectorAll('#run-table th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const key = th.dataset.sort;
        const dir = th.dataset.dir === 'desc' ? 'asc' : 'desc';
        document.querySelectorAll('#run-table th').forEach(h => delete h.dataset.dir);
        th.dataset.dir = dir;
        if (this.analysisResults) {
          this.analysisResults.runTable.sort((a, b) => {
            const va = a[key] ?? 0, vb = b[key] ?? 0;
            if (key === 'date') return dir === 'asc' ? new Date(va) - new Date(vb) : new Date(vb) - new Date(va);
            return dir === 'asc' ? va - vb : vb - va;
          });
          this.renderRunTableData(this.analysisResults.runTable, this.analysisResults.settings.unit);
        }
      });
    });
  }

  renderRunTableData(runs, unit) {
    const tbody = document.querySelector('#run-table tbody');
    if (!tbody) return;
    tbody.innerHTML = runs.map(r => `
      <tr>
        <td>${new Date(r.date).toLocaleDateString()}</td>
        <td>${r.distance.toFixed(2)} mi</td>
        <td>${formatDuration(r.duration)}</td>
        <td>${r.pace ? formatPace(r.pace) + '/mi' : '--'}</td>
        <td>${r.avgHR ? Math.round(r.avgHR) : '--'}</td>
        <td>${r.maxHR ? Math.round(r.maxHR) : '--'}</td>
        <td>${Math.round(r.calories)}</td>
        <td>${r.cadence || '--'}</td>
        <td>${r.isIndoor ? '🏠' : '🌳'}</td>
      </tr>`).join('');
  }
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

document.addEventListener('DOMContentLoaded', () => { window.app = new TreadmillApp(); });
