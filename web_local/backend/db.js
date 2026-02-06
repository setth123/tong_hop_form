const { Pool } = require('pg');

const db = new Pool({
  host: '192.168.110.46',
  port: 5432,
  user: 'lucthuy_server2',
  password: 'admin',
  database: 'Web_local',     
  ssl: false                
});

db.connect()
  .then(() => console.log('PostgreSQL Connected'))
  .catch(err => {
    console.error('PostgreSQL connection error', err);
    process.exit(1);
  });

module.exports = db;
