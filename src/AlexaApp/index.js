'use strict';

require('babelify-es6-polyfill');
const Alexa = require('alexa-sdk');
const appId = 'amzn1.ask.skill.a3feba90-2088-4a01-87c5-3f35009fad1c';
const AWS = require('aws-sdk');
const request = require('request');
const base64url = require('base64url');
const sns = new AWS.SNS();

AWS.config.update({
    region : 'us-east-1',
    endpoint: 'https://dynamodb.us-east-1.amazonaws.com'
});

// Locale specific spoken responses
const languageStrings = {
    "en-US": {
        "translation": {
            "PROMPT_SETUP": "Before I can help you, tell me your email provider and phone number.",
            "PROMPT_CELL_NUMBER": "Before I can help you, tell me your phone number.",
            "PROMPT_EMAIL_PROVIDER": "Before I can help you, tell me your email provider.",
            "ACKNOWLEDGE_EMAIL_SET": "Thanks, your email has been linked to this device.",
            "ACKNOWLEDGE_TEXT_SENT": "Thanks, you should receive a text shortly.",
            "ACKNOWLEDGE_TEXT_SENT_2": "You should receive a text shortly to complete Narwhal setup.",
            "DELIVERED_EDD_RESPONSE": "Your package was delivered on ",
            "DELIVERED_EDD_RESPONSE_RETAILER_1": "Your package from ",
            "DELIVERED_EDD_RESPONSE_RETAILER_2": " was delivered on ",
            "JUST_SHIPPED_SHIPPED_ON_RESPONSE": "Your package was shipped on ",
            "JUST_SHIPPED_SHIPPED_ON_RESPONSE_RETAILER_1": "Your package from ",
            "JUST_SHIPPED_SHIPPED_ON_RESPONSE_RETAILER_2": " was shipped on ",
            "JUST_SHIPPED_EDD_RESPONSE" : " and will arrive on ",
            "IN_TRANSIT_EDD_RESPONSE": "Your package will arrive on ",
            "IN_TRANSIT_RESPONSE_RETAILER_1": "Your package from ",
            "IN_TRANSIT_EDD_RESPONSE_RETAILER_2": " will arrive on ",
            "IN_TRANSIT_LOCATION_RESPONSE_RETAILER_2": " was last in ",
            "IN_TRANSIT_LOCATION_RESPONSE": "Your package was last in ",
            "EXCEPTION_EDD_RESPONSE" : "The carrier had a problem delivering you package. Check with the carrier to see what's up!",
            "SKILL_NAME": "Narwhal",
            "HELP_MESSAGE":  "What can I help you with?",
            "HELP_REPROMPT": "What can I help you with?",
            "STOP_MESSAGE": "Goodbye!",
            "SETUP_CARD_HEADER": "Setup Narwhal",
            "SETUP_CARD_BODY_SET_NUMBER": "Tell Narwhal your email and number to complete setup.",
            "SETUP_CARD_BODY_PT1": "Go to ",
            "SETUP_CARD_BODY_PT2": " and enter the code: "
        }
    }
};

// Constants to get users email account
const googleTokenURL = 'https://www.googleapis.com/oauth2/v4/token';
const googleClientID = '';
const googleClientSecret = '';
const googleAPIKey = '';
const googleURLShortnerURL = 'https://www.googleapis.com/urlshortener/v1/url';

// URL for google OAuth, separated by the state parameter used to pass users phone number. Phone number is used as foreign key to link amazon device and email
const authURLFront = 'https://accounts.google.com/o/oauth2/auth?access_type=offline&scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fgmail.readonly%20email&state=';
const authURLBack = '&response_type=code&client_id=' + googleClientID +'&redirect_uri=https%3A%2F%2Fk8j9ih1dea.execute-api.us-east-1.amazonaws.com%2Fprod%2FputGmailKey';

// Constants to get user emails
const googleGmailURL = 'https://www.googleapis.com/gmail/v1/users/';
const maxMesssages = 250;
const messagesURI = '/messages?maxResults=' + maxMesssages;
const messageURI = '/messages/';
const messageFormat = '?format=full';
const emailParseGoal = 'Tracking:';

// Dynamo db tables
const googleTable = 'google';
const amazonTable = 'amazon';

// Contextual user data
let amazonUserInfo = {};
let googleUserInfo = {};
let amzID = "";
let that = this;



////////////////////////// Helper Methods /////////////////////////////

// Misc. helper methods

function createAuthURL(phoneNumber){

    /*
     Documentation: https://developers.google.com/url-shortener/v1/getting_started

     Request:
         POST https://www.googleapis.com/urlshortener/v1/url
         Content-Type: application/json

         {"longUrl": "http://www.google.com/"}

     Response:
         {
         "kind": "urlshortener#url",
         "id": "http://goo.gl/fbsS",
         "longUrl": "http://www.google.com/"
         }
     */

    return new Promise((resolve, reject) => {
        let url = googleURLShortnerURL + '?key=' + googleAPIKey;
        let longUrl = authURLFront + phoneNumber + authURLBack;
        let payload =  { json: { 'longUrl': longUrl } };
        request.post(
            url,
            payload,
            function (error, response, body) {
                if (!error && response.statusCode == 200) {
                    console.log('Post shorten url succeeded.');
                    resolve(body);
                } else {
                    console.log('Post shorten url failed. Status code: ', response.statusCode, '. Body: ', JSON.parse(body));
                    reject(error);
                }
            }
        );
    });
}

