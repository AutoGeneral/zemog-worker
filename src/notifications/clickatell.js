const logger = require('winston');
const request = require('request');
const assert = require('assert');


class Clickatell {

	/**
	 * @param {Object} config
	 */
	constructor (config = {}) {
		this._config = config.clickatell;
		this._testResultPath = (config.aws || {}).testResultPath || {};

		assert(this._config.authorizationToken, 'clickatell.authorizationToken (string) config property is required');
		assert(this._config.recipients, 'clickatell.recipients (array<string>) config property is required');
	}

	/**
	 * @param {String} appName
	 * @param {String} testName
	 * @param {String} src
	 */
	sendNotification (appName, testName, src) {
		logger.debug('Sending notification to Clickatell for failed test result');

		const stateMessage = [
			'Iridium Test failed',
			appName,
			testName,
			's3://' + this._testResultPath.bucket + '/' + this._testResultPath.key + src
		].join(' - ');

		const options = {
			url: 'https://api.clickatell.com/rest/message',
			method: 'POST',
			timeout: 5 * 60 * 1000,
			headers: {
				Authorization: `Bearer ${this._config.authorizationToken}`,
				Accept: 'application/json',
				'Content-Type': 'application/json',
				'X-Version': 1
			},
			body: JSON.stringify({
				from: this._config.from || 'Zemog Worker',
				to: this._config.recipients,
				text: `Zemog: ${stateMessage}`
			})
		};

		request(options, (err, res) => {
			if (res.statusCode === 202) {
				logger.debug('Successfully sent notification to Clickatell.');
			}
			else {
				logger.debug(`Can't send notifications to Clickatell: ${err}`);
			}
		});
	}
}

module.exports = Clickatell;
