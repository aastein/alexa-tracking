'use strict';

require('babelify-es6-polyfill');
const jwtDecode = require('jwt-decode');
const request = require('request');
const AWS = require('aws-sdk');
AWS.config.update({
    region : 'us-east-1',
    endpoint: 'https://dynamodb.us-east-1.amazonaws.com'
});

// Google API variables
const tokenURL = 'https://www.googleapis.com/oauth2/v4/token';
const client_id = '';
const client_secret = '';
const grant_type = 'authorization_code';
const redirect_uri =  '';

let code = '';
let phoneNumber = '';

// Dynamo db tables
const googleTable = 'google';

function updateGoogleUser(phoneNumber, email, code, access_token, expires_in, refresh_token, id_token){
    return new Promise((resolve, reject) =>{
        let params = {
            TableName:googleTable,
            Key:{
                "phoneNumber":phoneNumber
            },
            UpdateExpression: "set email = :email, code = :code, access_token = :access_token, expires_in = :expires_in, refresh_token = :refresh_token, id_token = :id_token",
            ExpressionAttributeValues:{
                ":email":email,
                ":code":code,
                ":access_token":access_token,
                ":expires_in":expires_in,
                ":refresh_token":refresh_token,
                ":id_token":id_token
            },
            ReturnValues:"UPDATED_NEW"
        };
        let docClient = new AWS.DynamoDB.DocumentClient();
        docClient.update(params, function(err, data) {
            if (err) {
                console.error("Unable to update user. Error JSON:", JSON.stringify(err, null, 2));
                reject(err);
            } else {
                console.log("Added item:", JSON.stringify(data, null, 2));
                resolve(data);
            }
        });
    });
}

/*
 Gets an access token and a refresh token to used in google API requests
 */
function getGoogleAccessToken(){

    /*
     Documentation: https://developers.google.com/identity/protocols/OAuth2ForDevices

     Request:
         POST /oauth2/v4/token HTTP/1.1
         Host: www.googleapis.com
         Content-Type: application/x-www-form-urlencoded

         code=4/P7q7W91a-oMsCeLvIaQm6bTrgtp7&
         client_id=8819981768.apps.googleusercontent.com&
         client_secret={client_secret}&
         redirect_uri=https://oauth2.example.com/code&
         grant_type=authorization_code

     Response:
         { access_token: 'ya29.Ci_CA-vDHQDXHY2qzXdCPFpxpmpD7pyVKJk6hAEy_-5EA_O5XIXeGZNZ9FTeh_1Jng',
           token_type: 'Bearer',
           expires_in: 3599,
           id_token: 'eyJhbGciOiJSUzI1NiIsImtpZCI6ImM3ZDQ3MzZlMmY5NDUxZDQyNzVlODkzYzQ3'
         }
     */

    return new Promise((resolve, reject) => {
        let url = tokenURL;
        let payload =  { form: { 'code': code,'client_id': client_id , 'client_secret': client_secret, 'redirect_uri': redirect_uri,'grant_type': grant_type} };
        request.post(
            url,
            payload,
            function (error, response, body) {
                if (!error && response.statusCode == 200) {
                    console.log('Post getGoogleAccessToken succeeded.');
                    resolve(JSON.parse(body));
                } else {
                    console.log('Post getGoogleAccessToken failed. Status code: ', response.statusCode, '. Body: ', JSON.parse(body));
                    reject(error);
                }
            }
        );
    });
}

exports.handler = (event, context, callback) => {

    console.log('String params:', event.queryStringParameters.code);

    code = event.queryStringParameters.code;
    phoneNumber = event.queryStringParameters.state;

    getGoogleAccessToken().then((response) => {
        console.log('Access token response: ', response);

        /*
            todo: if the user has already authorized this app we will not get a refresh token back.
                  we should instead search the db for the existing refresh token for the users email.
         */

        let access_token = response.access_token;
        let expires_in = response.expires_in;
        let refresh_token = response.refresh_token;
        let id_token = response.id_token;
        let email = jwtDecode(id_token).email;

        console.log("Email is: ", email);
        console.log("Phone number is: ", phoneNumber);

        updateGoogleUser(phoneNumber, email, code, access_token, expires_in, refresh_token, id_token).then(() => {
        });
    });
};