// Alexa event helper methods

function slotValue(slotName) {
    try {
        return that.event.request.intent.slots[slotName].value;
    } catch (e) {
        console.error("missing intent in request: " + slotName, e);
        return null;
    }
}

function getAmzID() {

    try {
        console.log('Getting AmzID: ', that.event.session.user.userId);
        return that.event.session.user.userId;
    } catch (e) {
        console.error("missing user in request: ", e);
        return null;
    }
}

////////////////////////// Simple API Methods ////////////////////////

// Amazon SNS API

function sendText(message, phoneNumber){
    // Documentation: http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/SNS.html
    return new Promise((resolve, reject) => {
        let params = { "Message": message, "PhoneNumber": ('+1' + phoneNumber)};
        sns.publish(params, function(err, data) {
            if (err) {
                console.log(err, err.stack);
                reject(err);
            } else {
                console.log(data);
                resolve(data);
            }
        });
    });
}

// Amazon DynamoDB API

function addNewAmazonID(){
    return new Promise((resolve, reject) =>{
        let amzID = getAmzID(that.event);
        let params = {
            'TableName': amazonTable,
            'Item': {
                'amzID': amzID
            }
        };
        let docClient = new AWS.DynamoDB.DocumentClient();
        docClient.put(params, function(err, data) {
            if (err) {
                console.error("Unable to add new Amazon ID. Error JSON:", JSON.stringify(err, null, 2));
                reject(err);
            } else {
                console.log("Added new Amazon ID:", JSON.stringify(data, null, 2));
                resolve(data);
            }
        });
    });
}

function queryAmazonUserByAmzID (amzID) {
    return new Promise((resolve, reject) => {
        let params = {
            TableName : amazonTable,
            KeyConditionExpression: "#amzID = :amzID",
            ExpressionAttributeNames:{
                "#amzID": "amzID"
            },
            ExpressionAttributeValues: {
                ":amzID":amzID
            }
        };
        let docClient = new AWS.DynamoDB.DocumentClient();
        docClient.query(params, function(err, data) {
            if (err) {
                console.error("Unable to query table: amazon by amazon ID. Error:", JSON.stringify(err, null, 2));
                reject(err);
            } else {
                console.log("Query table: amazon by amazon ID successful");
                resolve(data)
            }
        });
    });
}

function queryGoogleUserByPhone (phoneNumber) {
    return new Promise((resolve, reject) => {
        let params = {
            TableName : googleTable,
            KeyConditionExpression: "#phoneNumber = :phoneNumber",
            ExpressionAttributeNames:{
                "#phoneNumber": "phoneNumber"
            },
            ExpressionAttributeValues: {
                ":phoneNumber":phoneNumber
            }
        };
        let docClient = new AWS.DynamoDB.DocumentClient();
        docClient.query(params, function(err, data) {
            if (err) {
                console.error("Unable to query table: google by phone number. Error:", JSON.stringify(err, null, 2));
                reject(err);
            } else {
                console.log("Query table: google by phone number successful");
                resolve(data)
            }
        });
    });
}

function updateEmailProvider(emailProvider){
    return new Promise((resolve, reject) =>{
        emailProvider = emailProvider.toLowerCase();
        let amzID = getAmzID(that.event);
        let params = {
            TableName:amazonTable,
            Key:{
                "amzID":amzID
            },
            UpdateExpression: "set emailProvider = :emailProvider",
            ExpressionAttributeValues:{
                ":emailProvider":emailProvider
            },
            ReturnValues:"UPDATED_NEW"
        };
        let docClient = new AWS.DynamoDB.DocumentClient();
        docClient.update(params, function(err, data) {
            if (err) {
                console.error("Unable to add email provider for user. Error JSON:", JSON.stringify(err, null, 2));
                reject(err);
            } else {
                console.log("Added email provider for user:", JSON.stringify(data, null, 2));
                resolve(data);
            }
        });
    });
}

function updatePhoneNumber(phoneNumber){
    return new Promise((resolve, reject) =>{
        let amzID = getAmzID(that.event);
        let params = {
            TableName:amazonTable,
            Key:{
                "amzID":amzID
            },
            UpdateExpression: "set phoneNumber = :phoneNumber",
            ExpressionAttributeValues:{
                ":phoneNumber":phoneNumber
            },
            ReturnValues:"UPDATED_NEW"
        };
        let docClient = new AWS.DynamoDB.DocumentClient();
        docClient.update(params, function(err, data) {
            if (err) {
                console.error("Unable to add phone number for user. Error JSON:", JSON.stringify(err, null, 2));
                reject(err);
            } else {
                console.log("Added phone number for user:", JSON.stringify(data, null, 2));
                resolve(data);
            }
        });
    });
}

function updateGoogleAccessToken(access_token, expires_in){
    return new Promise((resolve, reject) =>{
        let phoneNumber = googleUserInfo.phoneNumber;
        let params = {
            TableName:googleTable,
            Key:{
                "phoneNumber":phoneNumber
            },
            UpdateExpression: "set access_token = :access_token, expires_in = :expires_in",
            ExpressionAttributeValues:{
                ":access_token":access_token,
                ":expires_in":expires_in
            },
            ReturnValues:"UPDATED_NEW"
        };
        let docClient = new AWS.DynamoDB.DocumentClient();
        docClient.update(params, function(err, data) {
            if (err) {
                console.error("Unable to update google user access token. Error JSON:", JSON.stringify(err, null, 2));
                reject(err);
            } else {
                console.log("Added google access token:", JSON.stringify(data, null, 2));
                googleUserInfo.access_token = data.Attributes.access_token;
                googleUserInfo.expires_in = data.Attributes.expires_in;
                resolve(data);
            }
        });
    });
}

