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
    cpu_values = [data[str(k)].get("cpuInMillicores", 0) for k in keys_ms]
    memory_values = [data[str(k)].get("memoryInMebibytes", 0) for k in keys_ms]
    transaction_counts = [data[str(k)].get("transactionCount", 0) for k in keys_ms]

    # Compute transactions per second from cumulative transactionCount
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
            delta_s = delta_ms / 1000.0
            tx_per_sec.append(delta_tx / delta_s)

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
        ax_cpu.legend(lines, labels, loc='upper left')

    fig_cpu.suptitle(f'CPU Metrics - {os.path.basename(file_path)}')
    fig_cpu.tight_layout(rect=[0, 0.03, 1, 0.95])

    # --- Memory chart (bars) + transactions/sec (line) ---
    fig_mem, ax_mem = plt.subplots(figsize=(10, 6))
    ax_mem.set_xlabel('Time (ms)')
    ax_mem.set_ylabel('Memory (MiB)', color='green')
    ax_mem.bar(keys_ms, memory_values, width=bar_width, color='green', label='Memory (MiB)', alpha=0.7, align='center')
    ax_mem.tick_params(axis='y', labelcolor='green')

    ax_mem_tps = ax_mem.twinx()
    ax_mem_tps.set_ylabel('Transactions/sec', color='red')
    ax_mem_tps.plot(keys_ms, tx_per_sec, marker='o', color='red', label='Transactions/sec')
    ax_mem_tps.tick_params(axis='y', labelcolor='red')

    # Combine legends for Memory chart
    lines, labels = [], []
    for a in (ax_mem, ax_mem_tps):
        l, lab = a.get_legend_handles_labels()
        lines += l
        labels += lab
    if lines:
        ax_mem.legend(lines, labels, loc='upper left')

    fig_mem.suptitle(f'Memory Metrics - {os.path.basename(file_path)}')
    fig_mem.tight_layout(rect=[0, 0.03, 1, 0.95])

    plt.show()

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python3 script.py <path-to-json>")
        sys.exit(1)

    json_file = sys.argv[1]
    plot_metrics(json_file)