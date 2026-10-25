import { createLogger } from '../logging/logger';
import { runDeployCommand } from './migrate';

// Cableado del comando `npm run db:deploy` con el proceso real.
void runDeployCommand(
  process.env,
  createLogger((line) => process.stdout.write(line)),
).then((code) => {
  process.exitCode = code;
});