// Google API

function refreshGoogleAccessToken(){
    /*
     Documentation: https://developers.google.com/identity/protocols/OAuth2WebServer
     */

    return new Promise((resolve, reject) => {
        let url = googleTokenURL;
        let payload =  { form: { 'client_id': googleClientID , 'client_secret': googleClientSecret, 'refresh_token': googleUserInfo.refresh_token,'grant_type': 'refresh_token'} };
        console.log('Refreshing token. API URL: ', url);
        request.post(
            url,
            payload,
            function (error, response, body) {
                if (!error && response.statusCode == 200) { // get refresh token successful
                    body = JSON.parse(body);
                    console.log("Refresh google access token succeed.", body);
                    updateGoogleAccessToken(body.access_token, body.expires_in).then(() => {
                        resolve(body);
                    }, function(err){
                        console.log('Error on updating google user token: ', err);
                        reject(err);
                    });

                } else {
                    console.log("Post getGoogleEmails failed. Status code: ", response.statusCode, ". Body: ", JSON.parse(body));
                    reject(error);
                }
            }
        );
    });

}

function getGoogleEmails(){

     /*
     Documentation: https://developers.google.com/gmail/api/v1/reference/users/messages/list

     Request:
     GET https://www.googleapis.com/gmail/v1/users/{email}/messages?access_token={access_token}

     Response:
         {
             "messages": [
                 {
                     "id": string,
                     "threadId": string,
                     "labelIds": [
                        string
                        ],
                     "snippet": string,
                     "historyId": unsigned long,
                     "internalDate": long,
                     "payload": {
                         "partId": string,
                         "mimeType": string,
                         "filename": string,
                         "headers": [
                            {
                             "name": string,
                             "value": string
                            }
                         ],
                         "body": users.messages.attachments Resource,
                         "parts": [
                             (MessagePart)
                         ]
                     },
                     "sizeEstimate": integer,
                     "raw": bytes
                 }
             ],
             "nextPageToken": string,
             "resultSizeEstimate": unsigned integer
         }
    */

    return new Promise((resolve, reject) => {
         let url = googleGmailURL + googleUserInfo.email + messagesURI + '&access_token=' + googleUserInfo.access_token;
        console.log('Fetching emails. API URL: ', url);
         request.get(
             url,
             function (error, response, body) {
                 if (!error && response.statusCode == 200) {
                    resolve(JSON.parse(body));
                 } else {
                    console.log("Post getGoogleEmails failed. Status code: ", response.statusCode, ". Body: ", JSON.parse(body));
                     if(response.statusCode >= 400 && response.statusCode < 500) {
                         refreshGoogleAccessToken().then(() => {
                             getGoogleEmails().then((body) => {
                                 resolve(body)
                             }, function (err){
                                 reject(err);
                             });
                         });
                     }
                }
             }
         );
    });
 }

function getGoogleEmail(messageID){

    /*
     Documentation: https://developers.google.com/gmail/api/v1/reference/users/messages/list

     Request:
     GET https://www.googleapis.com/gmail/v1/users/{email}/messages/id?access_token={access_token}

     */

    return new Promise((resolve, reject) => {
        let url = googleGmailURL + googleUserInfo.email + messageURI + messageID + messageFormat +'&access_token=' + googleUserInfo.access_token; //console.log('Fetching email. API URL: ', url);
        request.get(
            url,
            function (error, response, body) {
                if (!error && response.statusCode == 200) {
                    //console.log("Post getGoogleEmail succeeded.");
                    resolve(JSON.parse(body));
                } else {
                    console.log("Post getGoogleEmail failed. Status code: ", response.statusCode, ". Body: ", JSON.parse(body));
                    if(response.statusCode >= 400 && response.statusCode < 500) {
                        refreshGoogleAccessToken().then(() => {
                            getGoogleEmail(messageID).then((body) => {
                                resolve(body)
                            }, function (err){
                                reject(err);
                            });
                        });
                    }
                }
            }
        );
    });
}

// Narvar API

function getTrackingInfo(carrier, trackingNumber){
    return new Promise((resolve, reject) => {
        console.log('Fetching tracking info: ', carrier, trackingNumber);
        let url = 'https://narvar.com/gap/trackinginfo/' + carrier + '?tracking_numbers=' + trackingNumber;
        request.get(
            url,
            function (error, response, body) {
                if (!error && response.statusCode == 200) {
                    resolve(JSON.parse(body));
                } else {
                    console.log("Get tracking info failed. Status code: ", response.statusCode, ". Body: ", JSON.parse(body));
                    reject(error);
                }
            }
        );
    });
}

/////////////////////////////////////////////////////////////////////

