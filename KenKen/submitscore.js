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
const SCOPES = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email';


let tokenClient;
let accessToken = null;
let gapiInited = false;
let gisInited = false;
let pickerInited = false;




/**
 * Callback after api.js is loaded.
 */
function gapiLoaded() {
    gapi.load('client', initializeGapiClient);
    gapi.load('picker', onPickerApiLoad);
    document.getElementById('create_button').style.visibility = 'hidden';
    document.getElementById('clear_button').style.visibility = 'hidden';
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
function onPickerApiLoad() {
    pickerInited = true;
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

    // generateBoard();
    // setInterval(updateTime, 1000);
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
    //create and show picker
    const showPicker = () => {
        // TODO(developer): Replace with your API key
        const picker = new google.picker.PickerBuilder()
            .addView(google.picker.DocsView(google.picker.ViewId.SPREADSHEETS))
            .setFileIds('1jlp-iDAbyPX-Rj2jwaK4w1W2sa4QeF7wT0cFo973jM0')
            .setOAuthToken(accessToken)
            .setDeveloperKey(API_KEY)
            .setAppId('245572615958')
            // .setFileIds("1jlp-iDAbyPX-Rj2jwaK4w1W2sa4QeF7wT0cFo973jM0")
            .build();
        picker.setVisible(true);
      }

    tokenClient.callback = async (resp) => {
        if (resp.error !== undefined) {
            throw (resp);
        }
        accessToken = resp.access_token;
        showPicker();
        document.getElementById('signout_button').style.visibility = 'visible';
        document.getElementById('authorize_button').innerText = 'Refresh';
        document.getElementById('create_button').style.visibility = 'visible';
        document.getElementById('clear_button').style.visibility = 'visible';
        // var profile = auth2.currentUser.get().getBasicProfile();
        // console.log(profile.getName());
        // console.log(profile.getEmail());
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
        document.getElementById('content').innerText = '';
        document.getElementById('authorize_button').innerText = 'Authorize';
        document.getElementById('signout_button').style.visibility = 'hidden';
    }

}
async function getIdentity(){
    const token = gapi.client.getToken().access_token;
    let response = await fetch('https://www.googleapis.com/oauth2/v1/userinfo?access_token='+token);
    let parsed = await response.json();
    return parsed.email;
}


async function writeScore(score) {
  let identity = await getIdentity();
  let response;
  var resource = {
  "majorDimension": "ROWS",
  "values": [[Date.now(),identity,score]]
  }
  try {
      // Fetch first 10 files
      response = await gapi.client.sheets.spreadsheets.values.append({
          "spreadsheetId": "1jlp-iDAbyPX-Rj2jwaK4w1W2sa4QeF7wT0cFo973jM0",
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

async function getRank() {
    rankResponse = await gapi.client.sheets.spreadsheets.values.get({
      spreadsheetId: '1jlp-iDAbyPX-Rj2jwaK4w1W2sa4QeF7wT0cFo973jM0',
      range: 'Ranks!A2:C',
    });
    var identity = await getIdentity();
    // console.log('Response',rankResponse.result);
    var emailColumn = rankResponse.result.values.map(function(value,index){return value[0]});
    var userRow = emailColumn.indexOf(identity);
    if (userRow >-1){
      var rankColumn = rankResponse.result.values.map(function(value,index){return value[2]});
      var userRank = rankColumn[userRow];
    }else{
      userRank=1;
    }

    // console.log('Idendity',identity);
    // console.log('All Emails', emailColumn);
    // console.log('User Row Index',userRow);
    // console.log('All Ranks', rankColumn);
    // console.log('Expected Rank',userRank);
   return userRank;


}


