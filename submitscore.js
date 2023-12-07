// Function to load the Google Sheets API client library
function loadSheetsApi() {
    gapi.load('client', function () {
      gapi.client.init({
        apiKey: 'AIzaSyBC-ZQ8kUACSO71K-1UVM4vj8hl6ZU9Bhw', // Replace with your API key
        discoveryDocs: ['https://sheets.googleapis.com/$discovery/rest?version=v4'],
      }).then(function () {
        console.log('Google Sheets API client loaded');
        appendToSheet();
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
  
  // Load the Google API client library and authenticate
  function handleClientLoad() {
    gapi.load('client:auth2', loadSheetsApi);
  }
  