function authWrapper(context){
    console.log('Auth wrapper called');
    that = context;
    return new Promise((resolve, reject) =>{
        amzID = getAmzID();
        queryAmazonUserByAmzID(amzID).then((amzIDs) => {
            if (amzIDs.Items.length > 0){  console.log('Amazon user is recognized');
                amazonUserInfo = amzIDs.Items[0];
                if(amazonUserInfo.emailProvider){ // User has an email provider
                    if (amazonUserInfo.phoneNumber) { // User has a phone number
                        switch(amazonUserInfo.emailProvider){
                            case 'gmail':
                                queryGoogleUserByPhone(amazonUserInfo.phoneNumber).then((googlers) =>{
                                    if (googlers.Items.length > 0) { console.log('Google user is recognized');
                                        googleUserInfo = googlers.Items[0];
                                        if (googleUserInfo.access_token) { console.log("User has an access token");
                                            resolve(true);
                                        } else { // User does not have an access token
                                            console.log('User does not have an access token');
                                            createAuthURL(amazonUserInfo.phoneNumber).then((shortURLResponse) => {
                                                sendText(shortURLResponse.id, amazonUserInfo.phoneNumber).then(() => {
                                                    that.emit(':tell', that.t("ACKNOWLEDGE_TEXT_SENT"));
                                                    resolve(false);
                                                }, function (err) { // Errors thrown by send text
                                                    console.log("Error: ", err);
                                                    resolve(false)
                                                });
                                            });
                                        }
                                    } else { // Google user is not recognized.
                                        console.log('User has not linked a Gmail account.');
                                        createAuthURL(amazonUserInfo.phoneNumber).then((shortURLResponse) => {
                                            sendText(shortURLResponse.id, amazonUserInfo.phoneNumber).then(() => {
                                                that.emit(':tell', that.t("ACKNOWLEDGE_TEXT_SENT"));
                                                resolve(false);
                                            }, function (err) { // Errors thrown by send text
                                                console.log("Error: ", err);
                                                resolve(false)
                                            });
                                        });
                                    }
                                }, function (err) { // Errors thrown by send text
                                    console.log('User has not linked a Gmail account.', err);
                                    createAuthURL(amazonUserInfo.phoneNumber).then((shortURLResponse) => {
                                        sendText(shortURLResponse.id, amazonUserInfo.phoneNumber).then(() => {
                                            that.emit(':tell', that.t("ACKNOWLEDGE_TEXT_SENT_2"));
                                            resolve(false);
                                        }, function (err) { // Errors thrown by send text
                                            console.log("Error: ", err);
                                            resolve(false)
                                        });
                                    });
                                });

                                break;
                            default:
                                break;
                        }
                    } else { // User does not have a phone number
                        console.log('User does not have a phone number');
                        let phoneNumber = slotValue("Number");
                        if (phoneNumber) { //set number
                            console.log("Setting user number: ", phoneNumber);
                            updatePhoneNumber(phoneNumber).then(() => {
                                createAuthURL(phoneNumber).then((shortURLResponse) => {
                                    sendText(shortURLResponse.id, phoneNumber).then(() => {
                                        that.emit(':tell', that.t("ACKNOWLEDGE_TEXT_SENT"));
                                        resolve(false);
                                    }, function (err) { // Errors thrown by send text
                                        console.log("Error: ", err);
                                        resolve(false)
                                    });
                                });
                            });
                        } else {
                            console.log("User did not provide a number. Prompting user for phone number.");
                            that.emit(':tellWithCard',
                                that.t("PROMPT_CELL_NUMBER"),
                                that.t("SETUP_CARD_HEADER"),
                                that.t("SETUP_CARD_BODY_SET_NUMBER"));
                            resolve(false);
                        }
                    }
                } else { // User does not have an email provider
                    console.log('User does not have an email provider');
                    let emailProvider = slotValue("EmailProvider");
                    let phoneNumber = slotValue("Number");

                    if (emailProvider && phoneNumber){

                        emailProvider = (emailProvider == 'google') ? 'gmail' : emailProvider;

                        console.log('Setting user email provider: ', emailProvider);
                        updateEmailProvider(emailProvider).then(() => {
                            console.log("Setting user number after email: ", phoneNumber);
                            updatePhoneNumber(phoneNumber).then(() => {
                                createAuthURL(phoneNumber).then((shortURLResponse) => {
                                    sendText(shortURLResponse.id, phoneNumber).then(() => {
                                        that.emit(':tell', that.t("ACKNOWLEDGE_TEXT_SENT"));
                                        resolve(false);
                                    }, function (err) { // Errors thrown by send text
                                        console.log("Error: ", err);
                                        resolve(false)
                                    });
                                });
                            });
                        });

                    } else if (emailProvider) {
                        updateEmailProvider(emailProvider).then(() => {
                            that.emit(':tellWithCard',
                                that.t("PROMPT_CELL_NUMBER"),
                                that.t("SETUP_CARD_HEADER"),
                                that.t("SETUP_CARD_BODY_SET_NUMBER"));
                            resolve(false);
                        });
                    } else {
                        that.emit(':tellWithCard',
                            that.t("PROMPT_EMAIL_PROVIDER"),
                            that.t("SETUP_CARD_HEADER"),
                            that.t("SETUP_CARD_BODY_SET_NUMBER"));
                        resolve(false);
                    }
                }
            } else { // Amazon user is not recognized
                console.log("Amazon user is not recognized");
                addNewAmazonID().then(() => {
                    that.emit(':tellWithCard',
                        that.t("PROMPT_SETUP"),
                        that.t("SETUP_CARD_HEADER"),
                        that.t("SETUP_CARD_BODY_SET_NUMBER"));
                    resolve(false);
                });
            }
        }, function(err){
            console.log('Amazon user info query encountered an error.', err);
        });
    });
}

