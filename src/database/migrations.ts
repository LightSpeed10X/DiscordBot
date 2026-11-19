import * as foundation from "./migrations/001_foundation.js";
import * as tracking from "./migrations/002_import_tracking.js";
import * as management from "./migrations/003_management.js";

export const migrations = [foundation, tracking, management].sort((a, b) => a.version - b.version);
