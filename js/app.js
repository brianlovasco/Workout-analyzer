// Main application: orchestrates upload, parsing, analysis, and rendering

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

  init() {
    this.loadSettings();
    this.setupUpload();
    this.setupSettings();
    this.setupTabs();
    this.setupRunTable();

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
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

    if (!file.name.endsWith('.xml') && !file.name.endsWith('.zip')) {
      if (status) status.textContent = 'Please upload an export.xml or export.zip file from Apple Health.';
      return;
    }

    if (progress) progress.style.display = 'block';
    if (dropZone) dropZone.style.display = 'none';
    if (status) status.textContent = 'Preparing file...';

    let xmlFile = file;

    if (file.name.endsWith('.zip')) {
      try {
        if (status) status.textContent = 'Unzipping export...';
        const zip = await JSZip.loadAsync(file);
        const xmlEntry = zip.file('apple_health_export/export.xml') || zip.file('export.xml');
        if (!xmlEntry) {
          const xmlFiles = Object.keys(zip.files).filter(f => f.endsWith('export.xml'));
          if (xmlFiles.length === 0) {
            if (status) status.textContent = 'Could not find export.xml in the zip file.';
            return;
          }
          xmlFile = await zip.file(xmlFiles[0]).async('blob');
        } else {
          xmlFile = await xmlEntry.async('blob');
        }
        xmlFile.name = 'export.xml';
      } catch (err) {
        if (status) status.textContent = `Error reading zip: ${err.message}`;
        return;
      }
    }

    if (status) status.textContent = 'Parsing Apple Health data...';

    this.worker = new Worker('js/parser.worker.js');

    this.worker.onmessage = (e) => {
      if (e.data.type === 'progress') {
        const pct = Math.round(e.data.value * 100);
        if (progressBar) progressBar.style.width = pct + '%';
        if (status) {
          const s = e.data.stats;
          status.textContent = `Parsing... ${pct}% (${s.workouts} runs, ${s.hrRecords.toLocaleString()} HR samples)`;
        }
      } else if (e.data.type === 'complete') {
        this.workouts = e.data.data;
        if (status) status.textContent = `Found ${this.workouts.length} running workouts. Analyzing...`;
        if (progressBar) progressBar.style.width = '100%';

        setTimeout(() => {
          this.runAnalysis();
          this.showDashboard();
        }, 100);
      } else if (e.data.type === 'error') {
        if (status) status.textContent = `Error: ${e.data.message}`;
      }
    };

    this.worker.postMessage({ type: 'parse', file: xmlFile });
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
