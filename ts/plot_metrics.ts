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

  return { keysMs, podNames, podCpuSeries, podMemSeries, tx_per_sec };
}

function makeTracesForPods(podNames: string[], seriesMap: Record<string, number[]>, keysMs: number[]) {
  const traces: any[] = [];
  for (const pod of podNames) {
    traces.push({
      x: keysMs,
      y: seriesMap[pod],
      name: pod,
      type: 'bar',
      marker: { opacity: 0.8 },
      // show only this trace in the hover tooltip
      hovertemplate: '%{trace.name}<br>%{y} <extra></extra>'
    });
  }
  return traces;
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

  // CPU chart
  const cpuTraces = makeTracesForPods(podNames, podCpuSeries, keysMs);
  const cpuTpsTrace = {
    x: keysMs,
    y: tx_per_sec,
    name: 'Transactions/sec',
    type: 'scatter',
    mode: 'lines+markers',
    marker: { color: 'red' },
    yaxis: 'y2',
    hovertemplate: '%{trace.name}<br>%{y:.2f} <extra></extra>'
  };
  const cpuData = cpuTraces.concat([cpuTpsTrace]);
  const cpuLayout = {
    title: 'CPU Metrics - ' + filePath.split('/').pop(),
    barmode: 'stack',
    hovermode: 'closest',
    legend: { orientation: 'h', x: 0.5, xanchor: 'center', y: -0.2 },
    yaxis: { title: 'CPU (millicores)' },
    yaxis2: { title: 'Transactions/sec', overlaying: 'y', side: 'right' },
    margin: { t: 50, b: 120 }
  };

  Plotly.newPlot(divCpu, cpuData, cpuLayout, {responsive: true});
  attachHoverHandlers(divCpu);

  // Memory chart
  const memTraces = makeTracesForPods(podNames, podMemSeries, keysMs);
  const memTpsTrace = {
    x: keysMs,
    y: tx_per_sec,
    name: 'Transactions/sec',
    type: 'scatter',
    mode: 'lines+markers',
    marker: { color: 'red' },
    yaxis: 'y2',
    hovertemplate: '%{trace.name}<br>%{y:.2f} <extra></extra>'
  };
  const memData = memTraces.concat([memTpsTrace]);
  const memLayout = {
    title: 'Memory Metrics - ' + filePath.split('/').pop(),
    barmode: 'stack',
    hovermode: 'closest',
    legend: { orientation: 'h', x: 0.5, xanchor: 'center', y: -0.2 },
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
  const defaultFile = window.location.search ? (new URLSearchParams(window.location.search).get('file') || '/data/example.json') : '/data/example.json';
  // delay to allow Plotly to be loaded via CDN
  window.addEventListener('load', () => {
    try {
      (window as any).renderMetrics(defaultFile, 'cpuDiv', 'memDiv');
    } catch (e) {
      console.error('Failed to render:', e);
    }
  });
}
