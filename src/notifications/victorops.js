const logger = require('winston');
const request = require('request');
const assert = require('assert');


class VictorOps {

	/**
	 * @param {Object} config
	 */
	constructor (config = {}) {
		this._config = config.victorOps || {};
		this._testResultPath = (config.aws || {}).testResultPath || {};
		this._awsRegion = (config.aws || {}).region || 'ap-southeast-2';

		assert(this._config.url, 'victorOps.url (string) config property is required');
	}

	/**
	 * Send notification to victor ops
	 * @param {String} appName
	 * @param {String} testName
	 * @param {String} src
	 */
	sendNotification (appName, testName, src) {
		logger.debug(`Sending notification to VictorOps for failed test result ${src}`);
		const stateMessage = [
			'Iridium Test failed',
			appName,
			testName,
			'https://s3-' + this._awsRegion + '.amazonaws.com/' + this._testResultPath.bucket + '/' + src
		].join(' - ');

		const options = {
			method: 'POST',
			url: this._config.url,
			json: true,
			body: {
				'message_type': this._config.messageType,
				'entity_id': this._config.entity + ':#' + Date.now(),
				'state_message': stateMessage,
				'monitoring_tool': 'Zemog Worker'
			}
		};

		request(options, (err, res, body) => {
			logger.debug(`response: ${res.statusCode}`);
			logger.debug(`body: ${JSON.stringify(body)}`);

			if (res.statusCode === 200) {
				logger.debug('Successfully sent notification to VictorOps.');
			}
			else {
				logger.debug(`Can't send notifications to VictorOps: ${err}`);
			}
		});
	}
}

module.exports = VictorOps;
