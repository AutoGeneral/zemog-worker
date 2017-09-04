const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const AWS = require('aws-sdk');
const logger = require('winston');
const decompress = require('decompress');
const archiver = require('archiver');
const rimraf = require('rimraf');
const moment = require('moment');
const readDir = require('recursive-readdir');
const {FileOperationError, TestNotFound, TestResultNotUploaded} = require('./errors');

class File {

	/**
	 * @param {Object} config
	 * @param {Object} debugParams
	 */
	constructor (config = {}, debugParams = {}) {
		this._config = config;
		this._debug = debugParams;
		this._s3 = new AWS.S3(this._config.aws || {});
		this._tmpRootFolder = path.join(os.tmpdir(), 'zemog');
		this._testResultPath = (this._config.aws.testResultPath || {bucket: 'zemog-bucket', key: 'tests/result/'});
		this._daysToKeepTestResult = (this._config.daysToKeepTestResult || 7);
	}

	/**
	 * Parses s3:// url and returns S3 address object
	 *
	 * @param {String} s3path
	 * @returns {{Bucket: String, Key: String}}
	 */
	static getPathObject (s3path) {
		const tmp = s3path.replace(/(s3:)?\/\//, '').split('/');
		return {
			Bucket: tmp.shift(),
			Key: tmp.join('/')
		};
	}

	/**
	 * Checks if folder exists and creates it if needed
	 * @param {String} folder
	 * @param {Boolean} forceDelete
	 */
	static createFolderIfNeeded (folder, forceDelete = false) {
		try {
			if (fs.existsSync(folder)) {
				const stats = fs.statSync(folder);
				if (!stats.isDirectory() || forceDelete) {
					rimraf.sync(folder);
					fs.mkdirSync(folder);
				}
			}
			else fs.mkdirSync(folder);
		}
		catch (err) {
			throw new FileOperationError(`Can't create temporary folder ${folder}`, err.stack);
		}
	}

	/**
	 * Retrieves archive with test from S3, unpacks it to an unique temporary folder
	 * @param {String} src Location of archive in S3
	 * @returns {Promise.<String>} Promise resolving temporary folder location
	 */
	retrieveTestFiles (src) {
		assert(src, 'src (type String) parameter must be passed');

		const testName = src.split('/').pop();
		const tmpTestFolder = path.join(this._tmpRootFolder, testName.replace('.', '-')) + '-' + moment().valueOf();
		const tmpArchiveFilename = path.join(this._tmpRootFolder, testName);

		File.createFolderIfNeeded(this._tmpRootFolder);
		File.createFolderIfNeeded(tmpTestFolder, true);

		logger.debug(`Getting info about test package in S3 bucket: ${src}`);

		// Getting meta information from an object
		return this._s3.headObject(File.getPathObject(src)).promise()
			.then(data => {
				// Check if we already downloaded that file
				// and it's older than the latest version in S3 bucket
				const s3LastModified = moment.utc(data.LastModified, 'ddd, D MMM YYYY HH:mm:ss');
				if (fs.existsSync(tmpArchiveFilename)) {
					const stats = fs.statSync(tmpArchiveFilename);
					if (moment(stats.birthtime) >= s3LastModified) {
						logger.debug('Test package in S3 bucket hasn\'t been changed since the last check. Will use the local copy');
						return;
					}
				}
				// If we had no file before or it is outdated - download the latest from S3
				return this._s3.getObject(File.getPathObject(src)).promise().then(data => {
					logger.debug(`Attempting to retrieve a file from S3 bucket: ${src}`);
					try {
						const file = fs.openSync(tmpArchiveFilename, 'w');
						fs.writeFileSync(file, data.Body);
						fs.closeSync(file);
					}
					catch (err) {
						throw new FileOperationError(err);
					}
				});
			})
			.then(() => {
				logger.debug(`Unarchiving ${tmpArchiveFilename}`);
				return decompress(tmpArchiveFilename, tmpTestFolder);
			})
			.then(() => {
				return tmpTestFolder;
			})
			.catch(err => {
				// We want to return better error messages than standard S3 errors if possible
				if (['Forbidden'].indexOf(err.code) !== -1) {
					throw new TestNotFound(`Bucket not found or you have no access: ${src}`, err.stack);
				}
				else if (['NoSuchKey', 'NotFound'].indexOf(err.code) !== -1) {
					throw new TestNotFound(`Test package not found in S3 bucket ${src}`, err.stack);
				}
				throw new Error(err);
			});
	}

	/**
	 * @param {String} src
	 */
	static removeTestFiles (src) {
		logger.debug(`Clearing tests folder: ${src}`);
		rimraf.sync(src);
	}

	/**
	 * Archive Test Results
	 * @param {String} archiveName Archive name to produce
	 * @param {String} src Folder with tests results
	 * @returns {Promise<String>} Promise that resolved with path to the archive with tests
	 */
	archiveTestResult (archiveName, src) {
		assert(archiveName, 'src (type String) parameter must be passed');
		assert(src, 'src (type String) parameter must be passed');

		const tmpArchiveFilename = path.join(os.tmpdir(), `${archiveName}.zip`);
		logger.debug(`Archiving tests results folder: ${src}. Archive: ${tmpArchiveFilename}`);

		const output = fs.createWriteStream(tmpArchiveFilename);
		const archive = archiver('zip');

		archive.on('error', err => {
			throw err;
		});
		archive.pipe(output);

		// append files from a directory
		archive.directory(src, '/', undefined);

		// finalize the archive (ie we are done appending files but streams have to finish yet)
		archive.finalize();

		return new Promise ((resolve, reject) => {
			output.on('close', err => {
				if (err) return reject(err);
				logger.debug(archive.pointer() + ' bytes archive has been finalised, archive created');
				resolve({archiveName, src, tmpArchiveFilename});
			});
		});
	}

	/**
	 * Upload Test Result to S3 bucket
	 * @returns {Promise<String>|undefined} data
	 */
	uploadTestResult ({archiveName, src, tmpArchiveFilename}) {
		if (fs.existsSync(src)) {

			const date = new Date();
			date.setDate(date.getDate() + this._daysToKeepTestResult);

			const folderToUpload = `${this._testResultPath.key}${archiveName}-${new Date().toISOString().replace(/:/g, '-')}`;

			return new Promise(resolve => {
				readDir(src)
					.then(files => {
						Promise.all(
							files.map(file => {
								const params = {
									Bucket: this._testResultPath.bucket,
									Key: `${folderToUpload}/html/${path.relative(src, file)}`,
									Body: fs.createReadStream(file),
									Expires: date.toISOString()
								};

								logger.debug(`Uploading to S3`, {key: params.Key, bucket: params.Bucket, expires: params.Expires});

								return this._s3.putObject(params).promise();
							})
						).then(() => {
							const params = {
								Bucket: this._testResultPath.bucket,
								Key: `${folderToUpload}/${path.basename(tmpArchiveFilename)}`,
								Body: fs.createReadStream(tmpArchiveFilename),
								Expires: date.toISOString()
							};

							logger.debug(`Uploading to S3`, {key: params.Key, bucket: params.Bucket, expires: params.Expires});

							return this._s3.putObject(params).promise();
						})
						.then(() => resolve(folderToUpload))
						.catch(err => {
							logger.error(err);

							// S3 API will return that code so we can rethrow it to make it clear for user
							if (err.code === 'NoSuchKey') {
								throw new TestResultNotUploaded(`Test Result ${tmpArchiveFilename} can't be uploaded to S3 bucket`
									, err.stack);
							}

							throw new Error(err);
						});
					})
			});
		}
	}
}

module.exports = File;
