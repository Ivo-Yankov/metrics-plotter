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

    fig, ax1 = plt.subplots(figsize=(10, 6))

    # Plot CPU on the first Y-axis
    ax1.set_xlabel('Time (ms)')
    ax1.set_ylabel('CPU (millicores)', color='blue')
    ax1.plot(keys_ms, cpu_values, marker='o', color='blue', label='CPU (millicores)')
    ax1.tick_params(axis='y', labelcolor='blue')

    # Create a second Y-axis for memory
    ax2 = ax1.twinx()
    ax2.set_ylabel('Memory (MiB)', color='green')
    ax2.plot(keys_ms, memory_values, marker='o', color='green', label='Memory (MiB)')
    ax2.tick_params(axis='y', labelcolor='green')

    # Create a third Y-axis for transactions per second (offset to the right)
    ax3 = ax1.twinx()
    ax3.spines["right"].set_position(("axes", 1.15))
    ax3.spines["right"].set_visible(True)
    ax3.set_ylabel('Transactions/sec', color='red')
    ax3.plot(keys_ms, tx_per_sec, marker='o', color='red', label='Transactions/sec')
    ax3.tick_params(axis='y', labelcolor='red')

    # Combine legends from all three axes
    lines, labels = [], []
    for a in (ax1, ax2, ax3):
        l, lab = a.get_legend_handles_labels()
        lines += l
        labels += lab
    if lines:
        ax1.legend(lines, labels, loc='upper left')

    plt.title(f'CPU and Memory Metrics - {os.path.basename(file_path)}')
    fig.tight_layout()
    plt.show()

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python3 script.py <path-to-json>")
        sys.exit(1)

    json_file = sys.argv[1]
    plot_metrics(json_file)