// Web Worker: Streaming Apple Health XML parser
// Supports fast mode (workouts only) and detailed mode (+ HR samples, steps)

const CHUNK_SIZE = 8 * 1024 * 1024; // 8MB chunks for better throughput

let workouts = [];
let hrRecords = [];
let stepRecords = [];
let parseMode = 'fast'; // 'fast' = workouts only, 'detailed' = + HR/steps

self.onmessage = async function (e) {
  if (e.data.type === 'parse') {
    try {
      parseMode = e.data.mode || 'fast';
      await parseFile(e.data.file);
      const enriched = correlateData(workouts, hrRecords, stepRecords);
      self.postMessage({ type: 'complete', data: enriched });
    } catch (err) {
      self.postMessage({ type: 'error', message: err.message || String(err) });
    }
  }
};

function parseHealthDate(str) {
  if (!str) return null;
  const m = str.match(/(\d{4}-\d{2}-\d{2})\s(\d{2}:\d{2}:\d{2})\s([+-]\d{2})(\d{2})/);
  if (!m) return new Date(str);
  return new Date(`${m[1]}T${m[2]}${m[3]}:${m[4]}`);
}

function attr(text, name) {
  const m = text.match(new RegExp(name + '="([^"]*)"'));
  return m ? m[1] : null;
}

function attrFloat(text, name) {
  const v = attr(text, name);
  return v !== null ? parseFloat(v) : null;
}

function readChunk(file, start, size) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const blob = file.slice(start, Math.min(start + size, file.size));
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

let parseState = { inWorkout: false };

async function parseFile(file) {
  workouts = [];
  hrRecords = [];
  stepRecords = [];
  parseState.inWorkout = false;

  const totalSize = file.size;
  let offset = 0;
  let buffer = '';
  let workoutBuf = '';

  while (offset < totalSize) {
    const chunkSize = Math.min(CHUNK_SIZE, totalSize - offset);
    const chunk = await readChunk(file, offset, chunkSize);
    offset += chunkSize;

    if (parseState.inWorkout) {
      workoutBuf += chunk;
      const endIdx = workoutBuf.indexOf('</Workout>');
      if (endIdx !== -1) {
        processWorkoutBlock(workoutBuf.substring(0, endIdx + 10));
        buffer = workoutBuf.substring(endIdx + 10);
        workoutBuf = '';
        parseState.inWorkout = false;
      } else {
        reportProgress(offset, totalSize);
        continue;
      }
    } else {
      buffer += chunk;
    }

    buffer = processBuffer(buffer);

    if (parseState.inWorkout) {
      workoutBuf = buffer;
      buffer = '';
    }

    reportProgress(offset, totalSize);
  }

  if (buffer.length > 0 && !parseState.inWorkout) {
    processBuffer(buffer);
  }
  if (parseState.inWorkout && workoutBuf.length > 0) {
    processWorkoutBlock(workoutBuf);
  }
}

function reportProgress(offset, total) {
  self.postMessage({
    type: 'progress',
    value: Math.min(offset / total, 1),
    stats: {
      workouts: workouts.length,
      hrRecords: hrRecords.length,
      stepRecords: stepRecords.length
    }
  });
}

