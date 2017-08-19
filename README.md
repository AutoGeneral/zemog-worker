# Zemog Worker

Zemog Worker is a part of distributed two-tier system to run scheduled automated 
[Iridium](https://github.com/AutoGeneral/IridiumApplicationTesting) E2E tests at scale.

System consists of two parts:
- [master](https://github.com/AutoGeneral/zemog-master) (AWS Lambda) that schedules tests by adding tasks to AWS SQS
- [worker](https://github.com/AutoGeneral/zemog-worker) (Node.js app) that gets tasks from the queue, downloads latest test from S3 bucket
and executes them. It is also responsible for sending notifications about failing tests
and save failed results to S3 bucket

Here is the high level diagram how it works:

```
 |----------------------------|   Schedules tests using Cloudwatch Events  |-----------|
 | Zemog Master (AWS Lambda)  | -----------------------------------------> | AWS SQS   |
 |----------------------------|                                            |-----------|
                                                                                 |
                             Multiple Zemog Workers get test scedule from SQS    |
                        |--------------------------------------------------------|
                        |                           |
                        |                           |
               |-----------------|          |-----------------|
               | Zemog Worker    |          | Zemog Worker    |          ....
               |-----------------|          |-----------------|
                 |    |    |    |                  ... 
      Excecutes  |    |    |    |
      tests      |    |    |    |    Downloads archive with tests from S3    |-----------|
      using      |    |    |    |------------------------------------------  | AWS S3    |
      Iridium    |    |    |                                                 |-----------|
                 |    |    |        Saves failed tests results to S3         |-----------|
                 |    |    |---------------------------------------------->  | AWS S3    |
                 |    |                                                      |-----------|
                 |    |     Sends notifications to VictorOps/Clickatell
                 |    |---------------------------------------------------> ...
                 |     
               |-----------------|
               | Your Website    |
               |-----------------|
                
```

## Build

**Important:** Iridium binary is not provided. You have to download the latest binary by yourself
(use A&G CI server or [binary from Github](https://github.com/mcasperson/IridiumApplicationTesting/releases)) and put it to a folder specified in your config's 
`iridiumPath` property.

**Important:** Iridium performance and resources consumption may vary among different Iridium builds.
The exact reason is still a mystery for me, but try to avoid using builds created by Travis CI

Install dependencies. I'd recommend to use `yarn` but `npm` will do as well

```
npm install   
# or
yarn install
```

Run using npm, yarn or node itself:

```
npm start
# or
yarn start
# or 
node worker.js
```

You can run app with flag `-h` or `--help` to get information about arguments you can use.
To specify a config. Default config is `./config/default.json`

```
node worker.js --config=./config/cloudwatch.json 
```

# Configuration

Configuration file will be validated against JSON schema file `./config/config.schema.json`.
Please read it to find out more about configuration parameters

# How to use 

## Expecting SQS messages format

```json
{
    "test": "website-tests-1", 
    "app": "website",
    "location": "s3://bucket-with-tests/tests/tests-1.zip"
}
```

Worker expects .zip archive with test to contain all the things 
needed to run those tests including:

## Required changes in Iridium tests

Look inside `example` folder to see the example of working test

### Headers 

You have to add a few additional steps to the first scenario
to set some HTTP headers preventing requests to be blocked by our production security tools.

Something like:

``` 
  ...
  And I set header "x-distil-secure" with value "header"
  And I set header "User-Agent" with value "Mozilla/5.0 (Zemog 1.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/55.0.2883.87 Safari/537.36"
```
 
### zemog.json

E2E tests must have one and only one `zemog.json` file at the top level (usually `/test` folder) 
where you can define multiple tests with independent [Iridium launch configuration](https://autogeneral.gitbooks.io/iridiumapplicationtesting-gettingstartedguide/content/system_property_reference.html).

Use `./` in paths and it will be replaced by an absolute paths to your tests folder. For example,
`./feature/login/` will be replaced by something like `/tmp/zemog-temp-folder-12215124/app-tests/feature/login/`
so use it for `-DimportBaseUrl`, `-Dconfiguration` and other parameters.
 
Here is an example of that configuration.
 
```
{
	// Version of configuration format (the latest is 1)
	"version": 1, 
	
	// Zemog.json must have configuration at least for one test
	// Configuration for test #1
	"AppShortTest": {
	
		// Each test must have launch configuration parameters, 
		// those parameters will be passed to Iridium
		// (./* paths will be replaced by a path to a temporary directory created by worker)
		"launchParameters": [
			"-DimportBaseUrl=./",
			"-DtestSource=example.feature",
			"-DtestDestination=PHANTOMJS",
			"-DtestRetryCount=2",
			"-DsaveReportsInHomeDir=false",
			"-DappURLOverride=https://localhost:8080/index.html"
		]
	},
	
	// Configuration for test #2
	"AppLongTest": {
		"launchParameters": [
			...
		]
	},
	...
}
```

## Standalone (local) execution

You need to put Iridim .jar file to a folder inside Worker's root as
`<zemog-worker-folder>/iridium/IridiumApplicationTesting.jar` 
(or specify another path to `iridiumPath` in the config)

Zemog Worker has a Standalone (local) mode that created to help you test your tests (yay).
Run worker with a `--help` argument to learn more

```
node ./worker.js --dir=/home/user/projects/my-website/test --test=connectionTest
```

## Contributing

When contributing to this repository, please first discuss the change you wish to make via issue,
email, or any other method with the owners of this repository before making a change.

Please submit a pull request to us with a clear list of what you've done

1. Ensure any install or build dependencies are removed before the end of the layer when doing a
   build.
2. Update the README.md with details of changes to the interface, this includes new environment
   variables, exposed ports, useful file locations and container parameters.
3. Increase the version numbers in any examples files and the README.md to the new version that this
   Pull Request would represent. The versioning scheme we use is [SemVer](http://semver.org/).
5. When you send a pull request, we will love you forever if you include tests. We can always use better test coverage.
6. You may merge the Pull Request in once you have the sign-off of project's maintainers, or if you
   do not have permission to do that, you may request the reviewer to merge it for you.

## Tests

We have ESLint and Mocha that will run tests and check codestyle

```
npm run-script lint
npm test
# or
yarn run lint
yarn run test
```

### Coding conventions

Start reading our code and you'll get the hang of it.

 * We use `.editorconfig`.
 * We use `eslint` 
 * We avoid overly complex or obtuse logic, code should mostly document itself.
   Before you write a code comment think if you can make it describe itself first.
 * This is shared software. Consider the people who will read your code, and make it look nice for them.
   It's sort of like driving a car: Perhaps you love doing donuts when you're alone,
   but with passengers the goal is to make the ride as smooth as possible.
