const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

// Load client secrets from the downloaded JSON file
const credentialsPath = path.join(__dirname, 'credentials.json');
const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));

// Define the OAuth2 client
const { client_secret, client_id, redirect_uris } = credentials.installed;
const oAuth2Client = new google.auth.OAuth2(
  client_id,
  client_secret,
  redirect_uris[0]
);

// Generate the URL for the authentication prompt
const authUrl = oAuth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: ['https://www.googleapis.com/auth/drive.metadata.readonly'], // Change this to your desired scopes
});

console.log('Authorize this app by visiting this url:', authUrl);