function processBuffer(text) {
  let pos = 0;

  while (pos < text.length) {
    const searchText = text.substring(pos);

    if (parseMode === 'fast') {
      // Fast mode: only look for Workout elements
      const iWork = searchText.indexOf('workoutActivityType="HKWorkoutActivityTypeRunning"');
      if (iWork === -1) {
        return text.substring(Math.max(0, text.length - 300));
      }

      const absIdx = pos + iWork;
      let elemStart = text.lastIndexOf('<', absIdx);
      if (elemStart === -1 || elemStart < pos) { pos = absIdx + 1; continue; }

      const endIdx = text.indexOf('</Workout>', absIdx);
      if (endIdx !== -1) {
        processWorkoutBlock(text.substring(elemStart, endIdx + 10));
        pos = endIdx + 10;
      } else {
        parseState.inWorkout = true;
        return text.substring(elemStart);
      }
    } else {
      // Detailed mode: look for workouts, HR records, and step records
      const iHR = searchText.indexOf('type="HKQuantityTypeIdentifierHeartRate"');
      const iStep = searchText.indexOf('type="HKQuantityTypeIdentifierStepCount"');
      const iWork = searchText.indexOf('workoutActivityType="HKWorkoutActivityTypeRunning"');

      const candidates = [];
      if (iHR !== -1) candidates.push({ idx: iHR, type: 'hr' });
      if (iStep !== -1) candidates.push({ idx: iStep, type: 'step' });
      if (iWork !== -1) candidates.push({ idx: iWork, type: 'workout' });

      if (candidates.length === 0) {
        return text.substring(Math.max(0, text.length - 300));
      }

      candidates.sort((a, b) => a.idx - b.idx);
      const nearest = candidates[0];
      const absIdx = pos + nearest.idx;

      let elemStart = text.lastIndexOf('<', absIdx);
      if (elemStart === -1 || elemStart < pos) { pos = absIdx + 1; continue; }

      if (nearest.type === 'workout') {
        const endIdx = text.indexOf('</Workout>', absIdx);
        if (endIdx !== -1) {
          processWorkoutBlock(text.substring(elemStart, endIdx + 10));
          pos = endIdx + 10;
        } else {
          parseState.inWorkout = true;
          return text.substring(elemStart);
        }
      } else {
        let endIdx = text.indexOf('/>', absIdx);
        const closeIdx = text.indexOf('</Record>', absIdx);

        if (endIdx === -1 && closeIdx === -1) {
          return text.substring(elemStart);
        }

        let recordEnd;
        if (endIdx !== -1 && (closeIdx === -1 || endIdx < closeIdx)) {
          recordEnd = endIdx + 2;
        } else {
          recordEnd = closeIdx + 9;
        }

        const recordXml = text.substring(elemStart, recordEnd);

        if (nearest.type === 'hr') {
          const val = attrFloat(recordXml, 'value');
          const date = attr(recordXml, 'startDate');
          if (val !== null && date) {
            hrRecords.push({ ts: parseHealthDate(date).getTime(), value: val });
          }
        } else {
          const val = attrFloat(recordXml, 'value');
          const start = attr(recordXml, 'startDate');
          const end = attr(recordXml, 'endDate');
          if (val !== null && start && end) {
            stepRecords.push({
              tsStart: parseHealthDate(start).getTime(),
              tsEnd: parseHealthDate(end).getTime(),
              value: val
            });
          }
        }

        pos = recordEnd;
      }
    }
  }

  return '';
}

