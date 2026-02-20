// Chart rendering module: all Chart.js chart definitions

const COLORS = {
  accent: '#00d4aa',
  accentLight: 'rgba(0, 212, 170, 0.2)',
  secondary: '#6366f1',
  secondaryLight: 'rgba(99, 102, 241, 0.2)',
  tertiary: '#f59e0b',
  grid: 'rgba(255, 255, 255, 0.06)',
  text: '#a0a0b0',
  white: '#e0e0e0',
  zones: ['#3b82f6', '#22c55e', '#eab308', '#f97316', '#ef4444']
};

const Charts = {
  instances: {},

  destroy(id) {
    if (this.instances[id]) {
      this.instances[id].destroy();
      delete this.instances[id];
    }
  },

  destroyAll() {
    Object.keys(this.instances).forEach(id => this.destroy(id));
  },

  create(id, config) {
    this.destroy(id);
    const ctx = document.getElementById(id);
    if (!ctx) return null;
    this.instances[id] = new Chart(ctx, config);
    return this.instances[id];
  },

  commonScales(xLabel, yLabel, yReverse = false) {
    return {
      x: {
        type: 'time',
        time: { unit: 'month', tooltipFormat: 'MMM d, yyyy' },
        grid: { color: COLORS.grid },
        ticks: { color: COLORS.text, maxRotation: 45 },
        title: { display: !!xLabel, text: xLabel, color: COLORS.text }
      },
      y: {
        reverse: yReverse,
        grid: { color: COLORS.grid },
        ticks: { color: COLORS.text },
        title: { display: !!yLabel, text: yLabel, color: COLORS.text }
      }
    };
  },

  defaultPlugins(title) {
    return {
      legend: { labels: { color: COLORS.white, usePointStyle: true, padding: 16 } },
      title: { display: !!title, text: title, color: COLORS.white, font: { size: 14 } },
      tooltip: {
        backgroundColor: 'rgba(15, 15, 26, 0.95)',
        titleColor: COLORS.white,
        bodyColor: COLORS.text,
        borderColor: 'rgba(255,255,255,0.1)',
        borderWidth: 1,
        cornerRadius: 8,
        padding: 12
      }
    };
  },

  // ---- PACE TAB ----
  renderPaceOverTime(data, unit) {
    const factor = unit === 'km' ? 1 / 1.60934 : 1;
    const label = unit === 'km' ? 'min/km' : 'min/mi';
    return this.create('chart-pace', {
      type: 'line',
      data: {
        datasets: [
          {
            label: 'Pace',
            data: data.map(d => ({ x: d.date, y: d.pace * factor })),
            borderColor: COLORS.accent,
            backgroundColor: COLORS.accentLight,
            borderWidth: 1.5,
            pointRadius: 2,
            pointHoverRadius: 5,
            fill: true,
            tension: 0.3
          },
          {
            label: '7-day avg',
            data: data.map(d => ({ x: d.date, y: d.rolling7 * factor })),
            borderColor: COLORS.secondary,
            borderWidth: 2,
            pointRadius: 0,
            fill: false,
            tension: 0.4
          },
          {
            label: '30-day avg',
            data: data.map(d => ({ x: d.date, y: d.rolling30 * factor })),
            borderColor: COLORS.tertiary,
            borderWidth: 2,
            pointRadius: 0,
            borderDash: [6, 3],
            fill: false,
            tension: 0.4
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: this.commonScales('', label, true),
        plugins: {
          ...this.defaultPlugins('Pace Over Time'),
          tooltip: {
            ...this.defaultPlugins('').tooltip,
            callbacks: {
              label: ctx => `${ctx.dataset.label}: ${formatPace(ctx.parsed.y)}`
            }
          }
        }
      }
    });
  },

  renderPersonalRecords(records, unit) {
    const el = document.getElementById('personal-records');
    if (!el) return;
    const factor = unit === 'km' ? 1.60934 : 1;
    const distUnit = unit === 'km' ? 'km' : 'mi';
    const paceUnit = unit === 'km' ? 'min/km' : 'min/mi';
    const paceFactor = unit === 'km' ? 1 / 1.60934 : 1;

    el.innerHTML = '';
    const items = [
      { label: 'Fastest Pace', value: records.fastestPace ? formatPace(records.fastestPace.value * paceFactor) + ' ' + paceUnit : 'N/A', date: records.fastestPace?.date, icon: '⚡' },
      { label: 'Longest Run', value: records.longestDistance ? (records.longestDistance.value * factor).toFixed(2) + ' ' + distUnit : 'N/A', date: records.longestDistance?.date, icon: '📏' },
      { label: 'Longest Duration', value: records.longestDuration ? formatDuration(records.longestDuration.value) : 'N/A', date: records.longestDuration?.date, icon: '⏱️' },
      { label: 'Most Calories', value: records.mostCalories ? Math.round(records.mostCalories.value) + ' kcal' : 'N/A', date: records.mostCalories?.date, icon: '🔥' }
    ];
    items.forEach(item => {
      const div = document.createElement('div');
      div.className = 'pr-card';
      div.innerHTML = `
        <span class="pr-icon">${item.icon}</span>
        <div class="pr-info">
          <div class="pr-label">${item.label}</div>
          <div class="pr-value">${item.value}</div>
          ${item.date ? `<div class="pr-date">${new Date(item.date).toLocaleDateString()}</div>` : ''}
        </div>`;
      el.appendChild(div);
    });
  },

  // ---- HEART RATE TAB ----
  renderHRZones(hrData) {
    if (!hrData.perWorkout.length) return;
    const recent = hrData.perWorkout.slice(-50);
    return this.create('chart-hr-zones', {
      type: 'bar',
      data: {
        labels: recent.map(d => new Date(d.date).toLocaleDateString()),
        datasets: hrData.zones.map((z, i) => ({
          label: z.name,
          data: recent.map(d => +(d.zoneTimes[i] || 0).toFixed(1)),
          backgroundColor: z.color + 'cc',
          borderColor: z.color,
          borderWidth: 1
        }))
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { stacked: true, grid: { color: COLORS.grid }, ticks: { color: COLORS.text, maxRotation: 45, maxTicksLimit: 15 } },
          y: { stacked: true, grid: { color: COLORS.grid }, ticks: { color: COLORS.text }, title: { display: true, text: 'Minutes', color: COLORS.text } }
        },
        plugins: this.defaultPlugins('Time in HR Zones (Last 50 Runs)')
      }
    });
  },

  renderHROverTime(data) {
    return this.create('chart-hr-time', {
      type: 'line',
      data: {
        datasets: [
          {
            label: 'Avg HR',
            data: data.map(d => ({ x: d.date, y: d.avgHR })),
            borderColor: COLORS.accent,
            backgroundColor: COLORS.accentLight,
            borderWidth: 2,
            pointRadius: 2,
            fill: true,
            tension: 0.3
          },
          {
            label: 'Max HR',
            data: data.filter(d => d.maxHR).map(d => ({ x: d.date, y: d.maxHR })),
            borderColor: COLORS.zones[4],
            borderWidth: 1.5,
            pointRadius: 1,
            fill: false,
            tension: 0.3
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: this.commonScales('', 'BPM'),
        plugins: this.defaultPlugins('Heart Rate Over Time')
      }
    });
  },

  renderHRDrift(driftData) {
    if (!driftData.length) return;
    return this.create('chart-hr-drift', {
      type: 'bar',
      data: {
        datasets: [{
          label: 'HR Drift (bpm)',
          data: driftData.slice(-50).map(d => ({ x: d.date, y: +d.drift.toFixed(1) })),
          backgroundColor: driftData.slice(-50).map(d => d.drift >= 0 ? COLORS.zones[3] + '99' : COLORS.zones[0] + '99'),
          borderColor: driftData.slice(-50).map(d => d.drift >= 0 ? COLORS.zones[3] : COLORS.zones[0]),
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { type: 'time', time: { unit: 'month' }, grid: { color: COLORS.grid }, ticks: { color: COLORS.text } },
          y: { grid: { color: COLORS.grid }, ticks: { color: COLORS.text }, title: { display: true, text: 'BPM drift (2nd half - 1st half)', color: COLORS.text } }
        },
        plugins: this.defaultPlugins('Heart Rate Drift (Last 50 Runs)')
      }
    });
  },

  // ---- VOLUME TAB ----
  renderWeeklyMileage(data, unit) {
    const factor = unit === 'km' ? 1.60934 : 1;
    const label = unit === 'km' ? 'km' : 'miles';
    return this.create('chart-weekly-distance', {
      type: 'bar',
      data: {
        labels: data.map(d => d.week),
        datasets: [{
          label: `Weekly ${label}`,
          data: data.map(d => +(d.distance * factor).toFixed(2)),
          backgroundColor: COLORS.accent + '99',
          borderColor: COLORS.accent,
          borderWidth: 1,
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { grid: { color: COLORS.grid }, ticks: { color: COLORS.text, maxRotation: 45, maxTicksLimit: 20 } },
          y: { grid: { color: COLORS.grid }, ticks: { color: COLORS.text }, title: { display: true, text: label, color: COLORS.text } }
        },
        plugins: this.defaultPlugins('Weekly Mileage')
      }
    });
  },

  renderMonthlyMileage(data, unit) {
    const factor = unit === 'km' ? 1.60934 : 1;
    const label = unit === 'km' ? 'km' : 'miles';
    return this.create('chart-monthly-distance', {
      type: 'bar',
      data: {
        labels: data.map(d => d.month),
        datasets: [{
          label: `Monthly ${label}`,
          data: data.map(d => +(d.distance * factor).toFixed(2)),
          backgroundColor: COLORS.secondary + '99',
          borderColor: COLORS.secondary,
          borderWidth: 1,
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { grid: { color: COLORS.grid }, ticks: { color: COLORS.text, maxRotation: 45 } },
          y: { grid: { color: COLORS.grid }, ticks: { color: COLORS.text }, title: { display: true, text: label, color: COLORS.text } }
        },
        plugins: this.defaultPlugins('Monthly Mileage')
      }
    });
  },

  renderCumulativeDistance(data, unit) {
    const factor = unit === 'km' ? 1.60934 : 1;
    const label = unit === 'km' ? 'km' : 'miles';
    return this.create('chart-cumulative', {
      type: 'line',
      data: {
        datasets: [{
          label: `Cumulative ${label}`,
          data: data.map(d => ({ x: d.date, y: +(d.cumulative * factor).toFixed(1) })),
          borderColor: COLORS.accent,
          backgroundColor: COLORS.accentLight,
          borderWidth: 2,
          pointRadius: 0,
          fill: true,
          tension: 0.2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: this.commonScales('', label),
        plugins: this.defaultPlugins('Cumulative Distance')
      }
    });
  },

  // ---- CALORIES TAB ----
  renderCaloriesPerRun(data) {
    return this.create('chart-cal-run', {
      type: 'line',
      data: {
        datasets: [{
          label: 'Calories',
          data: data.map(d => ({ x: d.date, y: Math.round(d.calories) })),
          borderColor: COLORS.tertiary,
          backgroundColor: 'rgba(245, 158, 11, 0.15)',
          borderWidth: 1.5,
          pointRadius: 2,
          fill: true,
          tension: 0.3
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: this.commonScales('', 'kcal'),
        plugins: this.defaultPlugins('Calories Per Run')
      }
    });
  },

  renderCalPerMile(data, unit) {
    const factor = unit === 'km' ? 1.60934 : 1;
    const label = unit === 'km' ? 'kcal/km' : 'kcal/mi';
    const valid = data.filter(d => d.calPerMile);
    return this.create('chart-cal-mile', {
      type: 'line',
      data: {
        datasets: [{
          label: label,
          data: valid.map(d => ({ x: d.date, y: +(d.calPerMile / factor).toFixed(1) })),
          borderColor: COLORS.zones[3],
          borderWidth: 1.5,
          pointRadius: 2,
          fill: false,
          tension: 0.3
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: this.commonScales('', label),
        plugins: this.defaultPlugins('Calorie Efficiency')
      }
    });
  },

  renderWeeklyCalories(data) {
    return this.create('chart-weekly-cal', {
      type: 'bar',
      data: {
        labels: data.map(d => d.week),
        datasets: [{
          label: 'Weekly Calories',
          data: data.map(d => Math.round(d.calories)),
          backgroundColor: COLORS.tertiary + '99',
          borderColor: COLORS.tertiary,
          borderWidth: 1,
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { grid: { color: COLORS.grid }, ticks: { color: COLORS.text, maxRotation: 45, maxTicksLimit: 20 } },
          y: { grid: { color: COLORS.grid }, ticks: { color: COLORS.text }, title: { display: true, text: 'kcal', color: COLORS.text } }
        },
        plugins: this.defaultPlugins('Weekly Calorie Burn')
      }
    });
  },

  // ---- CONSISTENCY TAB ----
  renderRunsPerWeek(data) {
    return this.create('chart-runs-week', {
      type: 'bar',
      data: {
        labels: data.map(d => d.week),
        datasets: [{
          label: 'Runs',
          data: data.map(d => d.runs),
          backgroundColor: COLORS.accent + '99',
          borderColor: COLORS.accent,
          borderWidth: 1,
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { grid: { color: COLORS.grid }, ticks: { color: COLORS.text, maxRotation: 45, maxTicksLimit: 20 } },
          y: { grid: { color: COLORS.grid }, ticks: { color: COLORS.text, stepSize: 1 }, title: { display: true, text: 'Runs', color: COLORS.text } }
        },
        plugins: this.defaultPlugins('Runs Per Week')
      }
    });
  },

  renderDayOfWeek(data) {
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return this.create('chart-dow', {
      type: 'polarArea',
      data: {
        labels: dayNames,
        datasets: [{
          data: data,
          backgroundColor: [
            '#ef444499', '#f9731699', '#eab30899',
            '#22c55e99', '#3b82f699', '#6366f199', '#a855f799'
          ],
          borderColor: [
            '#ef4444', '#f97316', '#eab308',
            '#22c55e', '#3b82f6', '#6366f1', '#a855f7'
          ],
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          r: {
            grid: { color: COLORS.grid },
            ticks: { color: COLORS.text, stepSize: 1, backdropColor: 'transparent' },
            pointLabels: { color: COLORS.white, font: { size: 13 } }
          }
        },
        plugins: this.defaultPlugins('Runs by Day of Week')
      }
    });
  },

  renderHeatmap(heatmapData) {
    const el = document.getElementById('heatmap');
    if (!el) return;
    el.innerHTML = '';

    const now = new Date();
    const yearAgo = new Date(now);
    yearAgo.setFullYear(yearAgo.getFullYear() - 1);

    const container = document.createElement('div');
    container.className = 'heatmap-container';

    const monthLabels = document.createElement('div');
    monthLabels.className = 'heatmap-months';
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    const grid = document.createElement('div');
    grid.className = 'heatmap-grid';

    const dayLabels = ['', 'Mon', '', 'Wed', '', 'Fri', ''];
    const dayLabelCol = document.createElement('div');
    dayLabelCol.className = 'heatmap-day-labels';
    dayLabels.forEach(label => {
      const d = document.createElement('div');
      d.className = 'heatmap-day-label';
      d.textContent = label;
      dayLabelCol.appendChild(d);
    });
    grid.appendChild(dayLabelCol);

    let currentMonth = -1;
    const d = new Date(yearAgo);
    d.setDate(d.getDate() - d.getDay());

    while (d <= now) {
      const week = document.createElement('div');
      week.className = 'heatmap-week';

      for (let day = 0; day < 7; day++) {
        const cell = document.createElement('div');
        const dateKey = d.toISOString().slice(0, 10);
        const count = heatmapData[dateKey] || 0;

        cell.className = 'heatmap-cell';
        if (d > now || d < yearAgo) {
          cell.classList.add('heatmap-empty');
        } else if (count === 0) {
          cell.classList.add('heatmap-0');
        } else if (count === 1) {
          cell.classList.add('heatmap-1');
        } else if (count === 2) {
          cell.classList.add('heatmap-2');
        } else {
          cell.classList.add('heatmap-3');
        }

        cell.title = `${dateKey}: ${count} run${count !== 1 ? 's' : ''}`;
        week.appendChild(cell);
        d.setDate(d.getDate() + 1);
      }

      grid.appendChild(week);

      if (d.getMonth() !== currentMonth) {
        currentMonth = d.getMonth();
      }
    }

    container.appendChild(grid);
    el.appendChild(container);
  },

  renderHourDistribution(data) {
    const labels = data.map((_, i) => {
      const h = i % 12 || 12;
      return `${h}${i < 12 ? 'a' : 'p'}`;
    });
    return this.create('chart-hour', {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Runs',
          data,
          backgroundColor: COLORS.secondary + '99',
          borderColor: COLORS.secondary,
          borderWidth: 1,
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { grid: { color: COLORS.grid }, ticks: { color: COLORS.text } },
          y: { grid: { color: COLORS.grid }, ticks: { color: COLORS.text, stepSize: 1 }, title: { display: true, text: 'Runs', color: COLORS.text } }
        },
        plugins: this.defaultPlugins('Time of Day Distribution')
      }
    });
  },

  // ---- PER-RUN TAB ----
  renderCadence(data) {
    return this.create('chart-cadence', {
      type: 'line',
      data: {
        datasets: [{
          label: 'Cadence (steps/min)',
          data: data.map(d => ({ x: d.date, y: d.cadence })),
          borderColor: COLORS.secondary,
          backgroundColor: COLORS.secondaryLight,
          borderWidth: 1.5,
          pointRadius: 2,
          fill: true,
          tension: 0.3
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: this.commonScales('', 'steps/min'),
        plugins: this.defaultPlugins('Cadence Over Time')
      }
    });
  },

  renderPaceVsHR(data) {
    return this.create('chart-pace-hr', {
      type: 'scatter',
      data: {
        datasets: [{
          label: 'Pace vs Avg HR',
          data: data,
          backgroundColor: COLORS.accent + '99',
          borderColor: COLORS.accent,
          borderWidth: 1,
          pointRadius: 4,
          pointHoverRadius: 7
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            reverse: true,
            grid: { color: COLORS.grid },
            ticks: { color: COLORS.text, callback: v => formatPace(v) },
            title: { display: true, text: 'Pace (faster →)', color: COLORS.text }
          },
          y: {
            grid: { color: COLORS.grid },
            ticks: { color: COLORS.text },
            title: { display: true, text: 'Avg Heart Rate (bpm)', color: COLORS.text }
          }
        },
        plugins: {
          ...this.defaultPlugins('Pace vs Heart Rate'),
          tooltip: {
            ...this.defaultPlugins('').tooltip,
            callbacks: {
              label: ctx => `Pace: ${formatPace(ctx.parsed.x)}, HR: ${ctx.parsed.y} bpm`
            }
          }
        }
      }
    });
  },

  renderDistanceVsCal(data) {
    return this.create('chart-dist-cal', {
      type: 'scatter',
      data: {
        datasets: [{
          label: 'Distance vs Calories',
          data: data,
          backgroundColor: COLORS.tertiary + '99',
          borderColor: COLORS.tertiary,
          borderWidth: 1,
          pointRadius: 4,
          pointHoverRadius: 7
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            grid: { color: COLORS.grid },
            ticks: { color: COLORS.text },
            title: { display: true, text: 'Distance (mi)', color: COLORS.text }
          },
          y: {
            grid: { color: COLORS.grid },
            ticks: { color: COLORS.text },
            title: { display: true, text: 'Calories (kcal)', color: COLORS.text }
          }
        },
        plugins: this.defaultPlugins('Distance vs Calories')
      }
    });
  }
};

function formatPace(decimalMinutes) {
  if (!decimalMinutes || decimalMinutes <= 0) return '--:--';
  const mins = Math.floor(decimalMinutes);
  const secs = Math.round((decimalMinutes - mins) * 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatDuration(minutes) {
  if (!minutes) return '--';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
