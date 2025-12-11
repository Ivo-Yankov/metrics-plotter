# metrics-plotter

Simple script to plot CPU, memory and transactions-per-second from a JSON file.

Prerequisites
- Python 3.8+
- matplotlib

Install (optional virtualenv):

python3 -m venv .venv
source .venv/bin/activate
pip install matplotlib

Run

python3 plot_metrics.py <path-to-json>

Example

python3 plot_metrics.py data/only-pinger-60-min.json