function processWorkoutBlock(xml) {
  const wo = {
    startDate: parseHealthDate(attr(xml, 'startDate')),
    endDate: parseHealthDate(attr(xml, 'endDate')),
    duration: attrFloat(xml, 'duration'),
    durationUnit: attr(xml, 'durationUnit') || 'min',
    totalDistance: attrFloat(xml, 'totalDistance'),
    totalDistanceUnit: attr(xml, 'totalDistanceUnit') || 'mi',
    totalEnergyBurned: attrFloat(xml, 'totalEnergyBurned'),
    totalEnergyBurnedUnit: attr(xml, 'totalEnergyBurnedUnit') || 'Cal',
    sourceName: attr(xml, 'sourceName') || '',
    isIndoor: false,
    statistics: {},
    events: [],
    hrSamples: [],
    stepSamples: [],
    cadence: null
  };

  if (!wo.startDate || !wo.endDate) return;

  // Normalize duration to minutes
  if (wo.durationUnit === 's' || wo.durationUnit === 'sec') {
    wo.duration = wo.duration / 60;
  } else if (wo.durationUnit === 'hr' || wo.durationUnit === 'hour') {
    wo.duration = wo.duration * 60;
  }

  // Indoor detection
  const indoorMatch = xml.match(/key="HKIndoorWorkout"\s+value="(\d)"/);
  if (indoorMatch) {
    wo.isIndoor = indoorMatch[1] === '1';
  }

  // Extract ALL WorkoutStatistics
  const statsRegex = /<WorkoutStatistics[^>]+>/g;
  let statsMatch;
  while ((statsMatch = statsRegex.exec(xml)) !== null) {
    const block = statsMatch[0];
    const statType = attr(block, 'type');

    if (statType === 'HKQuantityTypeIdentifierHeartRate') {
      wo.statistics.avgHR = attrFloat(block, 'average');
      wo.statistics.minHR = attrFloat(block, 'minimum');
      wo.statistics.maxHR = attrFloat(block, 'maximum');
    } else if (statType === 'HKQuantityTypeIdentifierDistanceWalkingRunning') {
      const distSum = attrFloat(block, 'sum');
      const distUnit = attr(block, 'unit');
      if (distSum !== null) {
        wo.statistics.distance = distSum;
        wo.statistics.distanceUnit = distUnit || 'mi';
      }
    } else if (statType === 'HKQuantityTypeIdentifierActiveEnergyBurned') {
      const calSum = attrFloat(block, 'sum');
      if (calSum !== null) {
        wo.statistics.activeCalories = calSum;
      }
    } else if (statType === 'HKQuantityTypeIdentifierRunningSpeed') {
      wo.statistics.avgSpeed = attrFloat(block, 'average');
      wo.statistics.maxSpeed = attrFloat(block, 'maximum');
    }
  }

  // Use WorkoutStatistics distance as fallback (or primary) for totalDistance
  if ((!wo.totalDistance || wo.totalDistance === 0) && wo.statistics.distance) {
    wo.totalDistance = wo.statistics.distance;
    wo.totalDistanceUnit = wo.statistics.distanceUnit || 'mi';
  }

  // Normalize distance to miles
  if (wo.totalDistanceUnit === 'km') {
    wo.totalDistance = wo.totalDistance * 0.621371;
  } else if (wo.totalDistanceUnit === 'm') {
    wo.totalDistance = wo.totalDistance * 0.000621371;
  }

  // Normalize energy to kcal
  if (wo.totalEnergyBurnedUnit === 'kJ') {
    wo.totalEnergyBurned = wo.totalEnergyBurned / 4.184;
  }

  // Use active calories as fallback
  if ((!wo.totalEnergyBurned || wo.totalEnergyBurned === 0) && wo.statistics.activeCalories) {
    wo.totalEnergyBurned = wo.statistics.activeCalories;
  }

  // WorkoutEvents (pause/resume)
  const eventRegex = /<WorkoutEvent\s+type="([^"]*)"[^>]*date(?:Interval)?="([^"]*)"/g;
  let eventMatch;
  while ((eventMatch = eventRegex.exec(xml)) !== null) {
    wo.events.push({
      type: eventMatch[1],
      date: parseHealthDate(eventMatch[2])
    });
  }

  // Compute pace (min/mile) from duration and distance
  if (wo.totalDistance > 0 && wo.duration > 0) {
    wo.pace = wo.duration / wo.totalDistance;
  }

  workouts.push(wo);
}

function correlateData(workouts, hrRecords, stepRecords) {
  if (workouts.length === 0) return workouts;

  workouts.sort((a, b) => a.startDate - b.startDate);

  // In detailed mode, correlate HR and step data with workouts
  if (parseMode === 'detailed' && (hrRecords.length > 0 || stepRecords.length > 0)) {
    hrRecords.sort((a, b) => a.ts - b.ts);
    stepRecords.sort((a, b) => a.tsStart - b.tsStart);

    for (const wo of workouts) {
      const startTs = wo.startDate.getTime();
      const endTs = wo.endDate.getTime();

      // Binary search for HR records in this workout window
      let lo = bsearch(hrRecords, startTs, r => r.ts);
      for (let i = lo; i < hrRecords.length && hrRecords[i].ts <= endTs; i++) {
        if (hrRecords[i].ts >= startTs) {
          wo.hrSamples.push({ ts: hrRecords[i].ts, value: hrRecords[i].value });
        }
      }

      if (wo.hrSamples.length > 0) {
        const vals = wo.hrSamples.map(s => s.value);
        if (!wo.statistics.avgHR) wo.statistics.avgHR = vals.reduce((a, b) => a + b, 0) / vals.length;
        if (!wo.statistics.maxHR) wo.statistics.maxHR = Math.max(...vals);
        if (!wo.statistics.minHR) wo.statistics.minHR = Math.min(...vals);
      }

      // Steps during workout -> cadence
      let totalSteps = 0;
      let lo2 = bsearch(stepRecords, startTs, r => r.tsStart);
      for (let i = lo2; i < stepRecords.length && stepRecords[i].tsStart <= endTs; i++) {
        if (stepRecords[i].tsEnd >= startTs) {
          const overlapStart = Math.max(stepRecords[i].tsStart, startTs);
          const overlapEnd = Math.min(stepRecords[i].tsEnd, endTs);
          const recordDuration = stepRecords[i].tsEnd - stepRecords[i].tsStart;
          if (recordDuration > 0) {
            totalSteps += stepRecords[i].value * ((overlapEnd - overlapStart) / recordDuration);
          }
        }
      }
      if (totalSteps > 0 && wo.duration > 0) {
        wo.cadence = Math.round(totalSteps / wo.duration);
      }
    }
  }

  // Serialize dates for transfer
  return workouts.map(wo => ({
    ...wo,
    startDate: wo.startDate.toISOString(),
    endDate: wo.endDate.toISOString(),
    hrSamples: wo.hrSamples.map(s => ({ ts: s.ts, value: s.value })),
    events: wo.events.map(ev => ({
      type: ev.type,
      date: ev.date ? ev.date.toISOString() : null
    }))
  }));
}

function bsearch(arr, target, keyFn) {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (keyFn(arr[mid]) < target) lo = mid + 1;
    else hi = mid;
  }
  return Math.max(0, lo - 1);
}
