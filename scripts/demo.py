"""Run the existing synthetic Mock fixture, preserving stored results."""
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]

if __name__ == '__main__':
    directory = ROOT / 'diagnostics'
    fixture = (directory / 'results/demo-input.json').read_bytes()
    subprocess.run([sys.executable, '-B', 'sidecar.py'], cwd=directory,
                   input=fixture, check=True)
