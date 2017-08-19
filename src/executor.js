const logger = require('winston');
const fs = require('fs');
const assert = require('assert');
const path = require('path');
const os = require('os');
const spawn = require('child_process').spawn;
const File = require('./file');
const {ConfigurationParseError, TestNotFound} = require('./errors');

const CONFIGURATION_FILE = 'zemog.json';
// there are some exception that can happen inside Iridium that clearly just internal problems
// when something went terribly wrong within test suite. We don't want to mark this test
// as a failure but just throw an InternalTestExecutionError if we see that in the stdout from Iridium
const EXECUTION_EXCEPTIONS = [
	'java.util.concurrent.RejectedExecutionException'
];


class TestExecutor {

	/**
	 * @param {Object} config
	 */
	constructor (config) {
		assert(config, 'config (type Object) parameter must be specified');
		assert(config.iridiumPath, 'config.iridiumPath (type String) parameter must be specified');

		this._pathToIridium = config.iridiumPath;
		this._globalLaunchParameters = config.iridiumLaunchParameters || [];
		this._config = {};

		if (!Array.isArray(this._globalLaunchParameters)) {
			throw new ConfigurationParseError('config.iridiumLaunchParameters must be an array of strings');
		}
	}

	/**
	 * Opens Zomeg configuration and reads it
	 * (will try to open zemog.json) if folder specified
	 *
	 * @param {String} pathToTests
	 */
	open (pathToTests) {
		let pathToOpen;
		try {
			const stats = fs.statSync(pathToTests);
			pathToOpen = stats.isDirectory() ? path.join(pathToTests, CONFIGURATION_FILE) : pathToTests;
		}
		catch (err) {
			throw new ConfigurationParseError(`Can't open tests directory "${pathToTests}". Reason: ${err}`);
		}

		try {
			this._config = require(pathToOpen);
		}
		catch (err) {
			throw new ConfigurationParseError(`Can't read zemog.json configuration from "${pathToOpen}". Reason: ${err}`);
		}

		if (this._config.launchParameters) {
			throw new ConfigurationParseError('Incompatible config format, tests names must be specified');
		}
		Object.keys(this._config)
			.filter(propertyName => propertyName !== 'version')
			.forEach(testName => {
				// convert ./ to absolute paths
				this._config[testName].launchParameters = (this._config[testName].launchParameters  || [])
					.map(line => line.replace(/(=\s?)(\.(?:\/|\\))(.*)/, `$1file:///${path.join(pathToTests, '$3')}`));
			});
	}

	/**
	 * Executes tests in Iridium
	 * @param {String} testName Name of the test defined in zemog.json to execute
	 * @returns {Promise}
	 */
	execute (testName) {
		assert(testName, 'testName (type String) parameter must be specified');
		if (!this._config[testName]) {
			throw new TestNotFound(`There is no info about "${testName}" in zemog.json`);
		}

		let stdout = '';
		let stderr = '';
		const params = [
			...this._config[testName].launchParameters,
			...this._globalLaunchParameters,
			'-jar', path.join(__dirname, '..', this._pathToIridium)
		];

		// Create temporary folder for test results
		const tmpTestResultsFolder = path.join(os.tmpdir(), testName + '-' + Math.random());
		File.createFolderIfNeeded(tmpTestResultsFolder);

		logger.info(`Running Iridium with params: ${params}`);
		logger.debug(`Temporary results folder: ${tmpTestResultsFolder}`);

		// Execute tests with home folder = temporary folder we just created
		const task = spawn('java', params, {cwd: tmpTestResultsFolder});

		task.stdout.on('data', data => {
			logger.debug(data.toString());
			stdout += data;
		});

		task.stderr.on('data', data => {
			logger.warn(data.toString());
			stderr += data;
		});

		const reExecutionExceptionsCheck = new RegExp(`(${EXECUTION_EXCEPTIONS.join('|')})`);
		return new Promise((resolve, reject) => {
			task.on('close', code => {
				if (code !== 0 && reExecutionExceptionsCheck.test(stdout)) {
					return reject(stdout);
				}
				resolve({tmpTestResultsFolder, code, stdout, stderr});
			});
		});
	}
}


module.exports = TestExecutor;
