import { migrate } from './db/migrate.js';
import { sqlite } from './db/index.js';
migrate(sqlite);
