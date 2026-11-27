"""Run the supported offline checks without database or model access."""
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
SUITES = [
    ('diagnostics', ['-m', 'unittest', 'test_review', 'test_system']),
    ('experiments/postgres-acceptance', ['test_quality.py']),
    ('experiments/model-smoke', ['test_results.py']),
]


def main():
    for directory, args in SUITES:
        print(f'Checking {directory}', flush=True)
        subprocess.run([sys.executable, '-B', *args], cwd=ROOT / directory, check=True)
    print('All three offline suites passed (14 + 4 + 6 tests).')


if __name__ == '__main__':
    main()
