// Data analysis module: computes all metrics from parsed workout data

const Analyzer = {

  computeSummary(workouts) {
    if (workouts.length === 0) {
      return { totalRuns: 0, totalDistance: 0, totalTime: 0, avgPace: 0, totalCalories: 0, currentStreak: 0 };
    }
    const totalDistance = workouts.reduce((s, w) => s + (w.totalDistance || 0), 0);
    const totalTime = workouts.reduce((s, w) => s + (w.duration || 0), 0);
    const totalCalories = workouts.reduce((s, w) => s + (w.totalEnergyBurned || 0), 0);
    const avgPace = totalDistance > 0 ? totalTime / totalDistance : 0;
    return {
      totalRuns: workouts.length,
      totalDistance,
      totalTime,
      avgPace,
      totalCalories,
      currentStreak: this.computeCurrentStreak(workouts),
      indoorRuns: workouts.filter(w => w.isIndoor).length,
      outdoorRuns: workouts.filter(w => !w.isIndoor).length
    };
  },

  computeCurrentStreak(workouts) {
    const days = new Set(workouts.map(w => new Date(w.startDate).toISOString().slice(0, 10)));
    const sortedDays = [...days].sort().reverse();
    if (sortedDays.length === 0) return 0;

    // Count consecutive weeks with at least one run
    let streak = 0;
    const today = new Date();
    const getWeekKey = (d) => {
      const date = new Date(d);
      const jan1 = new Date(date.getFullYear(), 0, 1);
      const weekNum = Math.ceil(((date - jan1) / 86400000 + jan1.getDay() + 1) / 7);
      return `${date.getFullYear()}-W${weekNum}`;
    };

    const weeks = new Set(sortedDays.map(d => getWeekKey(d)));
    const currentWeek = getWeekKey(today.toISOString().slice(0, 10));

    let checkWeek = new Date(today);
    while (true) {
      const wk = getWeekKey(checkWeek.toISOString().slice(0, 10));
      if (weeks.has(wk)) {
        streak++;
        checkWeek.setDate(checkWeek.getDate() - 7);
      } else {
        break;
      }
    }
    return streak;
  },

  computePaceData(workouts) {
    const paceRuns = workouts
      .filter(w => w.pace && w.pace > 0 && w.pace < 30)
      .map(w => ({ date: w.startDate, pace: w.pace, distance: w.totalDistance, duration: w.duration }))
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    // Rolling averages
    for (let i = 0; i < paceRuns.length; i++) {
      const d = new Date(paceRuns[i].date);
      const d7 = new Date(d - 7 * 86400000);
      const d30 = new Date(d - 30 * 86400000);

      const last7 = paceRuns.filter(r => {
        const rd = new Date(r.date);
        return rd >= d7 && rd <= d;
      });
      const last30 = paceRuns.filter(r => {
        const rd = new Date(r.date);
        return rd >= d30 && rd <= d;
      });

      paceRuns[i].rolling7 = last7.reduce((s, r) => s + r.pace, 0) / last7.length;
      paceRuns[i].rolling30 = last30.reduce((s, r) => s + r.pace, 0) / last30.length;
    }

    return paceRuns;
  },

  computePersonalRecords(workouts) {
    const valid = workouts.filter(w => w.pace && w.pace > 0);
    if (valid.length === 0) return {};

    const fastestPace = valid.reduce((best, w) => w.pace < best.pace ? w : best, valid[0]);
    const longestRun = valid.reduce((best, w) => (w.totalDistance || 0) > (best.totalDistance || 0) ? w : best, valid[0]);
    const longestDuration = valid.reduce((best, w) => (w.duration || 0) > (best.duration || 0) ? w : best, valid[0]);
    const mostCalories = valid.reduce((best, w) => (w.totalEnergyBurned || 0) > (best.totalEnergyBurned || 0) ? w : best, valid[0]);

    return {
      fastestPace: { value: fastestPace.pace, date: fastestPace.startDate },
      longestDistance: { value: longestRun.totalDistance, date: longestRun.startDate },
      longestDuration: { value: longestDuration.duration, date: longestDuration.startDate },
      mostCalories: { value: mostCalories.totalEnergyBurned, date: mostCalories.startDate }
    };
  },

  computeHRZones(workouts, maxHR) {
    const zones = [
      { name: 'Zone 1 (Recovery)', min: 0.50, max: 0.60, color: '#3b82f6' },
      { name: 'Zone 2 (Aerobic)', min: 0.60, max: 0.70, color: '#22c55e' },
      { name: 'Zone 3 (Tempo)', min: 0.70, max: 0.80, color: '#eab308' },
      { name: 'Zone 4 (Threshold)', min: 0.80, max: 0.90, color: '#f97316' },
      { name: 'Zone 5 (Max)', min: 0.90, max: 1.00, color: '#ef4444' }
    ];

    const perWorkout = workouts
      .filter(w => w.hrSamples && w.hrSamples.length > 0)
      .sort((a, b) => new Date(a.startDate) - new Date(b.startDate))
      .map(w => {
        const zoneTimes = zones.map(() => 0);
        const samples = w.hrSamples;

        for (let i = 0; i < samples.length; i++) {
          const hr = samples[i].value;
          const pct = hr / maxHR;
          const duration = i < samples.length - 1
            ? (samples[i + 1].ts - samples[i].ts) / 60000
            : 0.5;

          for (let z = zones.length - 1; z >= 0; z--) {
            if (pct >= zones[z].min) {
              zoneTimes[z] += duration;
              break;
            }
          }
        }

        return {
          date: w.startDate,
          zoneTimes,
          avgHR: w.statistics?.avgHR || null,
          maxHR: w.statistics?.maxHR || null
        };
      });

    // HR drift per workout (first half avg vs second half avg)
    const hrDrift = workouts
      .filter(w => w.hrSamples && w.hrSamples.length >= 10)
      .sort((a, b) => new Date(a.startDate) - new Date(b.startDate))
      .map(w => {
        const mid = Math.floor(w.hrSamples.length / 2);
        const firstHalf = w.hrSamples.slice(0, mid);
        const secondHalf = w.hrSamples.slice(mid);
        const avgFirst = firstHalf.reduce((s, h) => s + h.value, 0) / firstHalf.length;
        const avgSecond = secondHalf.reduce((s, h) => s + h.value, 0) / secondHalf.length;
        return {
          date: w.startDate,
          drift: avgSecond - avgFirst,
          driftPct: ((avgSecond - avgFirst) / avgFirst) * 100
        };
      });

    return { zones, perWorkout, hrDrift };
  },

  computeHROverTime(workouts) {
    return workouts
      .filter(w => w.statistics?.avgHR)
      .sort((a, b) => new Date(a.startDate) - new Date(b.startDate))
      .map(w => ({
        date: w.startDate,
        avgHR: w.statistics.avgHR,
        maxHR: w.statistics.maxHR,
        minHR: w.statistics.minHR
      }));
  },

  computeWeeklyVolume(workouts) {
    const weeks = {};
    for (const w of workouts) {
      const d = new Date(w.startDate);
      const dayOfWeek = d.getDay();
      const monday = new Date(d);
      monday.setDate(d.getDate() - ((dayOfWeek + 6) % 7));
      const key = monday.toISOString().slice(0, 10);

      if (!weeks[key]) weeks[key] = { week: key, distance: 0, duration: 0, calories: 0, runs: 0 };
      weeks[key].distance += w.totalDistance || 0;
      weeks[key].duration += w.duration || 0;
      weeks[key].calories += w.totalEnergyBurned || 0;
      weeks[key].runs++;
    }
    return Object.values(weeks).sort((a, b) => a.week.localeCompare(b.week));
  },

  computeMonthlyVolume(workouts) {
    const months = {};
    for (const w of workouts) {
      const key = new Date(w.startDate).toISOString().slice(0, 7);
      if (!months[key]) months[key] = { month: key, distance: 0, duration: 0, calories: 0, runs: 0 };
      months[key].distance += w.totalDistance || 0;
      months[key].duration += w.duration || 0;
      months[key].calories += w.totalEnergyBurned || 0;
      months[key].runs++;
    }
    return Object.values(months).sort((a, b) => a.month.localeCompare(b.month));
  },

  computeCumulativeDistance(workouts) {
    const sorted = [...workouts]
      .filter(w => w.totalDistance > 0)
      .sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
    let cumulative = 0;
    return sorted.map(w => {
      cumulative += w.totalDistance;
      return { date: w.startDate, cumulative };
    });
  },

  computeCalorieData(workouts) {
    return workouts
      .filter(w => w.totalEnergyBurned > 0)
      .sort((a, b) => new Date(a.startDate) - new Date(b.startDate))
      .map(w => ({
        date: w.startDate,
        calories: w.totalEnergyBurned,
        calPerMile: w.totalDistance > 0 ? w.totalEnergyBurned / w.totalDistance : null
      }));
  },

  computeConsistency(workouts) {
    const dayMap = {};
    for (const w of workouts) {
      const key = new Date(w.startDate).toISOString().slice(0, 10);
      dayMap[key] = (dayMap[key] || 0) + 1;
    }

    // Day of week distribution (0=Sun, 6=Sat)
    const dayOfWeek = [0, 0, 0, 0, 0, 0, 0];
    for (const w of workouts) {
      dayOfWeek[new Date(w.startDate).getDay()]++;
    }

    // Calendar heatmap data (last 12 months)
    const now = new Date();
    const yearAgo = new Date(now);
    yearAgo.setFullYear(yearAgo.getFullYear() - 1);
    const heatmap = {};
    for (const [day, count] of Object.entries(dayMap)) {
      if (new Date(day) >= yearAgo) {
        heatmap[day] = count;
      }
    }

    // Runs per week
    const weekly = this.computeWeeklyVolume(workouts);

    // Time of day distribution
    const hourDist = new Array(24).fill(0);
    for (const w of workouts) {
      hourDist[new Date(w.startDate).getHours()]++;
    }

    return { dayOfWeek, heatmap, weeklyRuns: weekly.map(w => ({ week: w.week, runs: w.runs })), hourDist };
  },

  computeCadence(workouts) {
    return workouts
      .filter(w => w.cadence && w.cadence > 0)
      .sort((a, b) => new Date(a.startDate) - new Date(b.startDate))
      .map(w => ({
        date: w.startDate,
        cadence: w.cadence
      }));
  },

  computeCorrelations(workouts) {
    const valid = workouts.filter(w => w.pace > 0 && w.statistics?.avgHR);
    return {
      paceVsHR: valid.map(w => ({ x: w.pace, y: w.statistics.avgHR, date: w.startDate })),
      distanceVsCal: workouts
        .filter(w => w.totalDistance > 0 && w.totalEnergyBurned > 0)
        .map(w => ({ x: w.totalDistance, y: w.totalEnergyBurned, date: w.startDate }))
    };
  },

  computeRunTable(workouts, unit) {
    const factor = unit === 'km' ? 1.60934 : 1;
    return workouts
      .sort((a, b) => new Date(b.startDate) - new Date(a.startDate))
      .map(w => ({
        date: w.startDate,
        distance: (w.totalDistance || 0) * factor,
        duration: w.duration || 0,
        pace: w.pace ? w.pace / factor : null,
        avgHR: w.statistics?.avgHR || null,
        maxHR: w.statistics?.maxHR || null,
        calories: w.totalEnergyBurned || 0,
        cadence: w.cadence,
        isIndoor: w.isIndoor
      }));
  },

  runAll(workouts, settings) {
    const maxHR = settings.maxHR || (220 - (settings.age || 30));
    let filtered = workouts;
    if (settings.dateRange?.start) {
      filtered = filtered.filter(w => new Date(w.startDate) >= new Date(settings.dateRange.start));
    }
    if (settings.dateRange?.end) {
      filtered = filtered.filter(w => new Date(w.startDate) <= new Date(settings.dateRange.end));
    }
    if (settings.showIndoorOnly) {
      filtered = filtered.filter(w => w.isIndoor);
    }

    return {
      summary: this.computeSummary(filtered),
      pace: this.computePaceData(filtered),
      personalRecords: this.computePersonalRecords(filtered),
      hrZones: this.computeHRZones(filtered, maxHR),
      hrOverTime: this.computeHROverTime(filtered),
      weeklyVolume: this.computeWeeklyVolume(filtered),
      monthlyVolume: this.computeMonthlyVolume(filtered),
      cumulativeDistance: this.computeCumulativeDistance(filtered),
      calories: this.computeCalorieData(filtered),
      consistency: this.computeConsistency(filtered),
      cadence: this.computeCadence(filtered),
      correlations: this.computeCorrelations(filtered),
      runTable: this.computeRunTable(filtered, settings.unit || 'mi'),
      settings: { ...settings, maxHR }
    };
  }
};
