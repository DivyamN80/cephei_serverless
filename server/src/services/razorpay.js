// Exports a configured Razorpay client when credentials are present in the
// environment, otherwise exports `null`. Routes that need Razorpay must check
// for `null` and respond gracefully (see routes/billing.js).
import Razorpay from 'razorpay';

const keyId = process.env.RAZORPAY_KEY_ID;
const keySecret = process.env.RAZORPAY_KEY_SECRET;

let razorpay = null;

if (keyId && keySecret) {
  razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });
} else {
  console.warn(
    '[razorpay] RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET not set — billing checkout endpoints will respond with 501 until configured.'
  );
}

export default razorpay;
