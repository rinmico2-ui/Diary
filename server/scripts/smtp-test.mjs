// One-off SMTP diagnostic: verifies Brevo credentials and sends a test message.
import 'dotenv/config';
import nodemailer from 'nodemailer';

const { SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;

console.log('host  ', SMTP_HOST);
console.log('port  ', SMTP_PORT, 'secure', SMTP_SECURE);
console.log('user  ', SMTP_USER);
console.log('pass  ', SMTP_PASS ? `${SMTP_PASS.slice(0, 12)}… (${SMTP_PASS.length} chars)` : '(empty)');
console.log('from  ', SMTP_FROM);

if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
  console.log('\nMISSING: SMTP_HOST / SMTP_USER / SMTP_PASS must all be set.');
  process.exit(1);
}

const transport = nodemailer.createTransport({
  host: SMTP_HOST,
  port: Number(SMTP_PORT),
  secure: SMTP_SECURE === '1',
  auth: { user: SMTP_USER, pass: SMTP_PASS },
});

try {
  console.log('\nverifying connection + auth…');
  await transport.verify();
  console.log('verify OK');

  if (process.argv.includes('--send')) {
    const info = await transport.sendMail({
      from: SMTP_FROM,
      to: SMTP_FROM,
      subject: 'SMTP test — Our Little Space',
      text: 'If you can read this, Brevo SMTP is working.',
      html: '<p>If you can read this, <b>Brevo SMTP is working</b>.</p>',
    });
    console.log('sent OK:', info.response);
  }
} catch (error) {
  console.log('\nFAILED:');
  console.log(error.message);
  if (error.response) console.log('response:', error.response);
  process.exit(1);
}
