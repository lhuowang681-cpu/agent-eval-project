"""Pure current rules only, separated from adapter's optional evidence-review wrapper."""
import json,pathlib,sys
base=pathlib.Path(__file__).resolve().parent
sys.path.insert(0,str(base.parents[3]/'local_checks/2026-11-08_platform_audit/platform/scripts/eval-attribution'))
from adapter import analyze
sys.stdout.write(json.dumps(analyze(json.load(sys.stdin)),ensure_ascii=True,allow_nan=False)+'\n')
