const services = new Map([
  ['website', 'Website'], ['automation', 'Automation'], ['ai-agent', 'AI agent'],
  ['app', 'App'], ['motion', 'Motion'], ['other', 'Something else']
]);
const emailPattern = /^[^\s@<>,;:"()[\]\\]+@(?:[a-z0-9-]+\.)+[a-z0-9-]+$/i;
const submissionPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const maxBody = 16 * 1024;

function json(data, status, headers = {}) {
  return Response.json(data, { status, headers:{ 'Cache-Control':'no-store', ...headers } });
}

export default {
  async fetch(request) {
    if (request.method !== 'POST') return json({ error:'Method not allowed.' }, 405, { Allow:'POST' });
    if (request.headers.get('sec-fetch-site') === 'cross-site') {
      return json({ error:'Open the Kinetiq contact page to submit an inquiry.' }, 403);
    }
    if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      return json({ error:'Send the inquiry from the contact form.' }, 415);
    }
    if (Number(request.headers.get('content-length')) > maxBody) {
      return json({ error:'The inquiry is too long.' }, 413);
    }

    let input;
    try {
      const body = await request.text();
      if (new TextEncoder().encode(body).length > maxBody) {
        return json({ error:'The inquiry is too long.' }, 413);
      }
      input = JSON.parse(body);
    } catch {
      return json({ error:'The inquiry could not be read.' }, 400);
    }
    if (!input || typeof input !== 'object' || Array.isArray(input) || input.companyWebsite) {
      return json({ error:'The inquiry could not be accepted.' }, 400);
    }

    const name = typeof input.name === 'string' ? input.name.trim() : '';
    const email = typeof input.email === 'string' ? input.email.trim() : '';
    const message = typeof input.message === 'string' ? input.message.trim() : '';
    if (!name || name.length > 100 || /[\r\n]/.test(name)) {
      return json({ error:'Enter a name of up to 100 characters.' }, 422);
    }
    if (email.length > 254 || !emailPattern.test(email)) {
      return json({ error:'Enter a valid reply email.' }, 422);
    }
    if (!message || message.length > 3000) {
      return json({ error:'Add a project brief of up to 3,000 characters.' }, 422);
    }
    if (!Array.isArray(input.services) || input.services.length > services.size ||
        input.services.some(service => !services.has(service)) ||
        typeof input.submissionId !== 'string' || !submissionPattern.test(input.submissionId)) {
      return json({ error:'Check the inquiry and send it again.' }, 422);
    }

    const apiKey = process.env.RESEND_API_KEY?.trim();
    const recipient = process.env.INQUIRY_TO?.trim();
    const sender = process.env.INQUIRY_FROM?.trim() || 'Kinetiq <onboarding@resend.dev>';
    if (!apiKey || !recipient) {
      return json({ error:'The form is not connected yet. You can still reach us on Instagram or Telegram.' }, 503);
    }
    const labels = [...new Set(input.services)].map(service => services.get(service));
    try {
      const delivery = await fetch('https://api.resend.com/emails', {
        method:'POST',
        headers:{
          Authorization:'Bearer ' + apiKey,
          'Content-Type':'application/json',
          'Idempotency-Key':'kinetiq-inquiry/' + input.submissionId
        },
        body:JSON.stringify({
          from:sender,
          to:[recipient],
          reply_to:email,
          subject:'New Kinetiq inquiry',
          text:[
            'Name: ' + name,
            'Reply email: ' + email,
            'Services: ' + (labels.join(', ') || 'Not specified'),
            '', 'Project brief', message
          ].join('\n')
        }),
        signal:AbortSignal.timeout(8000)
      });
      const receipt = delivery.ok ? await delivery.json() : null;
      if (receipt?.id) return json({ ok:true }, 200);
      console.error('Inquiry delivery returned status', delivery.status);
    } catch (error) {
      console.error('Inquiry delivery failed', error.name);
    }
    return json({ error:'We couldn’t confirm delivery. Try again or message us directly.' }, 502);
  }
};
