Feature: Open an application

	Scenario: Launch App
		Given the alias mappings
			| Login         | //*[@id="login_button"]                     |
		And I set the default wait time between steps to "10"
		And I set header "User-Agent" with value "Mozilla/5.0 (Zemog 1.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/55.0.2883.87 Safari/537.36"
		And I open the application
		Then I wait "10" seconds for the element found by "Login" to be displayed
