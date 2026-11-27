"""Provider injection. No vendor endpoint/key/model defaults; no paid adapter."""
import copy,queue,threading
class MockProvider:
 def __init__(self,candidate):self.candidate=candidate;self.calls=0
 def generate(self,trace,model,max_tokens):self.calls+=1;return copy.deepcopy(self.candidate)
def invoke(provider,trace,config):
 if config.get('origin')!='synthetic':raise ValueError('privacy_review_required')
 import json,re
 text=json.dumps(trace,ensure_ascii=False)
 if len(text)>12000 or re.search(r'\bsk-[\w-]{16,}|Bearer\s+\S+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}',text):raise ValueError('privacy_or_context_limit')
 if not config.get('model') or config.get('maxCalls',0)<1 or not 1<=config.get('maxTokens',0)<=1000:raise ValueError('model_or_budget_missing')
 timeout=config.get('timeoutSeconds',1)
 if not isinstance(timeout,(int,float)) or not 0<timeout<=10:raise ValueError('invalid_timeout')
 config['maxCalls']-=1;q=queue.Queue(1)
 def work():
  try:q.put((True,provider.generate(copy.deepcopy(trace),config['model'],config['maxTokens'])))
  except Exception:q.put((False,None))
 threading.Thread(target=work,daemon=True).start()
 try:ok,value=q.get(timeout=timeout)
 except queue.Empty:raise TimeoutError('provider_timeout')
 if not ok:raise ValueError('provider_failure')
 if not isinstance(value,dict) or len(json.dumps(value))>256000:raise ValueError('invalid_provider_output')
 return value