function getDeliveryDate(){

    let queryRetailer = slotValue("Retailer");
    let queryDate = slotValue("Date");
    let speechOutput;

    getGoogleEmails().then((inbox) => {

        if(inbox.resultSizeEstimate > 0){
            var ids = inbox.messages.map((email) => { return email.id; }); console.log('ids: ', ids);

            var promiseEmails = ids.map((id) => {
                return getGoogleEmail(id);
            });

            Promise.all(promiseEmails).then((emails) => {

                /*
                    This entire filtering logic only applies to tracking emails from Nordstom. Emails from other retailers
                    probably will not be caught by this logic due to email body parsing.
                 */

                /*
                    Filter array of emails into an array of tracking parameters. The tracking parameters are parsed in the
                    email body.
                */
                let trackingParamsArray = emails.filter((email) => { //filter for emails with payload
                   return email.payload;
                }).filter((email) => { // filter for emails with payload.parts
                    return email.payload.parts;
                }).filter((email) => { //filter for emails with payload.parts[0].body
                    return email.payload.parts[0].body;
                }).filter((email) => { //filter for emails with payload.pats[0].body.data
                    return email.payload.parts[0].body.data;
                }).filter((email) => { //filter for emails which contain emailParseGoal in the decoded part body
                    let data = base64url.decode(email.payload.parts[0].body.data); //console.log('Email data is: ', data);
                    // Filter emails which contain the retailer name
                    if(queryRetailer){
                        return (data.includes(emailParseGoal) && data.includes(queryRetailer));
                    } else {
                        return data.includes(emailParseGoal);
                    }
                }).map((email) => {
                    let data = base64url.decode(email.payload.parts[0].body.data);
                    if (data.includes(emailParseGoal)) {
                        let splitted = data.split(emailParseGoal);
                        let trackingStart = 0;
                        let carrierStart = splitted[0].lastIndexOf('\n');
                        let trackingEnd = splitted[1].indexOf('<');
                        let trackingNumber = splitted[1].substring(trackingStart, trackingEnd).replace(/[^\w\s]/gi, '').trim();
                        let carrier = splitted[0].substring(carrierStart).trim();
                        let trackingParams = {"carrier": carrier, "trackingNumber": trackingNumber};
                        console.log('Tracking params:', trackingParams);
                        return trackingParams
                    }
                });

                /*
                    This code block is to filter out duplicate tracking numbers.
                 */

                trackingParamsArray = trackingParamsArray.filter((param) => {

                    console.log('Tracking params array: ', JSON.stringify(trackingParamsArray, null, 2));

                    // Get all indexes of a tracking parameter
                    var indexes = [];
                    for(let i = 0; i < trackingParamsArray.length; i++) {
                        if (trackingParamsArray[i].trackingNumber == param.trackingNumber) {
                            indexes.push(i);
                        }
                    }
                    console.log('Param is present at index/es: ', indexes);
                    if (indexes.length > 1){
                        for(let i = indexes.length-1; i >=1 ; i--) {
                            trackingParamsArray.splice(indexes[i],1)
                        }
                    }
                    return true;
                });

                // todo: save tracking params array to database which are new

                console.log("Tracking params array: ", trackingParamsArray);

                if (trackingParamsArray.length > 0) {

                    var promiseTrackingInfo = trackingParamsArray.map((trackingParam) => {
                        return getTrackingInfo(trackingParam.carrier, trackingParam.trackingNumber);
                    });

                    Promise.all(promiseTrackingInfo).then((trackingInfoArray) => {

                        console.log('Tracking Info Array: ', JSON.stringify(trackingInfoArray, null, 2));

                        let lastPackage = trackingInfoArray[0];

                        console.log('lastPackage: ', JSON.stringify(lastPackage, null, 2));

                        let projectedDeliveryDate;
                        let spokenDeliveryDate;

                        if(lastPackage.guaranteed_delivery_date){
                            projectedDeliveryDate = lastPackage.guaranteed_delivery_date;
                        } else if (lastPackage.estimated_delivery_date_end) {
                            projectedDeliveryDate = lastPackage.estimated_delivery_date_end;
                        } else if (lastPackage.estimated_delivery_date_begin){
                            projectedDeliveryDate = lastPackage.estimated_delivery_date_begin;
                        }

                        console.log('Last package narvar status: ', lastPackage.narvar_status.toLowerCase());

                        switch(lastPackage.narvar_status.toLowerCase()){

                            case 'delivered':

                                spokenDeliveryDate = '<say-as interpret-as="date">' + lastPackage.last_status_date.split(' ')[0] + '</say-as>';
                                if(queryRetailer){
                                    speechOutput = that.t("DELIVERED_EDD_RESPONSE_RETAILER_1") + queryRetailer + that.t("DELIVERED_EDD_RESPONSE_RETAILER_2") + spokenDeliveryDate;
                                } else {
                                    speechOutput = that.t("DELIVERED_EDD_RESPONSE") + spokenDeliveryDate;
                                }
                                that.emit(':tell', speechOutput);
                                break;

                            case 'intransit':

                                spokenDeliveryDate = '<say-as interpret-as="date">' + projectedDeliveryDate.split(' ')[0] + '</say-as>';
                                if(queryRetailer){
                                    speechOutput = that.t("IN_TRANSIT_RESPONSE_RETAILER_1") + queryRetailer + that.t("IN_TRANSIT_EDD_RESPONSE_RETAILER_2") + spokenDeliveryDate;
                                } else {
                                    speechOutput = that.t("IN_TRANSIT_EDD_RESPONSE") + spokenDeliveryDate;
                                }
                                that.emit(':tell', speechOutput);
                                break;

                            case 'justshipped':

                                if(lastPackage.ship_date){
                                    let spokenShipDate = '<say-as interpret-as="date">' + lastPackage.ship_date.split(' ')[0] + '</say-as>';
                                    spokenDeliveryDate = '<say-as interpret-as="date">' + projectedDeliveryDate.split(' ')[0] + '</say-as>';
                                    if(queryRetailer){
                                        speechOutput = that.t("JUST_SHIPPED_SHIPPED_ON_RESPONSE_RETAILER_1") + queryRetailer + that.t("JUST_SHIPPED_SHIPPED_ON_RESPONSE_RETAILER_2") + spokenShipDate + that.t("JUST_SHIPPED_EDD_RESPONSE") + spokenDeliveryDate;
                                    } else {
                                        speechOutput = that.t("JUST_SHIPPED_SHIPPED_ON_RESPONSE") + spokenShipDate + that.t("JUST_SHIPPED_EDD_RESPONSE") + spokenDeliveryDate;
                                    }
                                    that.emit(':tell', speechOutput);
                                } else {
                                    spokenDeliveryDate = '<say-as interpret-as="date">' + projectedDeliveryDate.split(' ')[0] + '</say-as>';
                                    if(queryRetailer){
                                        speechOutput = that.t("IN_TRANSIT_RESPONSE_RETAILER_1") + queryRetailer + that.t("IN_TRANSIT_EDD_RESPONSE_RETAILER_2") + spokenDeliveryDate;
                                    } else {
                                        speechOutput = that.t("IN_TRANSIT_EDD_RESPONSE") + spokenDeliveryDate;
                                    }
                                    that.emit(':tell', speechOutput);
                                }

                                break;

                            case 'exception':

                                speechOutput = that.t("EXCEPTION_EDD_RESPONSE");
                                that.emit(':tell', speechOutput);
                                break;

                            case 'null':

                                speechOutput = "Apologies chap, I could not find the drones you are inquiring about. Cheerio!";
                                that.emit(':tell', speechOutput);
                                break;

                            default:

                                speechOutput = "Apologies chap, I could not find the drones you are inquiring about. Cheerio!";
                                that.emit(':tell', speechOutput);
                                break;
                        }
                    });
                } else {
                    if(queryRetailer){
                        speechOutput = "We're sorry, Narwhal couldn't find any recent packages from " + queryRetailer;
                    } else {
                        speechOutput = "We're sorry, Narwhal couldn't find any recent packages.";
                    }

                    that.emit(':tell', speechOutput);
                }


            });
        } else {
            if(queryRetailer){
                speechOutput = "We're sorry, Narwhal couldn't find any recent packages from " + queryRetailer;
            } else {
                speechOutput = "We're sorry, Narwhal couldn't find any recent packages.";
            }
            that.emit(':tell', speechOutput);
        }
    });
}


