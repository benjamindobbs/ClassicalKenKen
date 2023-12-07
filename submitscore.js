// Load the Google Sheets API client library and authenticate using OAuth2
function loadSheetsApi() {
    gapi.load('client', function () {
      gapi.client.init({
        apiKey: 'AIzaSyBC-ZQ8kUACSO71K-1UVM4vj8hl6ZU9Bhw', // Replace with your API key
        clientId: '245572615958-jg9jin9k68eh70pk659ifhjc8unbopta.apps.googleusercontent.com', // Replace with your OAuth2 client ID
        discoveryDocs: ['https://sheets.googleapis.com/$discovery/rest?version=v4'],
        scope: 'https://www.googleapis.com/auth/spreadsheets',
      }).then(function () {
        console.log('Google Sheets API client loaded');
        gapi.auth2.getAuthInstance().signIn().then(appendToSheet);
      }, function (error) {
        console.error('Error loading Google Sheets API client:', error);
      });
    });
  }
  
  // Function to append a value to a specific cell in a Google Sheet
  function appendToSheet() {
    const spreadsheetId = '1Vdi4qN39bKY7nUumtKDzwhhJERcHdtelAPikodLBtwc'; // Replace with your spreadsheet ID
    const value = 'Hello, Google Sheets!';
    const range = 'Sheet1!A1';
  
    const request = gapi.client.sheets.spreadsheets.values.append({
      spreadsheetId: spreadsheetId,
      range: range,
      valueInputOption: 'RAW',
      resource: {
        values: [[value]],
      },
    });
  
    request.then(function (response) {
      console.log('Value added successfully:', response.result);
    }, function (error) {
      console.error('There was a problem adding the value:', error.result.error.message);
    });
  }
  
  // Load the Google API client library and initiate authentication
  function handleClientLoad() {
    gapi.load('client:auth2', loadSheetsApi);
  }
  