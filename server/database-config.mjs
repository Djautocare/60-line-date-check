import pg from 'pg';
export function databaseConfig(env=process.env){
 if(env.DB_PASSWORD!==undefined){
  if(!env.DB_PASSWORD)throw new Error('DB_PASSWORD is empty. Enter your PostgreSQL password in .env.');
  const port=Number(env.DB_PORT||5432);if(!Number.isInteger(port)||port<1||port>65535)throw new Error('DB_PORT must be a valid PostgreSQL port.');
  return {host:env.DB_HOST||'localhost',port,user:env.DB_USER||'postgres',password:env.DB_PASSWORD,database:env.DB_NAME||'datecheck60'};
 }
 if(env.DATABASE_URL){
  try{const client=new pg.Client({connectionString:env.DATABASE_URL});return {host:client.host,port:client.port,user:client.user,password:client.password,database:client.database,...(client.ssl?{ssl:client.ssl}:{})};}
  catch{throw new Error('DATABASE_URL could not be read. Use DB_HOST, DB_PORT, DB_USER, DB_PASSWORD and DB_NAME instead.');}
 }
 throw new Error('Set DB_HOST, DB_PORT, DB_USER, DB_PASSWORD and DB_NAME in .env, or provide DATABASE_URL.');
}
export function databaseSummary(config){return {host:config.host,port:config.port,user:config.user,database:config.database,passwordConfigured:!!config.password};}
