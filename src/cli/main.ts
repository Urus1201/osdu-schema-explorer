import { runCli } from './commands';

process.exitCode = await runCli(process.argv.slice(2));
