// https://devcenter.heroku.com/articles/heroku-postgresql#connecting-in-node-js
import dotenv from 'dotenv';

if (process.env.NODE_ENV !== 'production') {
  dotenv.config();
}

const API_KEY = process.env.MAILGUN_API_KEY;
const DOMAIN = process.env.MAILGUN_DOMAIN;

//const mailgun = require('mailgun-js')({apiKey: API_KEY, domain: DOMAIN});

export function sendPasswordResetMail(to, resetToken) {

  const data = {
    from: `no-reply <me@samples.mailgun.org>`,
    to: to,
    subject: 'WebCompanion - Reset Password request',
    text: `Testing some Mailgun awesomeness! -> ${resetToken}`,
  };

  console.info(`Send reset token ${resetToken} to ${to}`);

  //mailgun.messages().send(data, function (error, body) {
    //console.log(body);
  //});
}
