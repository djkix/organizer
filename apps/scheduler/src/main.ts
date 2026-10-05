import { lireConfigScheduler } from './configuration.js';

const config = lireConfigScheduler();
if (!config) {
  console.log('Google Agenda non configuré (GOOGLE_CLIENT_ID absent) : scheduler arrêté.');
  process.exit(0);
}
console.log('Scheduler configuré.');
