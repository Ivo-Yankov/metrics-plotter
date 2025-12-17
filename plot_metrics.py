#!/usr/bin/env python3
import sys
import json
import matplotlib.pyplot as plt
import os

def plot_metrics(file_path):
    try:
        with open(file_path, 'r') as f:
            data = json.load(f)
    except Exception as e:
        print(f"Error reading JSON file: {e}")
        sys.exit(1)

    # Keys are milliseconds from the start; convert to sorted integers
    keys_ms = sorted(int(k) for k in data.keys())

    # Extract metrics in time order
    transaction_counts = [data[str(k)].get("transactionCount", 0) for k in keys_ms]

    # Build per-pod metrics from clusterMetrics -> podMetrics (podMetrics can be a list of dicts)
    pod_names = set()
    pod_metrics_by_time = []  # list of dicts mapping podName -> {cpuInMillicores, memoryInMebibytes}
    for k in keys_ms:
        entry = data.get(str(k), {})
        cluster = entry.get("clusterMetrics", [])
        merged = {}
        # clusterMetrics may be a list of cluster entries or a single dict
        clusters = cluster if isinstance(cluster, list) else [cluster]
        for c in clusters:
            if not isinstance(c, dict):
                continue
            pm = c.get("podMetrics")
            # podMetrics can be a list of pod dicts or a mapping
            if isinstance(pm, list):
                for pod in pm:
                    pod_name = pod.get("podName") or pod.get("name")
                    if not pod_name:
                        continue
                    if pod_name not in merged:
                        merged[pod_name] = {"cpuInMillicores": 0, "memoryInMebibytes": 0}
                    merged[pod_name]["cpuInMillicores"] += pod.get("cpuInMillicores", 0)
                    merged[pod_name]["memoryInMebibytes"] += pod.get("memoryInMebibytes", 0)
            elif isinstance(pm, dict):
                for pod_name, metrics in pm.items():
                    if not isinstance(metrics, dict):
                        continue
                    if pod_name not in merged:
                        merged[pod_name] = {"cpuInMillicores": 0, "memoryInMebibytes": 0}
                    merged[pod_name]["cpuInMillicores"] += metrics.get("cpuInMillicores", 0)
                    merged[pod_name]["memoryInMebibytes"] += metrics.get("memoryInMebibytes", 0)
        pod_metrics_by_time.append(merged)
        pod_names.update(merged.keys())

    pod_names = sorted(pod_names)

    # Build per-pod series (fill missing values with 0)
    pod_cpu_series = {pod: [] for pod in pod_names}
    pod_mem_series = {pod: [] for pod in pod_names}
    for pm in pod_metrics_by_time:
        for pod in pod_names:
            m = pm.get(pod, {})
            pod_cpu_series[pod].append(m.get("cpuInMillicores", 0))
            pod_mem_series[pod].append(m.get("memoryInMebibytes", 0))

    # Compute transactions per second from cumulative transactionCount (ensure it's present)
    tx_per_sec = []
    for i in range(len(transaction_counts)):
        if i == 0:
            tx_per_sec.append(0)
            continue
        delta_tx = transaction_counts[i] - transaction_counts[i - 1]
        delta_ms = keys_ms[i] - keys_ms[i - 1]
        if delta_ms <= 0:
            tx_per_sec.append(0)
        else:
            tx_per_sec.append(delta_tx / (delta_ms / 1000.0))

    # Determine bar width based on minimum time gap (in ms)
    if len(keys_ms) > 1:
        deltas = [keys_ms[i + 1] - keys_ms[i] for i in range(len(keys_ms) - 1) if keys_ms[i + 1] - keys_ms[i] > 0]
        min_delta = min(deltas) if deltas else 1
    else:
        min_delta = 1
    bar_width = max(float(min_delta) * 0.8, 1.0)

    # --- CPU chart (bars) + transactions/sec (line) ---
    fig_cpu, ax_cpu = plt.subplots(figsize=(10, 6))
    ax_cpu.set_xlabel('Time (ms)')
    ax_cpu.set_ylabel('CPU (millicores)', color='blue')
    # Plot stacked bars per pod for CPU (if we have pods); otherwise fall back to aggregate field if present
    bottom_cpu = [0.0] * len(keys_ms)
    if pod_names:
        for pod in pod_names:
            series = pod_cpu_series[pod]
            ax_cpu.bar(keys_ms, series, width=bar_width, bottom=bottom_cpu, label=pod, alpha=0.8, align='center')
            bottom_cpu = [b + s for b, s in zip(bottom_cpu, series)]
    else:
        # fall back to top-level cpuInMillicores if available
        cpu_values = [data[str(k)].get("cpuInMillicores", 0) for k in keys_ms]
        ax_cpu.bar(keys_ms, cpu_values, width=bar_width, color='blue', label='CPU (millicores)', alpha=0.8, align='center')
    ax_cpu.tick_params(axis='y', labelcolor='blue')

    ax_cpu_tps = ax_cpu.twinx()
    ax_cpu_tps.set_ylabel('Transactions/sec', color='red')
    ax_cpu_tps.plot(keys_ms, tx_per_sec, marker='o', color='red', label='Transactions/sec')
    ax_cpu_tps.tick_params(axis='y', labelcolor='red')

    # Combine legends for CPU chart
    lines, labels = [], []
    for a in (ax_cpu, ax_cpu_tps):
        l, lab = a.get_legend_handles_labels()
        lines += l
        labels += lab
    if lines:
        ncol = max(1, min(6, len(labels)))
        ax_cpu.legend(lines, labels, loc='upper center', bbox_to_anchor=(0.5, -0.18), ncol=ncol)
        fig_cpu.subplots_adjust(bottom=0.28)

    fig_cpu.suptitle(f'CPU Metrics - {os.path.basename(file_path)}')
    fig_cpu.tight_layout()

    # --- Memory chart (stacked bars per pod) + transactions/sec (line) ---
    fig_mem, ax_mem = plt.subplots(figsize=(10, 6))
    ax_mem.set_xlabel('Time (ms)')
    ax_mem.set_ylabel('Memory (MiB)', color='green')
    bottom = [0.0] * len(keys_ms)
    for pod in pod_names:
        series = pod_mem_series[pod]
        ax_mem.bar(keys_ms, series, width=bar_width, bottom=bottom, label=pod, alpha=0.7, align='center')
        bottom = [b + s for b, s in zip(bottom, series)]
    ax_mem.tick_params(axis='y', labelcolor='green')

    ax_mem_tps = ax_mem.twinx()
    ax_mem_tps.set_ylabel('Transactions/sec', color='red')
    ax_mem_tps.plot(keys_ms, tx_per_sec, marker='o', color='red', label='Transactions/sec')
    ax_mem_tps.tick_params(axis='y', labelcolor='red')

    # Combine legends for Memory chart (pods + TPS)
    lines, labels = [], []
    for a in (ax_mem, ax_mem_tps):
        l, lab = a.get_legend_handles_labels()
        lines += l
        labels += lab
    if lines:
        ncol = max(1, min(6, len(labels)))
        ax_mem.legend(lines, labels, loc='upper center', bbox_to_anchor=(0.5, -0.18), ncol=ncol)
        fig_mem.subplots_adjust(bottom=0.28)

    fig_mem.suptitle(f'Memory Metrics - {os.path.basename(file_path)}')
    fig_mem.tight_layout()


    plt.show()

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python3 script.py <path-to-json>")
        sys.exit(1)

    json_file = sys.argv[1]
    plot_metrics(json_file)