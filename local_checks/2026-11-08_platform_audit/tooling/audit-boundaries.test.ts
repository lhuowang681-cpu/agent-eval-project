import {describe,it,expect} from 'vitest';
import {evaluate} from '../platform/packages/eval-rubric/src/evaluate';
import {matchNumeric} from '../platform/packages/eval-rubric/src/matchers/numeric';
import {parseJSONL} from '../platform/packages/eval-dataset-parser/src/parsers/jsonl';
describe('Characterize unhandled boundary behavior (reproductions, not desired contracts)',()=>{
  it('empty candidate array throws instead of returning a scored result',async()=>{
    await expect(evaluate({actual:'42',rubrics:[{id:'r',name:'equals',type:'equals',config:{},weight:1}],testCase:{input:'number',expected:'[]'}} as any)).rejects.toThrow();
  });
  it('invalid regex throws out of the scorer',async()=>{
    await expect(evaluate({actual:'42',rubrics:[{id:'r',name:'regex',type:'regex',config:{pattern:'['},weight:1}],testCase:{input:'number',expected:'42'}} as any)).rejects.toThrow(SyntaxError);
  });
  it('scientific notation is stripped and falsely matches 13',()=>{
    expect(matchNumeric('1e3','13',{} as any).passed).toBe(true);
  });
  it('blank-line filtering changes the reported source line',()=>{
    expect(()=>parseJSONL('{"a":1}\n\n{bad JSON')).toThrow('Invalid JSON at line 2');
  });
  it('negative rubric weights can yield a score above one',async()=>{
    const r=await evaluate({actual:'yes',rubrics:[{id:'a',name:'a',type:'equals',config:{},weight:2},{id:'b',name:'b',type:'contains',config:{},weight:-1}],testCase:{input:'check',expected:'yes'}} as any);
    // Both currently pass, so use a regex second rubric that fails.
    const s=await evaluate({actual:'yes',rubrics:[{id:'a',name:'a',type:'equals',config:{},weight:2},{id:'b',name:'b',type:'regex',config:{pattern:'^no$'},weight:-1}],testCase:{input:'check',expected:'yes'}} as any);
    expect(r.score).toBe(1);expect(s.score).toBe(2);
  });
});
