"""Run unmodified legacy tests with the new reviewer; retain policy failures."""
import importlib.util,io,json,sys,unittest
from pathlib import Path
BASE=Path(__file__).resolve().parent
def module(name,path):
 spec=importlib.util.spec_from_file_location(name,path);value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
if __name__=='__main__':
 legacy=module('legacy_tests',BASE/'previous/test_shadow.py')
 runner=module('legacy_runner',BASE/'previous/run_experiment.py');sys.modules['run_experiment']=runner
 from candidate.review import review
 legacy.review=review
 stream=io.StringIO();result=unittest.TextTestRunner(stream=stream,verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(legacy.Tests))
 (BASE/'results/legacy-tests-on-new-review.log').write_text(stream.getvalue(),encoding='utf-8')
 data={'tests':result.testsRun,'passed':result.testsRun-len(result.failures)-len(result.errors),'failures':[t.id() for t,_ in result.failures],'errors':[t.id() for t,_ in result.errors],'policy':'No legacy assertion edited; A without a closed constraint must no longer be supported. Report expected incompatibility rather than claim all legacy tests pass.'}
 (BASE/'results/legacy-compatibility.json').write_text(json.dumps(data,indent=2),encoding='utf-8');print(json.dumps(data))
