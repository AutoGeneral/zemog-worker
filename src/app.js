const assert = require('assert');
const path = require('path');
const tv4 = require('tv4');
const TestExecutor = require('./executor');
const Queue = require('./queue');
const File = require('./file');
const Metrics = require('./metrics');
const {VictorOps, Clickatell} = require('./notifications');
const {EmptyQueueError, ConfigurationParseError} = require('./errors');

const CONFIG_SCHEMA = require('../config/config.schema.json');


class Application {

	/**
	 * @param {String} configName
	 */
	constructor (configName) {
		assert(configName, 'configName (type String) parameter must be passed to Application constructor');
		try {
			this._config = Application.validateConfig(require(configName));
			this._config.debug = this._config.debug || {};
		}
		catch (ex) {
			console.error(`Error! Cannot find config file '${process.env.config}'. Existing now...`, ex); // eslint-disable-line no-console
			process.exit(1);
		}

		this._logger = require('./logging')(this._config);
		Object.freeze(this._config);

		if (Object.keys(this._config.debug).length) {
			this._logger.warn('One or more debug options enabled! Don\'t do it in production please!');
			Object.keys(this._config.debug).forEach(key => this._logger.warn(`${key} debug option enabled`));
		}
	}

	/**
	 * Runs a worker process that attempts to read from queue,
	 * downloads test from S3, executes them and sends notification if needed
	 * ¯\_(ツ)_/¯
	 */
	start () {
		this._logger.debug('Worker has been started');

		const testExecutor = new TestExecutor(this._config);
		const queue = new Queue(this._config, this._config.debug);
		const file = new File(this._config, this._config.debug);
		const metrics = new Metrics(this._config);

		let testTask = {};
		let tmpFolder;
		let testName;
		let appName;
		let tmpTestResultsFolder;
		let testRemoteLocation;
		let testResultArchiveFile;
		let metadata;

		queue.retrieveTask()
			.then(task => {

				testTask = task;
				testName = task.test;
				appName = task.app || 'unknown';
				metrics.appName = appName;
				metadata = {appName, testName};

				this._logger.info('STARTED', metadata);

				testRemoteLocation = task.location;
				return file.retrieveTestFiles(testRemoteLocation);
			})
			.then(_tmpFolder => {
				metrics.putExecuted();
				tmpFolder = _tmpFolder;
				testExecutor.open(tmpFolder);
				return testExecutor.execute(testName);
			})
			.then(data => {
				this._logger.info(`Exit code: ${data.code}`);
				this._logger.info('FINISHED', metadata);

				File.removeTestFiles(tmpFolder);

				tmpTestResultsFolder = data.tmpTestResultsFolder;
				if (data.code !== 0) {
					this._logger.info('FAILED', metadata);
					metrics.putFailed();
					const testSourceSafeName = testRemoteLocation.split('/').pop().replace('.', '-');
					return file.archiveTestResult(testSourceSafeName, tmpTestResultsFolder);
				}
				else {
					this._logger.info('SUCCESSFUL', metadata);
					metrics.putSuccessful();
					File.removeTestFiles(tmpTestResultsFolder);
				}
			})
			.then(_testResultArchiveFile => {
				testResultArchiveFile = _testResultArchiveFile;
				return file.uploadTestResult(testResultArchiveFile);
			})
			.then(data => {
				if (data && testTask.notifications) {
					testTask.notifications.forEach((notificationCode) => {
						let notification = this._config.notifications[notificationCode];
						if (!notification) return;
						notification.aws = this._config.aws;
						if ((notification.victorOps || {}).isEnabled) {
							(new VictorOps(notification)).sendNotification(appName, testName, path.basename(testResultArchiveFile));
						}
						if ((notification.clickatell || {}).isEnabled) {
							(new Clickatell(notification)).sendNotification(appName, testName, path.basename(testResultArchiveFile));
						}
					});
				}
				File.removeTestFiles(tmpTestResultsFolder);
			})
			.catch(err => {
				// We don't want to log an error with a stack
				// if there simply were no messages in a queue
				if (err instanceof EmptyQueueError) {
					this._logger.info(err.message);
				}
				// Otherwise just show the error
				else {
					this._logger.info('EXCEPTION', metadata);
					metrics.putException();
					this._logger.error(err);
				}
			});
	}

	/**
	 * Runs a standalone executor that runs test from a local machine (primary for testing)
	 * @param {String} testFolder
	 * @param {String} testName
	 * @returns {Promise}
	 */
	startStandalone (testFolder, testName) {
		this._logger.info('Standalone Executor has been started');
		this._logger.info(`Executing test "${testName}" from ${testFolder}`);

		const testExecutor = new TestExecutor(this._config);

		testExecutor.open(testFolder);
		return testExecutor.execute(testName);
	}

	/**
	 * Validates config against a JSON schema, throws an error if validation failed
	 * @param {Object} config
	 * @returns {Object}
	 */
	static validateConfig (config) {
		const valid = tv4.validate(config, CONFIG_SCHEMA);
		if (!valid) {
			throw new ConfigurationParseError(tv4.error.message);
		}
		return config;
	}
}

module.exports = Application;
