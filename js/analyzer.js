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
    let streak = 0;
    const today = new Date();
    const getWeekKey = (d) => {
      const date = new Date(d);
      const jan1 = new Date(date.getFullYear(), 0, 1);
      const weekNum = Math.ceil(((date - jan1) / 86400000 + jan1.getDay() + 1) / 7);
      return `${date.getFullYear()}-W${weekNum}`;
    };
    const weeks = new Set(sortedDays.map(d => getWeekKey(d)));
    let checkWeek = new Date(today);
    while (true) {
      const wk = getWeekKey(checkWeek.toISOString().slice(0, 10));
      if (weeks.has(wk)) { streak++; checkWeek.setDate(checkWeek.getDate() - 7); }
      else break;
    }
    return streak;
  },

  computePaceData(workouts) {
    const paceRuns = workouts
      .filter(w => w.pace && w.pace > 0 && w.pace < 30)
      .map(w => ({ date: w.startDate, pace: w.pace, distance: w.totalDistance, duration: w.duration }))
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    for (let i = 0; i < paceRuns.length; i++) {
      const d = new Date(paceRuns[i].date);
      const d7 = new Date(d - 7 * 86400000);
      const d30 = new Date(d - 30 * 86400000);
      const last7 = paceRuns.filter(r => { const rd = new Date(r.date); return rd >= d7 && rd <= d; });
      const last30 = paceRuns.filter(r => { const rd = new Date(r.date); return rd >= d30 && rd <= d; });
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
        for (let i = 0; i < w.hrSamples.length; i++) {
          const pct = w.hrSamples[i].value / maxHR;
          const dur = i < w.hrSamples.length - 1 ? (w.hrSamples[i + 1].ts - w.hrSamples[i].ts) / 60000 : 0.5;
          for (let z = zones.length - 1; z >= 0; z--) { if (pct >= zones[z].min) { zoneTimes[z] += dur; break; } }
        }
        return { date: w.startDate, zoneTimes, avgHR: w.statistics?.avgHR || null, maxHR: w.statistics?.maxHR || null };
      });
    const hrDrift = workouts
      .filter(w => w.hrSamples && w.hrSamples.length >= 10)
      .sort((a, b) => new Date(a.startDate) - new Date(b.startDate))
      .map(w => {
        const mid = Math.floor(w.hrSamples.length / 2);
        const avgFirst = w.hrSamples.slice(0, mid).reduce((s, h) => s + h.value, 0) / mid;
        const avgSecond = w.hrSamples.slice(mid).reduce((s, h) => s + h.value, 0) / (w.hrSamples.length - mid);
        return { date: w.startDate, drift: avgSecond - avgFirst, driftPct: ((avgSecond - avgFirst) / avgFirst) * 100 };
      });
    return { zones, perWorkout, hrDrift };
  },

  computeHROverTime(workouts) {
    return workouts.filter(w => w.statistics?.avgHR)
      .sort((a, b) => new Date(a.startDate) - new Date(b.startDate))
      .map(w => ({ date: w.startDate, avgHR: w.statistics.avgHR, maxHR: w.statistics.maxHR, minHR: w.statistics.minHR }));
  },

  computeWeeklyVolume(workouts) {
    const weeks = {};
    for (const w of workouts) {
      const d = new Date(w.startDate);
      const monday = new Date(d);
      monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
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
    const sorted = [...workouts].filter(w => w.totalDistance > 0).sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
    let cum = 0;
    return sorted.map(w => { cum += w.totalDistance; return { date: w.startDate, cumulative: cum }; });
  },

  computeCalorieData(workouts) {
    return workouts.filter(w => w.totalEnergyBurned > 0)
      .sort((a, b) => new Date(a.startDate) - new Date(b.startDate))
      .map(w => ({ date: w.startDate, calories: w.totalEnergyBurned, calPerMile: w.totalDistance > 0 ? w.totalEnergyBurned / w.totalDistance : null }));
  },

  computeConsistency(workouts) {
    const dayMap = {};
    for (const w of workouts) { const key = new Date(w.startDate).toISOString().slice(0, 10); dayMap[key] = (dayMap[key] || 0) + 1; }
    const dayOfWeek = [0, 0, 0, 0, 0, 0, 0];
    for (const w of workouts) dayOfWeek[new Date(w.startDate).getDay()]++;
    const now = new Date();
    const yearAgo = new Date(now); yearAgo.setFullYear(yearAgo.getFullYear() - 1);
    const heatmap = {};
    for (const [day, count] of Object.entries(dayMap)) { if (new Date(day) >= yearAgo) heatmap[day] = count; }
    const hourDist = new Array(24).fill(0);
    for (const w of workouts) hourDist[new Date(w.startDate).getHours()]++;
    return { dayOfWeek, heatmap, weeklyRuns: this.computeWeeklyVolume(workouts).map(w => ({ week: w.week, runs: w.runs })), hourDist };
  },

  computeCadence(workouts) {
    return workouts.filter(w => w.cadence && w.cadence > 0)
      .sort((a, b) => new Date(a.startDate) - new Date(b.startDate))
      .map(w => ({ date: w.startDate, cadence: w.cadence }));
  },

  computeCorrelations(workouts) {
    return {
      paceVsHR: workouts.filter(w => w.pace > 0 && w.statistics?.avgHR).map(w => ({ x: w.pace, y: w.statistics.avgHR, date: w.startDate })),
      distanceVsCal: workouts.filter(w => w.totalDistance > 0 && w.totalEnergyBurned > 0).map(w => ({ x: w.totalDistance, y: w.totalEnergyBurned, date: w.startDate }))
    };
  },

  // ---- NEW: Run Scoring ----
  computeRunScores(workouts) {
    const sorted = [...workouts].sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
    const scores = {};

    for (let i = 0; i < sorted.length; i++) {
      const w = sorted[i];
      const d = new Date(w.startDate);
      const d30 = new Date(d - 30 * 86400000);
      const recent = sorted.filter(r => { const rd = new Date(r.startDate); return rd >= d30 && rd < d; });

      if (recent.length < 3) { scores[w.startDate] = null; continue; }

      let total = 0, count = 0;

      // Pace score (lower pace = faster = higher score)
      if (w.pace && w.pace > 0) {
        const avgPace = recent.filter(r => r.pace > 0).reduce((s, r) => s + r.pace, 0) / recent.filter(r => r.pace > 0).length;
        if (avgPace > 0) { total += clamp(5 + (avgPace - w.pace) / avgPace * 20, 1, 10); count++; }
      }

      // Duration score
      if (w.duration > 0) {
        const avgDur = recent.reduce((s, r) => s + (r.duration || 0), 0) / recent.length;
        if (avgDur > 0) { total += clamp(5 + (w.duration - avgDur) / avgDur * 10, 1, 10); count++; }
      }

      // Distance score
      if (w.totalDistance > 0) {
        const avgDist = recent.reduce((s, r) => s + (r.totalDistance || 0), 0) / recent.length;
        if (avgDist > 0) { total += clamp(5 + (w.totalDistance - avgDist) / avgDist * 10, 1, 10); count++; }
      }

      // HR efficiency: lower HR at similar pace = better
      if (w.statistics?.avgHR && w.pace > 0) {
        const hrRuns = recent.filter(r => r.statistics?.avgHR && r.pace > 0);
        if (hrRuns.length > 0) {
          const avgHR = hrRuns.reduce((s, r) => s + r.statistics.avgHR, 0) / hrRuns.length;
          total += clamp(5 + (avgHR - w.statistics.avgHR) / avgHR * 15, 1, 10);
          count++;
        }
      }

      scores[w.startDate] = count > 0 ? Math.round(total / count * 10) / 10 : null;
    }

    return scores;
  },

  // ---- NEW: Recovery Analysis ----
  computeRecovery(workouts) {
    const sorted = [...workouts].filter(w => w.pace > 0).sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
    const data = [];

    for (let i = 1; i < sorted.length; i++) {
      const restDays = Math.round((new Date(sorted[i].startDate) - new Date(sorted[i - 1].startDate)) / 86400000);
      if (restDays >= 0 && restDays <= 14) {
        data.push({ restDays, pace: sorted[i].pace, date: sorted[i].startDate, score: null });
      }
    }

    // Average pace by rest days
    const byRestDays = {};
    for (const d of data) {
      const key = d.restDays <= 5 ? d.restDays : '6+';
      if (!byRestDays[key]) byRestDays[key] = { paces: [], count: 0 };
      byRestDays[key].paces.push(d.pace);
      byRestDays[key].count++;
    }

    const avgByRest = Object.entries(byRestDays).map(([days, v]) => ({
      days,
      avgPace: v.paces.reduce((s, p) => s + p, 0) / v.paces.length,
      count: v.count
    })).sort((a, b) => {
      if (a.days === '6+') return 1;
      if (b.days === '6+') return -1;
      return +a.days - +b.days;
    });

    return { scatter: data, avgByRest };
  },

  // ---- NEW: Year-over-Year Comparison ----
  computeYoYComparison(workouts) {
    const byYearMonth = {};
    for (const w of workouts) {
      const d = new Date(w.startDate);
      const year = d.getFullYear();
      const month = d.getMonth();
      if (!byYearMonth[year]) byYearMonth[year] = new Array(12).fill(0);
      byYearMonth[year][month] += w.totalDistance || 0;
    }

    const years = Object.keys(byYearMonth).sort();
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    return { years, monthNames, data: byYearMonth };
  },

  // ---- NEW: Report Card ----
  computeReportCard(workouts) {
    const now = new Date();
    const thisMonth = now.getMonth();
    const thisYear = now.getFullYear();
    const lastMonth = thisMonth === 0 ? 11 : thisMonth - 1;
    const lastMonthYear = thisMonth === 0 ? thisYear - 1 : thisYear;

    const current = workouts.filter(w => {
      const d = new Date(w.startDate); return d.getFullYear() === thisYear && d.getMonth() === thisMonth;
    });
    const previous = workouts.filter(w => {
      const d = new Date(w.startDate); return d.getFullYear() === lastMonthYear && d.getMonth() === lastMonth;
    });

    const calc = (arr) => {
      const runs = arr.length;
      const miles = arr.reduce((s, w) => s + (w.totalDistance || 0), 0);
      const time = arr.reduce((s, w) => s + (w.duration || 0), 0);
      const paces = arr.filter(w => w.pace > 0).map(w => w.pace);
      const avgPace = paces.length > 0 ? paces.reduce((a, b) => a + b, 0) / paces.length : 0;
      const hrs = arr.filter(w => w.statistics?.avgHR).map(w => w.statistics.avgHR);
      const avgHR = hrs.length > 0 ? hrs.reduce((a, b) => a + b, 0) / hrs.length : 0;
      return { runs, miles, time, avgPace, avgHR };
    };

    const cur = calc(current);
    const prev = calc(previous);
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    return {
      currentMonth: monthNames[thisMonth],
      previousMonth: monthNames[lastMonth],
      metrics: [
        { label: 'Runs', current: cur.runs, previous: prev.runs, unit: '', higherIsBetter: true },
        { label: 'Miles', current: +cur.miles.toFixed(1), previous: +prev.miles.toFixed(1), unit: 'mi', higherIsBetter: true },
        { label: 'Time', current: Math.round(cur.time), previous: Math.round(prev.time), unit: 'min', higherIsBetter: true },
        { label: 'Avg Pace', current: cur.avgPace, previous: prev.avgPace, unit: '/mi', higherIsBetter: false, isPace: true },
        { label: 'Avg HR', current: cur.avgHR ? Math.round(cur.avgHR) : 0, previous: prev.avgHR ? Math.round(prev.avgHR) : 0, unit: 'bpm', higherIsBetter: false }
      ]
    };
  },

  // ---- NEW: Milestones ----
  computeMilestones(workouts) {
    const totalRuns = workouts.length;
    const totalMiles = workouts.reduce((s, w) => s + (w.totalDistance || 0), 0);
    const totalHours = workouts.reduce((s, w) => s + (w.duration || 0), 0) / 60;

    const milestones = [
      { category: 'Runs', icon: '🏃', levels: [50, 100, 250, 500, 1000], current: totalRuns },
      { category: 'Miles', icon: '🛣️', levels: [100, 250, 500, 1000, 2000], current: totalMiles },
      { category: 'Hours', icon: '⏱️', levels: [50, 100, 250, 500, 1000], current: totalHours }
    ];

    const badges = [];
    for (const m of milestones) {
      for (const level of m.levels) {
        const earned = m.current >= level;
        const pct = Math.min((m.current / level) * 100, 100);
        badges.push({
          label: `${level} ${m.category}`,
          icon: m.icon,
          earned,
          pct: Math.round(pct),
          current: m.category === 'Miles' ? +m.current.toFixed(1) : Math.floor(m.current),
          target: level
        });
      }
    }

    return badges;
  },

  computeRunTable(workouts, unit, scores) {
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
        isIndoor: w.isIndoor,
        score: scores?.[w.startDate] ?? null
      }));
  },

  runAll(workouts, settings) {
    const maxHR = settings.maxHR || (220 - (settings.age || 30));
    let filtered = workouts;
    if (settings.dateRange?.start) {
      filtered = filtered.filter(w => new Date(w.startDate) >= settings.dateRange.start);
    }
    if (settings.dateRange?.end) {
      filtered = filtered.filter(w => new Date(w.startDate) <= settings.dateRange.end);
    }

    const scores = this.computeRunScores(workouts);

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
      recovery: this.computeRecovery(filtered),
      yoyComparison: this.computeYoYComparison(workouts),
      reportCard: this.computeReportCard(workouts),
      milestones: this.computeMilestones(workouts),
      runTable: this.computeRunTable(filtered, settings.unit || 'mi', scores),
      scores,
      settings: { ...settings, maxHR }
    };
  }
};

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