function getShippingSummary(){

    let queryRetailer = slotValue("Retailer");
    let speechOutput;

    getGoogleEmails().then((inbox) => {

        if(inbox.resultSizeEstimate > 0){
            var ids = inbox.messages.map((email) => { return email.id; }); console.log('ids: ', ids);

            var promiseEmails = ids.map((id) => {
                return getGoogleEmail(id);
            });

            Promise.all(promiseEmails).then((emails) => {

                /*
                 This entire filtering logic only applies to tracking emails from Nordstom. Emails from other retailers
                 probably will not be caught by this logic due to email body parsing.
                 */

                /*
                 Filter array of emails into an array of tracking parameters. The tracking parameters are parsed in the
                 email body.
                 */
                let trackingParamsArray = emails.filter((email) => { //filter for emails with payload
                    return email.payload;
                }).filter((email) => { // filter for emails with payload.parts
                    return email.payload.parts;
                }).filter((email) => { //filter for emails with payload.parts[0].body
                    return email.payload.parts[0].body;
                }).filter((email) => { //filter for emails with payload.pats[0].body.data
                    return email.payload.parts[0].body.data;
                }).filter((email) => { //filter for emails which contain emailParseGoal in the decoded part body
                    let data = base64url.decode(email.payload.parts[0].body.data); //console.log('Email data is: ', data);
                    // Filter emails which contain the retailer name
                    if(queryRetailer){
                        return (data.includes(emailParseGoal) && data.includes(queryRetailer));
                    } else {
                        return data.includes(emailParseGoal);
                    }
                }).map((email) => {
                    let data = base64url.decode(email.payload.parts[0].body.data);
                    if (data.includes(emailParseGoal)) {
                        let splitted = data.split(emailParseGoal);
                        let trackingStart = 0;
                        let carrierStart = splitted[0].lastIndexOf('\n');
                        let trackingEnd = splitted[1].indexOf('<');
                        let trackingNumber = splitted[1].substring(trackingStart, trackingEnd).replace(/[^\w\s]/gi, '').trim();
                        let carrier = splitted[0].substring(carrierStart).trim();
                        let trackingParams = {"carrier": carrier, "trackingNumber": trackingNumber};
                        console.log('Tracking params:', trackingParams);
                        return trackingParams
                    }
                });

                /*
                 This code block is to filter out duplicate tracking numbers.
                 */

                trackingParamsArray = trackingParamsArray.filter((param) => {

                    console.log('Tracking params array: ', JSON.stringify(trackingParamsArray, null, 2));

                    // Get all indexes of a tracking parameter
                    var indexes = [];
                    for(let i = 0; i < trackingParamsArray.length; i++) {
                        if (trackingParamsArray[i].trackingNumber == param.trackingNumber) {
                            indexes.push(i);
                        }
                    }
                    console.log('Param is present at index/es: ', indexes);
                    if (indexes.length > 1){
                        for(let i = indexes.length-1; i >=1 ; i--) {
                            trackingParamsArray.splice(indexes[i],1)
                        }
                    }
                    return true;
                });

                // todo: save tracking params array to database which are new

                console.log("Tracking params array: ", trackingParamsArray);

                if (trackingParamsArray.length > 0) {

                    var promiseTrackingInfo = trackingParamsArray.map((trackingParam) => {
                        return getTrackingInfo(trackingParam.carrier, trackingParam.trackingNumber);
                    });

                    Promise.all(promiseTrackingInfo).then((trackingInfoArray) => {

                        console.log('Tracking Info Array: ', JSON.stringify(trackingInfoArray, null, 2));

                        let packagesInTransit = trackingInfoArray.filter((packageInfo) => {
                            let packageStatus = packageInfo.narvar_status.toLowerCase();
                            console.log('package narvar status: ', packageInfo.narvar_status.toLowerCase());
                            return (packageStatus == 'intransit' || packageStatus == 'justshipped') ? true : false;
                        });

                        console.log('packages in transit: ', packagesInTransit.length);

                        if (packagesInTransit.length == 1){
                            if(queryRetailer){
                                speechOutput = "You have " + packagesInTransit.length + " package from " +  queryRetailer + " on the way.";
                            } else {
                                speechOutput = "You have " + packagesInTransit.length + " package on the way.";
                            }
                        } else {
                            if(queryRetailer){
                                speechOutput = "You have " + packagesInTransit.length + " packages from " +  queryRetailer + " on the way.";
                            } else {
                                speechOutput = "You have " + packagesInTransit.length + " packages on the way.";
                            }
                        }

                        that.emit(':tell', speechOutput);

                    });
                } else {
                    if(queryRetailer){
                        speechOutput = "Narwhal couldn't find any recent packages from " + queryRetailer;
                    } else {
                        speechOutput = "Narwhal couldn't find any recent packages.";
                    }
                    that.emit(':tell', speechOutput);
                }
            });
        } else {
            if(queryRetailer){
                speechOutput = "Narwhal couldn't find any recent packages from " + queryRetailer;
            } else {
                speechOutput = "Narwhal couldn't find any recent packages.";
            }
            that.emit(':tell', speechOutput);
        }
    });
}


