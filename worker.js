#!/usr/bin/env node

const path = require('path');
const Application = require('./src/app');
const argv = require('yargs')
	.usage('Usage: $0 --config=<config-path>\nUsage standalone: $0 --dir=<directory> --test=<test-name>')
	.default('config', `${__dirname}/config/default.json`)
	.describe('config', 'Configuration file to load')
	.describe('dir', 'Directory with tests for standalone mode')
	.describe('test', 'Test name to launch in standalone mode')
	.help('h')
	.alias('h', 'help')
	.example('$0 --config=/opt/zemog/production.json', 'Launches worker with the imaginary production config')
	.example('$0 --dir=/opt/tests/ --test=connectionTest', 'Launches worker in standalone mode to run connectionTest')
	.epilog('Auto & General (c)')
	.argv;

const app = new Application(path.normalize(argv.config.replace('./', __dirname + '/')));

// Run a standalone mode without access to AWS to use local tests
// if --dir and --test arguments are passed
if (argv.dir && argv.test) {
	app.startStandalone(argv.dir, argv.test);
}
// otherwise use normal mode which requires access to AWS S3 and SQS
else {
	app.start();
}
