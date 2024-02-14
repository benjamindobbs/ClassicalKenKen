/* exported gapiLoaded */
/* exported gisLoaded */
/* exported handleAuthClick */
/* exported handleSignoutClick */

// TODO(developer): Set to client ID and API key from the Developer Console
const CLIENT_ID = '245572615958-jg9jin9k68eh70pk659ifhjc8unbopta.apps.googleusercontent.com';
const API_KEY = 'AIzaSyBC-ZQ8kUACSO71K-1UVM4vj8hl6ZU9Bhw';

// Discovery doc URL for APIs used by the quickstart
const DISCOVERY_DOCS = ["https://sheets.googleapis.com/$discovery/rest?version=v4","https://gmail.googleapis.com/$discovery/rest?version=v1"];

// Authorization scopes required by the API; multiple scopes can be
// included, separated by spaces.
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/userinfo.email';

let tokenClient;
let gapiInited = false;
let gisInited = false;




/**
 * Callback after api.js is loaded.
 */
function gapiLoaded() {
    gapi.load('client', initializeGapiClient);
    document.getElementById('create_button').style.visibility = 'hidden';
    document.getElementById('questionDiv').style.display="none";
    document.getElementById('submissionButtons').style.display="none";
}

/**
 * Callback after the API client is loaded. Loads the
 * discovery doc to initialize the API.
 */
async function initializeGapiClient() {
    await gapi.client.init({
        apiKey: API_KEY,
        discoveryDocs: DISCOVERY_DOCS,
    });
    gapiInited = true;
    maybeEnableButtons();


}

/**
 * Callback after Google Identity Services are loaded.
 */
function gisLoaded() {
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: '', // defined later
    });
    gisInited = true;
    maybeEnableButtons();
}

/**
 * Enables user interaction after all libraries are loaded.
 */
function maybeEnableButtons() {
    if (gapiInited && gisInited) {
        document.getElementById('authorize_button').style.visibility = 'visible';

    }
}

/**
 *  Sign in the user upon button click.
 */
function handleAuthClick() {
    tokenClient.callback = async (resp) => {
        if (resp.error !== undefined) {
            throw (resp);
        }
        document.getElementById('signout_button').style.visibility = 'visible';
        document.getElementById('authorize_button').innerText = 'Refresh';
        document.getElementById('create_button').style.display = 'inline';
    };

    if (gapi.client.getToken() === null) {
        // Prompt the user to select a Google Account and ask for consent to share their data
        // when establishing a new session.
        tokenClient.requestAccessToken({ prompt: 'consent' });
    } else {
        // Skip display of account chooser and consent dialog for an existing session.
        tokenClient.requestAccessToken({ prompt: '' });
    }


}

/**
 *  Sign out the user upon button click.
 */
function handleSignoutClick() {
    const token = gapi.client.getToken();
    if (token !== null) {
        google.accounts.oauth2.revoke(token.access_token);
        gapi.client.setToken('');
        // document.getElementById('content').innerText = '';
        document.getElementById('authorize_button').innerText = 'Authorize';
        document.getElementById('signout_button').style.visibility = 'hidden';
    }

}
async function getIdentity(){
    response = await gapi.client.gmail.users.getProfile({
    "userId": "me"
  });
      return response.result.emailAddress;
}

async function writeScore(score,domain) {
  let identity = await getIdentity();
  let response;
  var resource = {
  "majorDimension": "ROWS",
  "values": [[Date.now(),identity,score,domain]]
  }
  try {
      response = await gapi.client.sheets.spreadsheets.values.append({
          "spreadsheetId": "1XwcpzjVgcBBuKAW6OY9afcW0PW6xFQ5Y_l1kGDwCTzo",
          "range": "A1",
          "insertDataOption": "INSERT_ROWS",
          "responseValueRenderOption": "UNFORMATTED_VALUE",
          "valueInputOption": "RAW",
          "resource": resource
      });
      console.log(response);
      document.getElementById('submitMessage').innerHTML=("Successfully Submitted Score");
  } catch (err) {
      console.log(err.message);
      document.getElementById('submitMessage').innerHTML=("Error Submitting Score. Have Instructor Check Console Log");
      return;
  }
}

async function getQuestionData() {
    questionResponse = await gapi.client.sheets.spreadsheets.values.get({
      spreadsheetId: '1XwcpzjVgcBBuKAW6OY9afcW0PW6xFQ5Y_l1kGDwCTzo',
      range: 'Fall 23 Scores!R3:T240',
    });
    var identity = await getIdentity();
    console.log('Response',questionResponse.result);
    var emailColumn = questionResponse.result.values.map(function(value,index){return value[0]});
    var userRow = emailColumn.indexOf(identity);
    if (userRow >-1){
      var domainColumn = questionResponse.result.values.map(function(value,index){return value[1]});
      var domainPull = domainColumn[userRow];
    }else{
      domainPull=3;
    }
    if (userRow >-1){
        var difficultyColumn = questionResponse.result.values.map(function(value,index){return value[2]});
        var difficultyPull = difficultyColumn[userRow];
      }else{
        difficultyPull="Easy";
      }
      var questionReturn = [domainPull,difficultyPull];
   return questionReturn;


}