function getLocation(){

    let queryRetailer = slotValue("Retailer");
    let queryDate = slotValue("Date");
    let speechOutput;

    getGoogleEmails().then((inbox) => {

        if(inbox.resultSizeEstimate > 0){
            var ids = inbox.messages.map((email) => { return email.id; }); console.log('ids: ', ids);

            var promiseEmails = ids.map((id) => {
                return getGoogleEmail(id);
            });

            Promise.all(promiseEmails).then((emails) => {

                /*
                 This entire filtering logic only applies to tracking emails from Nordstom. Emails from other retailers
                 probably will not be caught by this logic due to email body parsing.
                 */

                /*
                 Filter array of emails into an array of tracking parameters. The tracking parameters are parsed in the
                 email body.
                 */
                let trackingParamsArray = emails.filter((email) => { //filter for emails with payload
                    return email.payload;
                }).filter((email) => { // filter for emails with payload.parts
                    return email.payload.parts;
                }).filter((email) => { //filter for emails with payload.parts[0].body
                    return email.payload.parts[0].body;
                }).filter((email) => { //filter for emails with payload.pats[0].body.data
                    return email.payload.parts[0].body.data;
                }).filter((email) => { //filter for emails which contain emailParseGoal in the decoded part body
                    let data = base64url.decode(email.payload.parts[0].body.data); //console.log('Email data is: ', data);
                    // Filter emails which contain the retailer name
                    if(queryRetailer){
                        return (data.includes(emailParseGoal) && data.includes(queryRetailer));
                    } else {
                        return data.includes(emailParseGoal);
                    }
                }).map((email) => {
                    let data = base64url.decode(email.payload.parts[0].body.data);
                    if (data.includes(emailParseGoal)) {
                        let splitted = data.split(emailParseGoal);
                        let trackingStart = 0;
                        let carrierStart = splitted[0].lastIndexOf('\n');
                        let trackingEnd = splitted[1].indexOf('<');
                        let trackingNumber = splitted[1].substring(trackingStart, trackingEnd).replace(/[^\w\s]/gi, '').trim();
                        let carrier = splitted[0].substring(carrierStart).trim();
                        let trackingParams = {"carrier": carrier, "trackingNumber": trackingNumber};
                        console.log('Tracking params:', trackingParams);
                        return trackingParams
                    }
                });

                /*
                 This code block is to filter out duplicate tracking numbers.
                 */

                trackingParamsArray = trackingParamsArray.filter((param) => {

                    console.log('Tracking params array: ', JSON.stringify(trackingParamsArray, null, 2));

                    // Get all indexes of a tracking parameter
                    var indexes = [];
                    for(let i = 0; i < trackingParamsArray.length; i++) {
                        if (trackingParamsArray[i].trackingNumber == param.trackingNumber) {
                            indexes.push(i);
                        }
                    }
                    console.log('Param is present at index/es: ', indexes);
                    if (indexes.length > 1){
                        for(let i = indexes.length-1; i >=1 ; i--) {
                            trackingParamsArray.splice(indexes[i],1)
                        }
                    }
                    return true;
                });

                // todo: save tracking params array to database which are new

                console.log("Tracking params array: ", trackingParamsArray);

                if (trackingParamsArray.length > 0) {

                    var promiseTrackingInfo = trackingParamsArray.map((trackingParam) => {
                        return getTrackingInfo(trackingParam.carrier, trackingParam.trackingNumber);
                    });

                    Promise.all(promiseTrackingInfo).then((trackingInfoArray) => {

                        console.log('Tracking Info Array: ', JSON.stringify(trackingInfoArray, null, 2));

                        let lastPackage = trackingInfoArray[0];

                        console.log('lastPackage: ', JSON.stringify(lastPackage, null, 2));
                        console.log('lastPackage.TrackDetail: ', JSON.stringify(lastPackage.TrackDetail, null, 2));
                        console.log('lastPackage.TrackDetail.length: ', lastPackage.TrackDetail.size);

                        let lastActivityDate;
                        let lastActivityLocation;

                        if(lastPackage.TrackDetail.length > 0){
                            console.log('Last package activity array: ', JSON.stringify(lastPackage.TrackDetail, null, 2));
                            /*
                                 {
                                 "shipmentLocationType": null,
                                 "error": null,
                                 "error_code": null,
                                 "event": "DEPARTURE SCAN",
                                 "event_code": "DP",
                                 "event_date": "2017-01-27 02:32:00",
                                 "event_city": "GREENSBORO",
                                 "event_state": "NC",
                                 "event_zip": null,
                                 "event_country_code": "US",
                                 "event_date_offset": null,
                                 "track_status_code_mapping": null
                                 },
                             */

                            lastActivityDate = '<say-as interpret-as="date">' + lastPackage.TrackDetail[0].event_date.split(' ')[0] + '</say-as>';
                            lastActivityLocation = lastPackage.TrackDetail[0].event_city;

                            if(queryRetailer){
                                speechOutput = that.t("IN_TRANSIT_RESPONSE_RETAILER_1") + queryRetailer + that.t("IN_TRANSIT_LOCATION_RESPONSE_RETAILER_2") + lastActivityLocation + " on " + lastActivityDate;
                            } else {
                                speechOutput = that.t("IN_TRANSIT_LOCATION_RESPONSE") + lastActivityLocation + " on " + lastActivityDate;
                            }
                            that.emit(':tell', speechOutput);

                        } else {
                            if(queryRetailer){
                                speechOutput = "We're sorry, Narwhal couldn't find any location history from your most recent " + queryRetailer + " package";
                            } else {
                                speechOutput = "We're sorry, Narwhal couldn't  find any location history from your most recent package.";
                            }
                            that.emit(':tell', speechOutput);
                        }

                    });
                } else {
                    if(queryRetailer){
                        speechOutput = "We're sorry, Narwhal couldn't find any location history from your most recent " + queryRetailer + " package";
                    } else {
                        speechOutput = "We're sorry, Narwhal couldn't  find any location history from your most recent package.";
                    }
                    that.emit(':tell', speechOutput);
                }


            });
        } else {
            if(queryRetailer){
                speechOutput = "We're sorry, Narwhal couldn't find any location history from your most recent " + queryRetailer + " package";
            } else {
                speechOutput = "We're sorry, Narwhal couldn't  find any location history from your most recent package.";
            }
            that.emit(':tell', speechOutput);
        }
    });
}

