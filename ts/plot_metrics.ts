// TypeScript file for plotting metrics with Plotly in the browser.
// Build with: npm run build (uses esbuild) and open ts/index.html in a browser-served folder.

declare const Plotly: any;

async function loadJson(path: string): Promise<any> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.statusText}`);
  return res.json();
}

function parseData(data: any) {
  const keysMs = Object.keys(data).map(k => parseInt(k, 10)).sort((a, b) => a - b);

  const transaction_counts = keysMs.map(k => data[String(k)].transactionCount || 0);

  // collect events per timestamp (join multiple events into a single string or empty)
  const eventsPerTime: string[] = keysMs.map(k => {
    const ev = (data[String(k)] && data[String(k)].events) || [];
    if (!Array.isArray(ev)) return '';
    return ev.length ? ev.join('; ') : '';
  });

  // Collect pod names and per-time pod metrics
  const podNamesSet = new Set<string>();
  const podMetricsByTime: Array<Record<string, { cpuInMillicores: number; memoryInMebibytes: number }>> = [];

  for (const k of keysMs) {
    const entry = data[String(k)] || {};
    const cluster = entry.clusterMetrics || [];
    const clusters = Array.isArray(cluster) ? cluster : [cluster];
    const merged: Record<string, { cpuInMillicores: number; memoryInMebibytes: number }> = {};

    for (const c of clusters) {
      if (!c || typeof c !== 'object') continue;
      const pm = c.podMetrics;
      if (Array.isArray(pm)) {
        for (const pod of pm) {
          const podName = pod.podName || pod.name;
          if (!podName) continue;
          if (!merged[podName]) merged[podName] = { cpuInMillicores: 0, memoryInMebibytes: 0 };
          merged[podName].cpuInMillicores += pod.cpuInMillicores || 0;
          merged[podName].memoryInMebibytes += pod.memoryInMebibytes || 0;
          podNamesSet.add(podName);
        }
      } else if (pm && typeof pm === 'object') {
        for (const podName of Object.keys(pm)) {
          const metrics = (pm as any)[podName];
          if (!metrics || typeof metrics !== 'object') continue;
          if (!merged[podName]) merged[podName] = { cpuInMillicores: 0, memoryInMebibytes: 0 };
          merged[podName].cpuInMillicores += metrics.cpuInMillicores || 0;
          merged[podName].memoryInMebibytes += metrics.memoryInMebibytes || 0;
          podNamesSet.add(podName);
        }
      }
    }

    podMetricsByTime.push(merged);
  }

  const podNames = Array.from(podNamesSet).sort();

  const podCpuSeries: Record<string, number[]> = {};
  const podMemSeries: Record<string, number[]> = {};
  for (const pod of podNames) {
    podCpuSeries[pod] = [];
    podMemSeries[pod] = [];
  }

  for (const pm of podMetricsByTime) {
    for (const pod of podNames) {
      const m = pm[pod] || { cpuInMillicores: 0, memoryInMebibytes: 0 };
      podCpuSeries[pod].push(m.cpuInMillicores || 0);
      podMemSeries[pod].push(m.memoryInMebibytes || 0);
    }
  }

  // compute tx per sec
  const tx_per_sec: number[] = [];
  for (let i = 0; i < transaction_counts.length; i++) {
    if (i === 0) { tx_per_sec.push(0); continue; }
    const deltaTx = transaction_counts[i] - transaction_counts[i - 1];
    const deltaMs = keysMs[i] - keysMs[i - 1];
    tx_per_sec.push(deltaMs > 0 ? deltaTx / (deltaMs / 1000.0) : 0);
  }

  return { keysMs, podNames, podCpuSeries, podMemSeries, tx_per_sec, eventsPerTime };
}

function makeTracesForPods(podNames: string[], seriesMap: Record<string, number[]>, keysX: number[], keysText: string[], barWidth: number) {
  const traces: any[] = [];
  for (const pod of podNames) {
    traces.push({
      x: keysX,
      y: seriesMap[pod],
      text: keysText, // formatted elapsed string per point
      name: pod,
      type: 'bar',
      width: barWidth,
      marker: { opacity: 0.8 },
      // show pod name and formatted elapsed time in tooltip
      hovertemplate: '%{fullData.name}<br>Elapsed: %{text}<br>%{y} <extra></extra>'
    });
  }
  return traces;
}

// helper to format seconds into human-friendly elapsed string
function formatDuration(seconds: number) {
  if (!isFinite(seconds)) return '';
  const s = Math.round(seconds);
  if (s < 60) return s + 's';
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  if (hrs > 0) {
    return hrs + 'h' + (mins > 0 ? ' ' + mins + 'm' : '');
  }
  // minutes >=1 and <1 hour
  return mins + 'm' + (rem > 0 ? ' ' + rem + 's' : '');
}

function attachHoverHandlers(divId: string) {
  const gd = document.getElementById(divId) as any;
  if (!gd) return;

  let lastHighlighted: number | null = null;

  gd.on('plotly_hover', (eventData: any) => {
    if (!eventData || !eventData.points || !eventData.points.length) return;
    const pt = eventData.points[0];
    const traceIndex = pt.curveNumber;

    // find all bar traces (type 'bar') and their indices
    const barTraceIndices = gd.data.map((t: any, idx: number) => t.type === 'bar' ? idx : -1).filter((i: number) => i >= 0);

    if (barTraceIndices.includes(traceIndex)) {
      // Highlight only the hovered bar trace: make it more opaque
      Plotly.restyle(gd, { 'marker.opacity': 0.95 }, [traceIndex]);
      lastHighlighted = traceIndex;
    } else {
      // if the hovered trace is the TPS line (scatter), highlight it by increasing width
      const t = gd.data[traceIndex];
      if (t && t.type === 'scatter') {
        Plotly.restyle(gd, { 'line.width': 4 }, [traceIndex]);
        lastHighlighted = traceIndex;
      }
    }
  });

  gd.on('plotly_unhover', (_eventData: any) => {
    // reset bar opacities and scatter widths
    if (!gd || !gd.data) return;
    for (let i = 0; i < gd.data.length; i++) {
      const t = gd.data[i];
      if (t.type === 'bar') Plotly.restyle(gd, { 'marker.opacity': 0.8 }, [i]);
      if (t.type === 'scatter') Plotly.restyle(gd, { 'line.width': 2 }, [i]);
    }
    lastHighlighted = null;
  });
}

async function render(filePath: string, divCpu: string, divMem: string) {
  const raw = await loadJson(filePath);
  const parsed = parseData(raw);
  createPlots(parsed, filePath, divCpu, divMem);
}

function createPlots(parsed: any, filePath: string, divCpu: string, divMem: string) {
  const { keysMs, podNames, podCpuSeries, podMemSeries, tx_per_sec } = parsed;
  const eventsPerTime: string[] = parsed.eventsPerTime || [];

  // compute elapsed seconds relative to the first timestamp
  const startMs = keysMs.length ? keysMs[0] : 0;
  const elapsedSec = keysMs.map(ms => (ms - startMs) / 1000);
  const elapsedText = elapsedSec.map(s => formatDuration(s));

  // choose bar width as most of the available gap between points (95%) to reduce visual spacing
  let barWidth = 0.95;
  if (elapsedSec.length > 1) {
    const diffs: number[] = [];
    for (let i = 1; i < elapsedSec.length; i++) diffs.push(elapsedSec[i] - elapsedSec[i - 1]);
    const positive = diffs.filter(d => isFinite(d) && d > 0);
    if (positive.length) {
      const minDiff = Math.min(...positive);
      // use most of the gap but leave a tiny space between bars (95% of gap)
      barWidth = Math.max(0.001, minDiff * 0.95);
    }
  }

  // compute tick values and labels for the elapsed axis (6 ticks)
  const maxSec = elapsedSec.length ? Math.max(...elapsedSec) : 0;
  const numTicks = 6;
  const tickVals: number[] = [];
  const tickText: string[] = [];
  for (let i = 0; i <= numTicks; i++) {
    const v = (maxSec * i) / numTicks;
    tickVals.push(Math.round(v));
    tickText.push(formatDuration(Math.round(v)));
  }

  // CPU chart
  const cpuTraces = makeTracesForPods(podNames, podCpuSeries, elapsedSec, elapsedText, barWidth);
  // compute total CPU per timestamp so we can place event markers above the stacked bars
  const totalCpu: number[] = elapsedSec.map((_, i) => podNames.reduce((acc, p) => acc + (podCpuSeries[p][i] || 0), 0));
  const maxTotalCpu = totalCpu.length ? Math.max(...totalCpu) : 0;
  // place event markers in paper coordinates so they stay visually at the bottom of the chart
  // paper y is 0..1 where 0 is bottom of plotting area; use a small offset (0.03)
  const cpuEventY = totalCpu.map((_, i) => eventsPerTime[i] ? 0.03 : NaN);
  const cpuTpsTrace = {
    x: elapsedSec,
    y: tx_per_sec,
    text: elapsedText,
    name: 'Transactions/sec',
    type: 'scatter',
    mode: 'lines+markers',
    marker: { color: 'red' },
    yaxis: 'y2',
    // show formatted elapsed time in tooltip
    hovertemplate: '%{fullData.name}<br>Elapsed: %{text}<br>%{y:.2f} <extra></extra>'
  };
  const cpuEventsTrace = {
    x: elapsedSec,
    y: cpuEventY,
    text: eventsPerTime,
    customdata: elapsedText,
    name: 'Events',
    type: 'scatter',
    mode: 'markers',
    marker: { color: 'green', symbol: 'circle', size: 12, line: { color: 'black', width: 1 } },
    hovertemplate: 'Event: %{text}<br>Elapsed: %{customdata}<extra></extra>',
    // use paper coordinates for vertical placement so y is fraction of plotting area
    yref: 'paper'
  };
  const cpuData = cpuTraces.concat([cpuTpsTrace]);
  // add events trace after TPS so it's visible on top
  cpuData.push(cpuEventsTrace);
  const cpuLayout = {
    title: 'CPU Metrics - ' + filePath.split('/').pop(),
    barmode: 'stack',
    // reduce spacing between bars
    bargap: 0.01,
    bargroupgap: 0,
    hovermode: 'closest',
    legend: { orientation: 'h', x: 0.5, xanchor: 'center', y: -0.2 },
    xaxis: {
      title: 'Elapsed',
      type: 'linear',
      tickvals: tickVals,
      ticktext: tickText,
      tickangle: -45,
      automargin: true
    },
    yaxis: { title: 'CPU (millicores)' },
    yaxis2: { title: 'Transactions/sec', overlaying: 'y', side: 'right' },
    margin: { t: 50, b: 120 }
  };

  Plotly.newPlot(divCpu, cpuData, cpuLayout, {responsive: true});
  attachHoverHandlers(divCpu);

  // Memory chart
  const memTraces = makeTracesForPods(podNames, podMemSeries, elapsedSec, elapsedText, barWidth);
  // compute total Memory per timestamp for event placement
  const totalMem: number[] = elapsedSec.map((_, i) => podNames.reduce((acc, p) => acc + (podMemSeries[p][i] || 0), 0));
  const maxTotalMem = totalMem.length ? Math.max(...totalMem) : 0;
  // place memory event markers in paper coordinates at the bottom (same fraction)
  const memEventY = totalMem.map((_, i) => eventsPerTime[i] ? 0.03 : NaN);
  const memTpsTrace = {
    x: elapsedSec,
    y: tx_per_sec,
    text: elapsedText,
    name: 'Transactions/sec',
    type: 'scatter',
    mode: 'lines+markers',
    marker: { color: 'red' },
    yaxis: 'y2',
    hovertemplate: '%{fullData.name}<br>Elapsed: %{text}<br>%{y:.2f} <extra></extra>'
  };
  const memEventsTrace = {
    x: elapsedSec,
    y: memEventY,
    text: eventsPerTime,
    customdata: elapsedText,
    name: 'Events',
    type: 'scatter',
    mode: 'markers',
    marker: { color: 'green', symbol: 'circle', size: 12, line: { color: 'black', width: 1 } },
    hovertemplate: 'Event: %{text}<br>Elapsed: %{customdata}<extra></extra>',
    yref: 'paper'
  };
  const memData = memTraces.concat([memTpsTrace]);
  memData.push(memEventsTrace);
  const memLayout = {
    title: 'Memory Metrics - ' + filePath.split('/').pop(),
    barmode: 'stack',
    // reduce spacing between bars
    bargap: 0.01,
    bargroupgap: 0,
    hovermode: 'closest',
    legend: { orientation: 'h', x: 0.5, xanchor: 'center', y: -0.2 },
    xaxis: {
      title: 'Elapsed',
      type: 'linear',
      tickvals: tickVals,
      ticktext: tickText,
      tickangle: -45,
      automargin: true
    },
    yaxis: { title: 'Memory (MiB)' },
    yaxis2: { title: 'Transactions/sec', overlaying: 'y', side: 'right' },
    margin: { t: 50, b: 120 }
  };

  Plotly.newPlot(divMem, memData, memLayout, {responsive: true});
  attachHoverHandlers(divMem);
}

function renderFromObject(obj: any, divCpu: string, divMem: string) {
  const parsed = parseData(obj);
  createPlots(parsed, 'uploaded-file.json', divCpu, divMem);
}

// Expose a global boot function for the HTML page
(window as any).renderMetrics = render;
(window as any).renderMetricsFromObject = renderFromObject;

// If loaded directly, auto-run with example data
if (typeof window !== 'undefined') {
  // use absolute path so fetching works from /ts/index.html
  const defaultFile = window.location.search ? (new URLSearchParams(window.location.search).get('file') || '/data/test-events.json') : '/data/test-events.json';
  // delay to allow Plotly to be loaded via CDN
  window.addEventListener('load', () => {
    try {
      (window as any).renderMetrics(defaultFile, 'cpuDiv', 'memDiv');
    } catch (e) {
      console.error('Failed to render:', e);
    }
  });
}
