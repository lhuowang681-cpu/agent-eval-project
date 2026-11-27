const {createRequire}=require('node:module');
const path=require('node:path');
const req=createRequire(path.resolve(__dirname,'../2026-11-08_platform_audit/platform/package.json'));
(async()=>{const client=new(req('pg').Client)({connectionString:'postgresql://postgres@127.0.0.1:15433/agent_eval_phase2'});await client.connect();const result=await client.query('SELECT m.id,m.tools,m.metadata,m.error,p.tool_call_id,p.identifier,p.api_name,p.type,p.state,p.error as plugin_error FROM messages m LEFT JOIN message_plugins p ON m.id=p.id WHERE m.topic_id=$1 ORDER BY m.created_at',[process.argv[2]]);console.log(JSON.stringify(result.rows));await client.end()})().catch(e=>{console.error(e.message);process.exitCode=1});
