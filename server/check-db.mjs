import pg from 'pg';
import {databaseConfig,databaseSummary} from './database-config.mjs';
import {readFileSync}from'node:fs';import{parseEnv}from'node:util';
let client;
try{
 const config=databaseConfig();console.log('Database settings (password hidden):');console.log(databaseSummary(config));
 try{const file=parseEnv(readFileSync('.env','utf8'));const keys=['DATABASE_URL','DB_HOST','DB_PORT','DB_USER','DB_PASSWORD','DB_NAME'];if(keys.some(k=>file[k]!==undefined&&process.env[k]!==file[k]))console.log('Note: an existing environment variable is overriding a database setting in .env.');}catch{}
 client=new pg.Client({...config,connectionTimeoutMillis:10000});await client.connect();
 const result=await client.query('SELECT current_database() AS database,current_user AS username');console.log('Connected successfully:',result.rows[0]);
}catch(e){
 const messages={'28P01':'PostgreSQL rejected this username/password. Check that these settings match the working InventoryOS connection.','3D000':'The configured database does not exist on this PostgreSQL server.','ECONNREFUSED':'Could not reach PostgreSQL at this host and port. Check the Windows service and the port in pgAdmin.','ENOTFOUND':'The configured PostgreSQL host could not be found.'};
 console.error(messages[e.code]||'Connection check failed. Check the settings above and confirm them against pgAdmin.');process.exitCode=1;
}finally{await client?.end().catch(()=>{});}
