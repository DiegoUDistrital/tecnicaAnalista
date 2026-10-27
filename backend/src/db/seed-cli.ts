import { createLogger } from '../logging/logger';
import { runSeedCommand } from './seed';

// Cableado del comando `npm run db:seed` con el proceso real.
void runSeedCommand(
  process.env,
  createLogger((line) => process.stdout.write(line)),
).then((code) => {
  process.exitCode = code;
});
