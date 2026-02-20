// Main application: orchestrates upload, parsing, analysis, and rendering

window.onerror = function (msg, src, line, col, err) {
  const status = document.getElementById('upload-status');
  if (status) status.textContent = 'Error: ' + (msg || 'Unknown error') + ' (line ' + line + ')';
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
  },

  async clear() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE, 'readwrite');
      tx.objectStore(this.STORE).clear();
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  }
};

// ---- App ----
class TreadmillApp {
  constructor() {
    this.workouts = [];
    this.analysisResults = null;
    this.settings = {
      age: 30,
      unit: 'mi',
      maxHR: 190,
      dateRange: { start: null, end: null },
      showIndoorOnly: false
    };
    this.worker = null;
    this.init();
  }

  async init() {
    this.loadSettings();
    this.setupUpload();
    this.setupSettings();
    this.setupTabs();
    this.setupRunTable();

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }

    // Try loading saved data
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
        if (status) {
          const dateStr = savedDate ? new Date(savedDate).toLocaleDateString() : 'unknown';
          status.textContent = `Loaded ${saved.length} saved runs (imported ${dateStr}). Re-upload to refresh.`;
        }
        const progressBar = document.getElementById('progress-bar');
        if (progressBar) progressBar.style.width = '100%';
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
      if (saved) {
        const parsed = JSON.parse(saved);
        Object.assign(this.settings, parsed);
        this.settings.maxHR = 220 - this.settings.age;
      }
    } catch {}
    this.applySettingsToUI();
  }

  saveSettings() {
    try {
      localStorage.setItem('treadmill-settings', JSON.stringify({
        age: this.settings.age,
        unit: this.settings.unit,
        showIndoorOnly: this.settings.showIndoorOnly
      }));
    } catch {}
  }

  applySettingsToUI() {
    const ageInput = document.getElementById('setting-age');
    const unitSelect = document.getElementById('setting-unit');
    const indoorCheck = document.getElementById('setting-indoor');
    if (ageInput) ageInput.value = this.settings.age;
    if (unitSelect) unitSelect.value = this.settings.unit;
    if (indoorCheck) indoorCheck.checked = this.settings.showIndoorOnly;
  }

  setupSettings() {
    const ageInput = document.getElementById('setting-age');
    const unitSelect = document.getElementById('setting-unit');
    const indoorCheck = document.getElementById('setting-indoor');
    const dateStart = document.getElementById('setting-date-start');
    const dateEnd = document.getElementById('setting-date-end');

    const refresh = () => {
      if (this.workouts.length > 0) this.runAnalysis();
    };

    ageInput?.addEventListener('change', () => {
      this.settings.age = parseInt(ageInput.value) || 30;
      this.settings.maxHR = 220 - this.settings.age;
      this.saveSettings();
      refresh();
    });

    unitSelect?.addEventListener('change', () => {
      this.settings.unit = unitSelect.value;
      this.saveSettings();
      refresh();
    });

    indoorCheck?.addEventListener('change', () => {
      this.settings.showIndoorOnly = indoorCheck.checked;
      this.saveSettings();
      refresh();
    });

    dateStart?.addEventListener('change', () => {
      this.settings.dateRange.start = dateStart.value || null;
      refresh();
    });

    dateEnd?.addEventListener('change', () => {
      this.settings.dateRange.end = dateEnd.value || null;
      refresh();
    });
  }

  setupUpload() {
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');

    if (!dropZone || !fileInput) return;

    ['dragenter', 'dragover'].forEach(evt => {
      dropZone.addEventListener(evt, e => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
      });
    });

    ['dragleave', 'drop'].forEach(evt => {
      dropZone.addEventListener(evt, e => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
      });
    });

    dropZone.addEventListener('drop', e => {
      const file = e.dataTransfer.files[0];
      if (file) this.handleFile(file);
    });

    dropZone.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', () => {
      if (fileInput.files[0]) this.handleFile(fileInput.files[0]);
    });
  }

  async handleFile(file) {
    const status = document.getElementById('upload-status');
    const progress = document.getElementById('upload-progress');
    const progressBar = document.getElementById('progress-bar');
    const dropZone = document.getElementById('drop-zone');

    const lowerName = (file.name || '').toLowerCase();
    if (!lowerName.endsWith('.xml') && !lowerName.endsWith('.zip')) {
      if (status) status.textContent = 'Please upload an export.xml or export.zip file from Apple Health.';
      return;
    }

    if (progress) progress.style.display = 'block';
    if (dropZone) dropZone.style.display = 'none';
    if (status) status.textContent = 'Preparing file...';
    if (progressBar) progressBar.style.width = '0%';

    let xmlFile = file;

    if (lowerName.endsWith('.zip')) {
      try {
        if (typeof JSZip === 'undefined') {
          throw new Error('JSZip library failed to load. Check your internet connection and try again.');
        }
        if (status) status.textContent = 'Unzipping export (this may take a moment)...';

        const zip = await JSZip.loadAsync(file);

        let xmlEntry = zip.file('apple_health_export/export.xml') || zip.file('export.xml');
        if (!xmlEntry) {
          const xmlFiles = Object.keys(zip.files).filter(f => f.endsWith('export.xml'));
          if (xmlFiles.length === 0) {
            if (status) status.textContent = 'Could not find export.xml in the zip. Try extracting the zip first and uploading the export.xml file directly.';
            if (dropZone) dropZone.style.display = '';
            return;
          }
          xmlEntry = zip.file(xmlFiles[0]);
        }

        if (status) status.textContent = 'Decompressing export.xml...';
        const arrayBuffer = await xmlEntry.async('arraybuffer');
        xmlFile = new Blob([arrayBuffer], { type: 'application/xml' });

      } catch (err) {
        console.error('Zip error:', err);
        if (status) {
          status.innerHTML = `<strong>Error reading zip:</strong> ${err.message}<br><br>` +
            '<strong>Alternative:</strong> Extract the zip file first, then upload the <code>export.xml</code> directly. ' +
            'On iPhone: open Files app, long-press the zip, tap "Uncompress".';
        }
        if (dropZone) dropZone.style.display = '';
        return;
      }
    }

    if (status) status.textContent = 'Parsing workouts (fast mode)...';

    try {
      this.worker = new Worker('js/parser.worker.js');
    } catch (err) {
      if (status) status.textContent = 'Error starting parser: ' + err.message;
      return;
    }

    this.worker.onerror = (err) => {
      console.error('Worker error:', err);
      if (status) status.textContent = 'Parser error: ' + (err.message || 'Worker crashed. Try uploading export.xml instead of zip.');
    };

    this.worker.onmessage = (e) => {
      if (e.data.type === 'progress') {
        const pct = Math.round(e.data.value * 100);
        if (progressBar) progressBar.style.width = pct + '%';
        if (status) {
          const s = e.data.stats;
          status.textContent = `Parsing... ${pct}% (${s.workouts} runs found)`;
        }
      } else if (e.data.type === 'complete') {
        this.workouts = e.data.data;
        if (progressBar) progressBar.style.width = '100%';
        if (status) status.textContent = `Found ${this.workouts.length} running workouts. Saving & analyzing...`;

        this.worker.terminate();
        this.worker = null;

        setTimeout(async () => {
          await this.saveData();
          this.runAnalysis();
          this.showDashboard();
          if (status) status.textContent = `${this.workouts.length} runs loaded and saved. Data will persist across refreshes.`;
        }, 50);
      } else if (e.data.type === 'error') {
        if (status) status.textContent = 'Parse error: ' + e.data.message;
      }
    };

    // Use fast mode: only extract Workout elements, skip individual HR/step records
    this.worker.postMessage({ type: 'parse', file: xmlFile, mode: 'fast' });
  }

  runAnalysis() {
    if (this.workouts.length === 0) return;
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
    this.renderActiveTab();
    this.renderRunTableData(r.runTable, r.settings.unit);
  }

  renderSummaryCards(summary) {
    const factor = this.settings.unit === 'km' ? 1.60934 : 1;
    const distUnit = this.settings.unit === 'km' ? 'km' : 'mi';
    const paceFactor = this.settings.unit === 'km' ? 1 / 1.60934 : 1;
    const paceUnit = this.settings.unit === 'km' ? 'min/km' : 'min/mi';

    setText('stat-total-runs', summary.totalRuns.toLocaleString());
    setText('stat-total-distance', (summary.totalDistance * factor).toFixed(1) + ' ' + distUnit);
    setText('stat-total-time', formatDuration(summary.totalTime));
    setText('stat-avg-pace', formatPace(summary.avgPace * paceFactor) + ' ' + paceUnit);
    setText('stat-total-cal', Math.round(summary.totalCalories).toLocaleString() + ' kcal');
    setText('stat-streak', summary.currentStreak + ' wk' + (summary.currentStreak !== 1 ? 's' : ''));
  }

  setupTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        const target = document.getElementById('tab-' + btn.dataset.tab);
        if (target) target.classList.add('active');
        this.renderActiveTab();
      });
    });
  }

  renderActiveTab() {
    const r = this.analysisResults;
    if (!r) return;

    const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab;
    const unit = r.settings.unit;

    switch (activeTab) {
      case 'pace':
        Charts.renderPaceOverTime(r.pace, unit);
        break;
      case 'hr':
        Charts.renderHRZones(r.hrZones);
        Charts.renderHROverTime(r.hrOverTime);
        Charts.renderHRDrift(r.hrZones.hrDrift);
        break;
      case 'volume':
        Charts.renderWeeklyMileage(r.weeklyVolume, unit);
        Charts.renderMonthlyMileage(r.monthlyVolume, unit);
        Charts.renderCumulativeDistance(r.cumulativeDistance, unit);
        break;
      case 'calories':
        Charts.renderCaloriesPerRun(r.calories);
        Charts.renderCalPerMile(r.calories, unit);
        Charts.renderWeeklyCalories(r.weeklyVolume);
        break;
      case 'consistency':
        Charts.renderRunsPerWeek(r.consistency.weeklyRuns);
        Charts.renderDayOfWeek(r.consistency.dayOfWeek);
        Charts.renderHeatmap(r.consistency.heatmap);
        Charts.renderHourDistribution(r.consistency.hourDist);
        break;
      case 'perrun':
        Charts.renderCadence(r.cadence);
        Charts.renderPaceVsHR(r.correlations.paceVsHR);
        Charts.renderDistanceVsCal(r.correlations.distanceVsCal);
        break;
    }
  }

  setupRunTable() {
    document.querySelectorAll('#run-table th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const key = th.dataset.sort;
        const currentDir = th.dataset.dir || 'desc';
        const newDir = currentDir === 'desc' ? 'asc' : 'desc';

        document.querySelectorAll('#run-table th').forEach(h => delete h.dataset.dir);
        th.dataset.dir = newDir;

        if (this.analysisResults) {
          const table = this.analysisResults.runTable;
          table.sort((a, b) => {
            const va = a[key] ?? 0;
            const vb = b[key] ?? 0;
            if (key === 'date') return newDir === 'asc'
              ? new Date(va) - new Date(vb)
              : new Date(vb) - new Date(va);
            return newDir === 'asc' ? va - vb : vb - va;
          });
          this.renderRunTableData(table, this.analysisResults.settings.unit);
        }
      });
    });
  }

  renderRunTableData(runs, unit) {
    const tbody = document.querySelector('#run-table tbody');
    if (!tbody) return;

    const distUnit = unit === 'km' ? 'km' : 'mi';
    const paceUnit = unit === 'km' ? '/km' : '/mi';

    tbody.innerHTML = runs.map(r => `
      <tr>
        <td>${new Date(r.date).toLocaleDateString()}</td>
        <td>${r.distance.toFixed(2)} ${distUnit}</td>
        <td>${formatDuration(r.duration)}</td>
        <td>${r.pace ? formatPace(r.pace) + paceUnit : '--'}</td>
        <td>${r.avgHR ? Math.round(r.avgHR) : '--'}</td>
        <td>${r.maxHR ? Math.round(r.maxHR) : '--'}</td>
        <td>${Math.round(r.calories)}</td>
        <td>${r.cadence || '--'}</td>
        <td>${r.isIndoor ? '🏠' : '🌳'}</td>
      </tr>
    `).join('');
  }
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

document.addEventListener('DOMContentLoaded', () => {
  window.app = new TreadmillApp();
});
