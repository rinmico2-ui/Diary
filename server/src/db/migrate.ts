import { db } from './index.js';

db.migrate();
console.log('Database migrated:', db.all("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").length, 'tables');
db.close();
