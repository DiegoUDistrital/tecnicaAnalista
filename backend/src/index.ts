import { startServer } from './server/start-server';

void startServer().then((code) => {
  process.exit(code);
});
