const AWS = require('aws-sdk');
const logger = require('winston');

// Metrics names
const TEST_EXECUTED = 'ExecutedTests';
const TEST_FAILED = 'FailedTests';
const TEST_SUCCESSFUL = 'SuccessfulTests';
const TEST_EXCEPTION = 'TestExceptions';


class Metrics {

	/**
	 * @param {Object} config
	 */
	constructor (config = {}) {
		this._config = config;
		this._cloudwatch = new AWS.CloudWatch(this._config.aws || {});
		this._instanceId = 'Local';
		this._appName = 'unknown';

		// Try to get Instance ID if possible using AWS Meta Service
		const meta = new AWS.MetadataService();
		meta.request('/latest/meta-data/instance-id', (err, data) => {
			if (err) return;
			this._instanceId = data;
		});
	}

	set appName (appName) {
		this._appName = appName;
	}

	get appName () {
		return this._appName;
	}

	/**
	 * Sends a metric about executed test to Cloudwatch
	 */
	putExecuted () {
		this.put(TEST_EXECUTED, 1.0);
	}

	/**
	 * Sends a metric about failed test to Cloudwatch
	 */
	putFailed () {
		this.put(TEST_FAILED, 1.0);
	}

	/**
	 * Sends a metric about a successful test to Cloudwatch
	 */
	putSuccessful () {
		this.put(TEST_SUCCESSFUL, 1.0);
	}

	/**
	 * Sends a metric about an exception happened during test execution to Cloudwatch
	 */
	putException () {
		this.put(TEST_EXCEPTION, 1.0);
	}

	/**
	 * Save Zemog metric to CloudWatch
	 * @param {String} metricName
	 * @param {Float} metricValue
	 */
	put (metricName, metricValue) {
		const metric = {
			MetricName: metricName,
			Timestamp: new Date,
			Unit: 'Count',
			Value: metricValue
		};
		// That setup will allow us to slice data for reports in a way we want:
		// total, per instance, per app
		const params = {
			Namespace: 'Zemog',
			MetricData: [
				metric,
				Object.assign({}, metric, {
					Dimensions: [{Name: 'InstanceId', Value: this._instanceId}]
				}),
				Object.assign({}, metric, {
					Dimensions: [{Name: 'ApplicationName', Value: this._appName}]
				})
			]
		};

		logger.debug(`CloudWatch metric sent: ${metricName} - ${metricValue}`);
		this._cloudwatch.putMetricData(params, err => {
			if (err) logger.warn('Can\'t send CloudWatch metric', err);
		});
	}
}

module.exports = Metrics;
