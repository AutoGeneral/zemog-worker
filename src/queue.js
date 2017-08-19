const AWS = require('aws-sdk');
const logger = require('winston');
const assert = require('assert');
const {EmptyQueueError, JSONParseError} = require('./errors');


class Queue {

	/**
	 * @param {Object} config
	 * @param {Object} debugParams
	 */
	constructor (config = {}, debugParams = {}) {
		assert(config.queueName, '"queueName" property must be defined in the config');

		this._config = config;
		this._debug = debugParams;
		this._queueUrlPromise = null;
		this._sqs = new AWS.SQS(this._config.aws || {});

		const params = {
			QueueName: config.queueName
		};

		this._queueUrlPromise = this._sqs.getQueueUrl(params).promise().then(data => {
			logger.debug(`Found suitable SQS queue: ${data.QueueUrl}`);
			return data.QueueUrl;
		});
	}

	/**
	 * Retrieves Zemog test task object from AWS SQS
	 * @returns {Promise.<Object|undefined>}
	 */
	retrieveTask () {
		let message;
		let queueUrl;

		return this._queueUrlPromise
			.then(_queueUrl => {
				queueUrl = _queueUrl;

				if (this._debug.useMockedQueueMessage) {
					logger.warn('Using mocked queue message');
					return {
						Messages: [
							{
								Body: `{"test": "connectionTest", "app": "budget-direct", "location": 
							  "s3://ag-online-zemog/tests/budget-direct-local-test.zip", "notifications": ["frontend", "infrastructure"]}`
							}
						]};
				}

				return this._sqs.receiveMessage({
					QueueUrl: queueUrl,
					MaxNumberOfMessages: 1
				}).promise();
			})
			.then(data => {
				if (!data.Messages) {
					throw new EmptyQueueError('No messages to retrieve');
				}
				logger.info(`SQS message received. Body: ${data.Messages[0].Body}`);
				message = data.Messages[0];

				if (this._debug.doNotDeleteMessagesInQueue) return;

				logger.debug(`Removing SQS message with ReceiptHandle: ${message.ReceiptHandle}`);
				return this._sqs.deleteMessage({
					QueueUrl: queueUrl,
					ReceiptHandle: message.ReceiptHandle
				}).promise();
			})
			.then(() => {
				try {
					return JSON.parse(message.Body);
				}
				catch (parseErr) {
					throw new JSONParseError(`Failed to parse SQS message: "${message.Body}"`);
				}
			});
	}
}

module.exports = Queue;