let handlers = {
    'LaunchRequest': function () {
        authWrapper(this).then(() => {
            that.emit(':tell', that.t("HELP_MESSAGE"));
        });
    },
    'GetEmailProviderThenPhoneNumber': function() {
        authWrapper(this).then(() => {
            that.emit(':tell', that.t("HELP_MESSAGE"));
        });
    },
    'GetPhoneNumberThenEmailProvider': function() {
        authWrapper(this).then(() => {
            that.emit(':tell', that.t("HELP_MESSAGE"));
        });
    },
    'GetPhoneNumber': function() {
        authWrapper(this).then(() => {
            that.emit(':tell', that.t("HELP_MESSAGE"));
        });
    },
    'GetEmailProvider': function() {
        authWrapper(this).then(() => {
            that.emit(':tell', that.t("HELP_MESSAGE"));
        });
    },
    'GetDeliveryDate': function () {
        authWrapper(this).then(() => {
            getDeliveryDate();
        });
    },
    'GetPackageLocation': function () {
        authWrapper(this).then(() => {
            getLocation();
        });
    },
    'GetShippingSummary': function () {
        authWrapper(this).then(() => {
            getShippingSummary();
        });
    },
    'AMAZON.HelpIntent': function () {
        that = this;
        let speechOutput = this.t("HELP_MESSAGE");
        let reprompt = this.t("HELP_MESSAGE");
        this.emit(':ask', speechOutput, reprompt);
    },
    'AMAZON.CancelIntent': function () {
        that = this;
        this.emit(':tell', this.t("STOP_MESSAGE"));
    },
    'AMAZON.StopIntent': function () {
        that = this;
        this.emit(':tell', this.t("STOP_MESSAGE"));
    }
};

exports.handler = function(event, context, callback) {

    console.log('App invoked with event: ', JSON.stringify(event, null, 2));
    console.log('App invoked with context: ', JSON.stringify(context, null, 2));

    let alexa = Alexa.handler(event, context);
    alexa.appId = appId;
    alexa.resources = languageStrings;
    alexa.registerHandlers(handlers);
    alexa.execute();
};
