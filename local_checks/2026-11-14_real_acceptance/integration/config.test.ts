import assert from 'node:assert/strict';
import { createProvider } from './provider';
const base:any={enabled:false,mode:'offline',provider:'openai',model:'explicit-model',baseURL:'http://127.0.0.1:1/v1',apiKey:'local-fake',approvedRequests:0,maxTokens:800,timeoutMs:1000,ledger:'not-used.json'};
for(const change of [{mode:undefined},{maxTokens:801},{mode:'paid',baseURL:'http://example.invalid'},{mode:'offline',baseURL:'https://example.invalid'}])assert.throws(()=>createProvider({...base,...change}));
console.log(JSON.stringify({tests:4,passed:4,networkCalls:0}));
